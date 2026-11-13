import SwiftUI

enum Language: String, CaseIterable {
    case system, en, nl
}

enum Appearance: String, CaseIterable {
    case system, light, dark

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

/// What the web keeps in localStorage: choices that belong to this device.
@Observable
final class Prefs {
    static let shared = Prefs()

    var language: Language {
        didSet { UserDefaults.standard.set(language.rawValue, forKey: "language") }
    }
    var appearance: Appearance {
        didSet { UserDefaults.standard.set(appearance.rawValue, forKey: "appearance") }
    }
    /// A notification for new mail on this device.
    var notifications: Bool {
        didSet { UserDefaults.standard.set(notifications, forKey: "notifications") }
    }

    private init() {
        let defaults = UserDefaults.standard
        let environment = ProcessInfo.processInfo.environment
        language = Language(rawValue: environment["EVEN_LANG"] ?? defaults.string(forKey: "language") ?? "") ?? .system
        appearance = Appearance(rawValue: environment["EVEN_THEME"] ?? defaults.string(forKey: "appearance") ?? "") ?? .system
        notifications = defaults.object(forKey: "notifications") as? Bool ?? true
    }

    /// "en" or "nl": the chosen language, or the phone's when that is Dutch.
    var languageCode: String {
        switch language {
        case .en: "en"
        case .nl: "nl"
        case .system: Locale.preferredLanguages.first?.hasPrefix("nl") == true ? "nl" : "en"
        }
    }

    var locale: Locale { Locale(identifier: languageCode == "nl" ? "nl_NL" : "en_GB") }
}

/// English and Dutch, the words next to the screen that shows them (as the
/// native desktop app does): `t("Sign out", "Uitloggen")`.
func t(_ english: String, _ dutch: String) -> String {
    Prefs.shared.languageCode == "nl" ? dutch : english
}

/// "09:41" today, "12 Dec" this year, "12 Dec 2024" before (`lib/dates.ts`).
func shortDate(_ date: Date, now: Date = Date()) -> String {
    let calendar = Calendar.current
    let formatter = DateFormatter()
    formatter.locale = Prefs.shared.locale
    if calendar.isDate(date, inSameDayAs: now) {
        formatter.dateFormat = "HH:mm"
    } else if calendar.component(.year, from: date) == calendar.component(.year, from: now) {
        formatter.setLocalizedDateFormatFromTemplate("d MMM")
    } else {
        formatter.setLocalizedDateFormatFromTemplate("d MMM yyyy")
    }
    return formatter.string(from: date)
}

/// "12 Dec 2025 at 09:41", above an opened message.
func longDate(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Prefs.shared.locale
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    return formatter.string(from: date)
}

/// "tomorrow 08:00", "Friday 10:00", "12 Dec 08:00" (`formatMoment` in `lib/later.ts`).
func formatMoment(_ date: Date, now: Date = Date()) -> String {
    let calendar = Calendar.current
    let formatter = DateFormatter()
    formatter.locale = Prefs.shared.locale
    formatter.dateFormat = "HH:mm"
    let time = formatter.string(from: date)
    let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)).day ?? 0
    if days == 0 { return "\(t("today", "vandaag")) \(time)" }
    if days == 1 { return "\(t("tomorrow", "morgen")) \(time)" }
    if days > 1 && days < 7 {
        formatter.dateFormat = "EEEE"
        return "\(formatter.string(from: date)) \(time)"
    }
    formatter.setLocalizedDateFormatFromTemplate("d MMM")
    return "\(formatter.string(from: date)) \(time)"
}

func formatSize(_ bytes: Int) -> String {
    let formatter = ByteCountFormatter()
    formatter.countStyle = .file
    return formatter.string(fromByteCount: Int64(bytes))
}
