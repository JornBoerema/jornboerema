import SwiftUI

/// What the composer starts from.
struct ComposeRequest: Identifiable {
    enum Mode {
        case new
        case reply(thread: MailThread, message: MailMessage, all: Bool)
        case forward(thread: MailThread, message: MailMessage)
        case draft(accountId: String, draftId: String)
    }

    let id = UUID()
    let mode: Mode
}

struct SnoozeRequest: Identifiable {
    let id = UUID()
    let thread: MailThread
}

/// Where the user is: the place, the open conversation, and the sheets on top.
@Observable
@MainActor
final class Navigator {
    var place: Place? = .inbox
    var selection: String?
    var opened: MailThread?
    var compose: ComposeRequest?
    var snoozing: SnoozeRequest?
    var settings = false

    var shownPlace: Place { place ?? .inbox }

    /// Acts on the open conversation or a list line. When it leaves the list, the
    /// tablet opens its neighbour, as J/K and archive do on the web; the phone
    /// goes back to the list.
    func act(_ action: ThreadAction, on thread: MailThread, store: MailStore, compact: Bool, until: Date? = nil) {
        let place = shownPlace
        let leaves = until != nil || place.leaves(action)
        var next: String?
        if leaves, !compact, selection == thread.id {
            let threads = store.list(place).threads
            if let index = threads.firstIndex(where: { $0.id == thread.id }) {
                next = index + 1 < threads.count ? threads[index + 1].id : index > 0 ? threads[index - 1].id : nil
            }
        }
        store.act(action, on: [thread], in: place, until: until)
        guard leaves, selection == thread.id || opened?.id == thread.id else { return }
        selection = next
        if next == nil { opened = nil }
    }
}

/// Signed in: checks access, loads the mail and shows the app.
struct MailRoot: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var store: MailStore
    @State private var navigator = Navigator()

    init(user: SessionUser) {
        _store = State(initialValue: MailStore(user: user))
    }

    var body: some View {
        Group {
            if let access = store.access {
                if access.access { MailShell() } else { AccessView(requested: access.requested) }
            } else if let error = store.accessError {
                EmptyState(icon: "cloud-alert", title: t("Could not reach Even", "Even is niet bereikbaar"), text: error) {
                    OutlineButton(title: t("Try again", "Opnieuw proberen"), icon: "refresh") {
                        Task { await store.start() }
                    }
                    .frame(maxWidth: 220)
                }
            } else {
                ProgressView()
            }
        }
        .environment(store)
        .environment(navigator)
        .overlay(alignment: .bottom) { ToastView() .environment(store) }
        .task { await store.start() }
        .onChange(of: scenePhase) { _, phase in
            Task { await store.setActive(phase == .active) }
        }
        .onDisappear { store.stop() }
    }
}

/// Sidebar, list and reader: three columns on a tablet, a stack on a phone.
struct MailShell: View {
    @Environment(MailStore.self) private var store
    @Environment(Navigator.self) private var navigator
    @State private var compact: NavigationSplitViewColumn = .content
    @State private var visibility: NavigationSplitViewVisibility = .automatic

    var body: some View {
        @Bindable var navigator = navigator
        NavigationSplitView(columnVisibility: $visibility, preferredCompactColumn: $compact) {
            SidebarView()
                .navigationSplitViewColumnWidth(min: 240, ideal: 280, max: 320)
        } content: {
            ThreadListView(place: navigator.shownPlace)
                .navigationSplitViewColumnWidth(min: 320, ideal: 380, max: 460)
        } detail: {
            if let thread = navigator.opened {
                ConversationView(thread: thread).id(thread.id)
            } else {
                EmptyState(icon: "mail-01", title: t("No conversation open", "Geen gesprek geopend"), text: t("Pick one from the list to read it here.", "Kies er een uit de lijst om het hier te lezen."))
                    .background(Theme.background)
            }
        }
        .sheet(item: $navigator.compose) { request in
            ComposeView(request: request).environment(store)
        }
        .sheet(item: $navigator.snoozing) { request in
            SnoozeSheet(thread: request.thread)
                .environment(store)
                .environment(navigator)
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $navigator.settings) {
            SettingsView().environment(store)
        }
        .onChange(of: navigator.place) { _, place in
            store.showing(place ?? .inbox)
        }
        .task {
            // After the first layout, as a tap would be.
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            showForScreenshot()
        }
    }
}

