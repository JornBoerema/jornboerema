import SwiftUI
import UIKit
import UserNotifications

/// Notifications for new mail. The API sends them through Apple when a sync
/// brings in unread mail (`apps/api/src/mail/push-server.ts`); this side asks
/// permission, hands the API this install's address, and opens the conversation
/// a tapped notification is about.
@Observable
@MainActor
final class Push {
    static let shared = Push()

    /// A conversation to open, named by a notification that was tapped.
    var opened: Tapped?
    /// Whether the phone lets this app notify at all.
    var allowed = false
    /// The API has a push key; without one it remembers the device but can't ring it.
    var serverReady = true

    struct Tapped: Equatable {
        let thread: String
        let sender: String
        let subject: String
        let snippet: String
    }

    private var token: String? {
        get { UserDefaults.standard.string(forKey: "push-token") }
        set { UserDefaults.standard.set(newValue, forKey: "push-token") }
    }

    /// Builds run from Xcode get Apple's sandbox; TestFlight and the App Store the real one.
    private var environment: String {
        #if DEBUG
        "sandbox"
        #else
        "production"
        #endif
    }

    private struct Device: Encodable {
        let token: String
        let environment: String
    }

    private struct Registered: Decodable {
        let enabled: Bool?
    }

    /// Asks permission (the first time) and registers with Apple; the token
    /// arrives in the app delegate and goes on to the API from there.
    func start() async {
        guard !Demo.enabled, Prefs.shared.notifications else { return }
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        allowed = granted
        guard granted else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// What the phone's settings say now, for the settings screen.
    func refresh() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        allowed = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
    }

    func received(token data: Data) {
        let hex = data.map { String(format: "%02x", $0) }.joined()
        token = hex
        Task { await register() }
    }

    private func register() async {
        guard let token, Keychain.token != nil, Prefs.shared.notifications else { return }
        let answer: Registered? = try? await API.post("/api/mail/push/devices", Device(token: token, environment: environment))
        if let enabled = answer?.enabled { serverReady = enabled }
    }

    /// Stops notifications for this device: when signing out, or when turned off.
    func stop() async {
        guard let token, !Demo.enabled else { return }
        try? await API.run("/api/mail/push/devices/\(token)", method: "DELETE")
        setBadge(0)
    }

    /// The number on the app's icon: unread conversations in the inbox.
    func setBadge(_ count: Int) {
        guard allowed else { return }
        UNUserNotificationCenter.current().setBadgeCount(max(0, count))
    }
}

/// UIKit's side of notifications: the device token, and taps.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in Push.shared.received(token: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // No push entitlement (a simulator, or a build signed without it): the app works without.
    }

    /// With the app open the list already shows the mail; a quiet banner is enough.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let content = response.notification.request.content
        guard let thread = content.userInfo["thread"] as? String else { return }
        await MainActor.run {
            // The subject is the bold second line; a mail without text has it as its only line.
            let subject = content.subtitle.isEmpty ? content.body : content.subtitle
            Push.shared.opened = Push.Tapped(thread: thread, sender: content.title, subject: subject, snippet: content.subtitle.isEmpty ? "" : content.body)
        }
    }
}
