import SwiftUI

@main
struct EvenMailApp: App {
    @State private var session = Session()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .preferredColorScheme(Prefs.shared.appearance.colorScheme)
                .environment(\.locale, Prefs.shared.locale)
                .tint(Theme.accentText)
                .font(.inter(16))
        }
    }
}

/// Signed out, signed in, or still finding out.
struct RootView: View {
    @Environment(Session.self) private var session

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            switch session.state {
            case .loading:
                Image("Brand").resizable().frame(width: 56, height: 56)
            case .signedOut:
                SignInView()
            case .signedIn(let user):
                MailRoot(user: user).id(user.id)
            }
        }
        .task { await session.restore() }
    }
}

/// The sign-in screen of the desktop app (`apps/desktop/src`), for the phone:
/// the account site does the signing in, in the browser.
struct SignInView: View {
    @Environment(Session.self) private var session

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()
            Image("Brand").resizable().frame(width: 48, height: 48)
                .padding(.bottom, 24)
            Text("Even mailen")
                .font(.inter(28, .semibold, relativeTo: .largeTitle))
                .foregroundStyle(Theme.foreground)
            Text(t("All your mailboxes in one calm inbox.", "Al je mailboxen in één rustige inbox."))
                .font(.inter(16))
                .foregroundStyle(Theme.mutedForeground)
                .padding(.top, 8)
            if let error = session.error {
                Text(error)
                    .font(.inter(14))
                    .foregroundStyle(Theme.destructive)
                    .padding(.top, 20)
            }
            Spacer()
            PrimaryButton(title: t("Sign in via your browser", "Inloggen via je browser"), busy: session.signingIn) {
                Task { await session.signIn() }
            }
            Text(t("You sign in on the Even account site and come straight back here.", "Je logt in op de accountsite van Even en komt direct hier terug."))
                .font(.inter(13))
                .foregroundStyle(Theme.mutedForeground)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
                .padding(.top, 12)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 32)
        .frame(maxWidth: 440)
    }
}

/// The web's default button: filled with the accent colour.
struct PrimaryButton: View {
    let title: String
    var busy = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().tint(Theme.primaryForeground) }
                Text(title).font(.inter(16, .medium))
            }
            .foregroundStyle(Theme.primaryForeground)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(Theme.primary, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(busy)
    }
}

/// The web's outline button.
struct OutlineButton: View {
    let title: String
    var icon: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon { Icon(icon, size: 18) }
                Text(title).font(.inter(15, .medium))
            }
            .foregroundStyle(Theme.foreground)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(Theme.background, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).strokeBorder(Theme.border))
        }
        .buttonStyle(.plain)
    }
}