extension MailShell {
    /// For `scripts/shot.sh`, which can't tap: `EVEN_SHOW` opens a screen of the
    /// demo. Only with made-up mail, never in a real session.
    private func showForScreenshot() {
        guard Demo.enabled, let show = ProcessInfo.processInfo.environment["EVEN_SHOW"] else { return }
        let thread = Demo.threads[2]
        let message = Demo.detail(thread.id).messages.last!
        switch show {
        case "sidebar":
            compact = .sidebar
            visibility = .all
        case "conversation":
            navigator.selection = thread.id
            navigator.opened = thread
            compact = .detail
        case "compose": navigator.compose = ComposeRequest(mode: .new)
        case "reply": navigator.compose = ComposeRequest(mode: .reply(thread: thread, message: message, all: false))
        case "snooze": navigator.snoozing = SnoozeRequest(thread: thread)
        case "settings": navigator.settings = true
        case "toast": store.act(.archive, on: [Demo.threads[0]], in: .inbox)
        default: break
        }
    }
}

/// The places and mailboxes (`components/sidebar.tsx`).
struct SidebarView: View {
    @Environment(MailStore.self) private var store
    @Environment(Navigator.self) private var navigator

    var body: some View {
        @Bindable var navigator = navigator
        List(selection: $navigator.place) {
            Section {
                ForEach(Place.allCases) { place in
                    PlaceRow(place: place, selected: navigator.place == place, count: count(place))
                        .tag(place)
                        .listRowBackground(rowBackground(navigator.place == place))
                        .listRowInsets(EdgeInsets(top: 0, leading: 12, bottom: 0, trailing: 12))
                }
            }
            if store.accounts.count > 1 {
                Section {
                    mailbox(id: "", label: t("All mailboxes", "Alle mailboxen"), color: nil)
                    ForEach(store.accounts) { account in
                        mailbox(id: account.id, label: account.email, color: account.color, needsReconnect: !account.isActive)
                    }
                } header: {
                    Text(t("Mailboxes", "Mailboxen"))
                        .font(.inter(12, .medium, relativeTo: .caption))
                        .foregroundStyle(Theme.mutedForeground)
                        .textCase(nil)
                }
            }
        }
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
        .background(Theme.sidebar)
        .navigationTitle("Even mailen")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { navigator.settings = true } label: { Icon("settings-01") }
                    .accessibilityLabel(t("Settings", "Instellingen"))
            }
        }
        .safeAreaInset(edge: .bottom) {
            Button { navigator.settings = true } label: {
                HStack(spacing: 10) {
                    ContactAvatar(name: store.user.name, email: store.user.email, size: 30)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(store.user.name ?? store.user.email)
                            .font(.inter(14, .medium, relativeTo: .subheadline))
                            .foregroundStyle(Theme.foreground)
                        if store.user.name != nil {
                            Text(store.user.email)
                                .font(.inter(12, relativeTo: .caption))
                                .foregroundStyle(Theme.mutedForeground)
                        }
                    }
                    .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .background(Theme.sidebar)
        }
    }

    private func count(_ place: Place) -> Int {
        switch place {
        case .inbox: store.unreadCount
        case .snoozed: store.snoozedCount
        default: 0
        }
    }

    private func rowBackground(_ selected: Bool) -> some View {
        RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
            .fill(selected ? Theme.accent : .clear)
            .padding(.horizontal, 8)
    }

    private func mailbox(id: String, label: String, color: Int?, needsReconnect: Bool = false) -> some View {
        let selected = store.accountFilter == id
        return Button {
            guard store.accountFilter != id else { return }
            store.accountFilter = id
            Task { await store.load(navigator.shownPlace) }
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    if let color { AccountDot(color: color) } else { Icon("layers-01", size: 18).foregroundStyle(Theme.mutedForeground) }
                }
                .frame(width: 20)
                Text(label)
                    .font(.inter(15, selected ? .medium : .regular, relativeTo: .subheadline))
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if needsReconnect {
                    Icon("alert-02", size: 16).foregroundStyle(Theme.destructive)
                        .accessibilityLabel(t("Needs reconnecting", "Opnieuw koppelen nodig"))
                } else if selected {
                    Icon("tick-02", size: 16).foregroundStyle(Theme.accentText)
                }
            }
            .frame(minHeight: 40)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20))
    }
}

private struct PlaceRow: View {
    let place: Place
    let selected: Bool
    let count: Int

    var body: some View {
        HStack(spacing: 12) {
            Icon(place.icon, size: 20)
                .foregroundStyle(selected ? Theme.accentText : Theme.mutedForeground)
            Text(place.title)
                .font(.inter(16, selected ? .medium : .regular))
                .foregroundStyle(Theme.foreground)
            Spacer(minLength: 0)
            if count > 0 {
                Text("\(count)")
                    .font(.inter(13, relativeTo: .footnote))
                    .monospacedDigit()
                    .foregroundStyle(Theme.mutedForeground)
            }
        }
        .padding(.horizontal, 8)
        .frame(minHeight: 44)
    }
}

/// Even mailen is invite-only for now (`components/access-gate.tsx`).
struct AccessView: View {
    @Environment(MailStore.self) private var store
    @Environment(Session.self) private var session
    let requested: Bool

    var body: some View {
        EmptyState(
            icon: requested ? "checkmark-circle-02" : "mail-lock-01",
            title: requested ? t("Request sent", "Aanvraag verstuurd") : t("Even mailen is invite-only", "Even mailen is op uitnodiging"),
            text: requested
                ? t("You'll get an e-mail as soon as you're let in.", "Je krijgt een e-mail zodra je toegang hebt.")
                : t("\(store.user.email) has no access yet. Ask for it and you'll hear back by e-mail.", "\(store.user.email) heeft nog geen toegang. Vraag het aan en je hoort het per e-mail.")
        ) {
            VStack(spacing: 10) {
                if !requested {
                    PrimaryButton(title: t("Request access", "Toegang aanvragen")) { Task { await store.requestAccess() } }
                }
                OutlineButton(title: t("Sign out", "Uitloggen")) { Task { await session.signOut() } }
            }
            .frame(maxWidth: 260)
        }
    }
}

/// The web's `Empty`: an icon, a title, a line of text and what can be done.
struct EmptyState<Actions: View>: View {
    let icon: String
    let title: String
    let text: String
    @ViewBuilder var actions: Actions

    var body: some View {
        VStack(spacing: 0) {
            Icon(icon, size: 24)
                .foregroundStyle(Theme.foreground)
                .frame(width: 44, height: 44)
                .background(Theme.muted, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
                .padding(.bottom, 16)
            Text(title)
                .font(.inter(17, .medium, relativeTo: .headline))
                .foregroundStyle(Theme.foreground)
            Text(text)
                .font(.inter(14, relativeTo: .subheadline))
                .foregroundStyle(Theme.mutedForeground)
                .multilineTextAlignment(.center)
                .padding(.top, 6)
            actions.padding(.top, 20)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

extension EmptyState where Actions == EmptyView {
    init(icon: String, title: String, text: String) {
        self.init(icon: icon, title: title, text: text) { EmptyView() }
    }
}

/// What just happened, with a way back for moves (`sonner` toasts on the web).
struct ToastView: View {
    @Environment(MailStore.self) private var store

    var body: some View {
        if let toast = store.toast {
            HStack(spacing: 12) {
                if toast.isError { Icon("alert-02", size: 18).foregroundStyle(Theme.destructive) }
                Text(toast.message)
                    .font(.inter(14, relativeTo: .subheadline))
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(3)
                Spacer(minLength: 0)
                if toast.hasUndo {
                    Button(t("Undo", "Ongedaan maken")) { store.undo(toast) }
                        .font(.inter(14, .semibold, relativeTo: .subheadline))
                        .foregroundStyle(Theme.accentText)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 13)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.border))
            .shadow(color: .black.opacity(0.12), radius: 16, y: 6)
            .frame(maxWidth: 420)
            .padding(.horizontal, 16)
            .padding(.bottom, 64)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .id(toast.id)
            .accessibilityAddTraits(.isStaticText)
        }
    }
}
