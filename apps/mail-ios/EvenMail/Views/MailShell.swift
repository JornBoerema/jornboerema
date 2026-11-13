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
    /// A suggested reply to start from, as plain text.
    var prefill: String?
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
    /// A conversation opened from a place that isn't a list of conversations,
    /// shown on top of it.
    var reading: MailThread?
    var todo: MailThread?

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
        if leaves, reading?.id == thread.id { reading = nil }
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
                if !access.access {
                    AccessView(requested: access.requested)
                } else if Demo.enabled, ProcessInfo.processInfo.environment["EVEN_SHOW"] == "places" {
                    // For `scripts/shot.sh` on a phone, where the sidebar is a screen of its own.
                    NavigationStack { SidebarView() }
                } else {
                    MailShell()
                }
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
            PlaceView(place: navigator.shownPlace)
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
        .sheet(item: $navigator.todo) { thread in
            TodoSheet(thread: thread).environment(store).presentationDetents([.medium, .large])
        }
        .sheet(item: $navigator.reading) { thread in
            NavigationStack { ConversationView(thread: thread, inSheet: true) }
                .environment(store)
                .environment(navigator)
        }
        .onChange(of: navigator.place) { _, place in
            store.showing(place ?? .inbox)
        }
        .task { await Push.shared.start() }
        .task(id: Push.shared.opened) { await openTapped() }
        .onChange(of: store.unreadCount, initial: true) { _, count in Push.shared.setBadge(count) }
        .task {
            // After the first layout, as a tap would be.
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            showForScreenshot()
        }
    }
}

extension MailShell {
    /// Opens the conversation a tapped notification is about: in the inbox when
    /// it is listed there, otherwise on top of whatever is showing.
    private func openTapped() async {
        guard let tapped = Push.shared.opened else { return }
        Push.shared.opened = nil
        await store.load(.inbox)
        if let thread = store.list(.inbox).threads.first(where: { $0.id == tapped.thread }) ?? store.pinned.first(where: { $0.id == tapped.thread }) {
            navigator.compose = nil
            navigator.place = .inbox
            navigator.opened = thread
            navigator.selection = thread.id
            compact = .detail
            return
        }
        // Not in the first page (or a filter hides it): the notification's own words stand in.
        navigator.reading = MailThread(
            id: tapped.thread, accountId: "", subject: tapped.subject, snippet: tapped.snippet,
            fromName: tapped.sender, fromEmail: nil, receivedAt: Date(), isRead: false, isStarred: false,
            hasAttachments: false, messageCount: 1, to: nil
        )
    }

    /// For `scripts/shot.sh`, which can't tap: `EVEN_SHOW` opens a screen of the
    /// demo. Only with made-up mail, never in a real session.
    private func showForScreenshot() {
        guard Demo.enabled, let show = ProcessInfo.processInfo.environment["EVEN_SHOW"] else { return }
        let thread = Demo.threads[2]
        let message = Demo.detail(thread.id).messages.last!
        switch show {
        case "sidebar": visibility = .all
        case "conversation":
            navigator.selection = thread.id
            navigator.opened = thread
            compact = .detail
        case "compose": navigator.compose = ComposeRequest(mode: .new)
        case "reply": navigator.compose = ComposeRequest(mode: .reply(thread: thread, message: message, all: false))
        case "ai": navigator.compose = ComposeRequest(mode: .reply(thread: thread, message: message, all: false), prefill: "ai")
        case "snooze": navigator.snoozing = SnoozeRequest(thread: thread)
        case "settings": navigator.settings = true
        case "parcels": navigator.place = .parcels
        case "invoices": navigator.place = .invoices
        case "senders": navigator.place = .senders
        case "todo": navigator.todo = thread
        case "attach": navigator.compose = ComposeRequest(mode: .new, prefill: "attach")
        case "toast": store.act(.archive, on: [Demo.threads[0]], in: .inbox)
        default: break
        }
    }
}

/// The places and mailboxes (`components/sidebar.tsx`, `packages/ui/src/styles/sidebar.css`).
/// Every row is a `list-link`: the icon in one column, the words in the next,
/// a count at the end, so places, mailboxes and the account line up.
struct SidebarView: View {
    @Environment(MailStore.self) private var store
    @Environment(Navigator.self) private var navigator
    @Environment(\.horizontalSizeClass) private var sizeClass

    /// Where a row's content starts, and the room its rounded background keeps from the edge.
    private static let inset: CGFloat = 12
    private static let rowInsets = EdgeInsets(top: 1, leading: inset, bottom: 1, trailing: inset)

    var body: some View {
        @Bindable var navigator = navigator
        List(selection: $navigator.place) {
            HStack(spacing: 10) {
                Image("Brand").resizable().frame(width: 28, height: 28)
                Text("Even mailen")
                    .font(.inter(21, .semibold, relativeTo: .title3))
                    .tracking(-0.6)
                    .foregroundStyle(Theme.foreground)
            }
            .padding(.leading, 12)
            .padding(.top, sizeClass == .compact ? 14 : 2)
            .padding(.bottom, 18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .sidebarRow(insets: Self.rowInsets)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)

            Button { navigator.compose = ComposeRequest(mode: .new) } label: {
                SidebarRow(selected: false) {
                    Icon("pencil-edit-02", size: 20).foregroundStyle(Theme.mutedForeground)
                } label: {
                    Text(t("New message", "Nieuw bericht"))
                }
            }
            .buttonStyle(.plain)
            .sidebarRow(insets: Self.rowInsets)
            .padding(.bottom, 10)

            ForEach(store.places) { place in
                let selected = navigator.place == place
                SidebarRow(selected: selected, count: count(place)) {
                    Icon(place.icon, size: 20).foregroundStyle(selected ? Theme.accentText : Theme.mutedForeground)
                } label: {
                    Text(place.title)
                }
                .tag(place)
                .sidebarRow(insets: Self.rowInsets)
            }

            if store.accounts.count > 1 {
                Text(t("Mailboxes", "Mailboxen"))
                    .font(.inter(13, relativeTo: .footnote))
                    .foregroundStyle(Theme.mutedForeground)
                    .padding(.leading, 12)
                    .padding(.top, 22)
                    .padding(.bottom, 4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .sidebarRow(insets: Self.rowInsets)
                    .accessibilityAddTraits(.isHeader)
                mailbox(id: "", label: t("All mailboxes", "Alle mailboxen"), color: nil)
                ForEach(store.accounts) { account in
                    mailbox(id: account.id, label: account.email, color: account.color, needsReconnect: !account.isActive)
                }
            }
        }
        .listStyle(.plain)
        .environment(\.defaultMinListRowHeight, 0)
        .scrollContentBackground(.hidden)
        .background(Theme.sidebar)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        // On a phone the sidebar is a screen of its own and needs no bar; on a
        // tablet the bar holds the button that folds the sidebar away.
        .toolbar(sizeClass == .compact ? .hidden : .automatic, for: .navigationBar)
        .safeAreaInset(edge: .bottom, spacing: 0) { account }
    }

    /// The signed-in user, at the foot as on the web; opens the settings.
    private var account: some View {
        Button { navigator.settings = true } label: {
            HStack(spacing: 12) {
                Text(String((store.user.name ?? store.user.email).trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
                    .font(.inter(14, .semibold, relativeTo: .subheadline))
                    .foregroundStyle(Theme.primaryForeground)
                    .frame(width: 32, height: 32)
                    .background(Theme.primary, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    Text(store.user.name ?? store.user.email)
                        .font(.inter(15, .medium, relativeTo: .subheadline))
                        .foregroundStyle(Theme.foreground)
                    if store.user.name != nil {
                        Text(store.user.email)
                            .font(.inter(12.5, relativeTo: .caption))
                            .foregroundStyle(Theme.mutedForeground)
                    }
                }
                .lineLimit(1)
                Spacer(minLength: 0)
                Icon("settings-01", size: 20).foregroundStyle(Theme.mutedForeground)
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, Self.inset)
        .padding(.top, 8)
        .padding(.bottom, 4)
        .background(Theme.sidebar.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(Theme.border).frame(height: 1) }
        .accessibilityLabel(t("Settings and account, \(store.user.email)", "Instellingen en account, \(store.user.email)"))
    }

    private func count(_ place: Place) -> Int {
        switch place {
        case .inbox: store.unreadCount
        case .snoozed: store.snoozedCount
        case .scheduled: store.scheduledCount
        default: 0
        }
    }

    private func mailbox(id: String, label: String, color: Int?, needsReconnect: Bool = false) -> some View {
        let selected = store.accountFilter == id
        return Button {
            guard store.accountFilter != id else { return }
            store.accountFilter = id
            Task { await store.load(navigator.shownPlace) }
        } label: {
            SidebarRow(selected: false, trailing: selected ? "tick-02" : nil) {
                if needsReconnect {
                    Icon("alert-02", size: 20).foregroundStyle(Theme.destructive)
                } else if let color {
                    AccountDot(color: color, size: 10)
                } else {
                    Icon("layers-01", size: 20).foregroundStyle(Theme.mutedForeground)
                }
            } label: {
                Text(label).fontWeight(selected ? .medium : .regular)
            }
        }
        .buttonStyle(.plain)
        .sidebarRow(insets: Self.rowInsets)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityHint(needsReconnect ? t("Needs reconnecting", "Opnieuw koppelen nodig") : "")
    }
}

/// One line of the sidebar: icon column, words, and a count or mark at the end.
private struct SidebarRow<Leading: View, Label: View>: View {
    let selected: Bool
    var count = 0
    var trailing: String?
    @ViewBuilder var leading: Leading
    @ViewBuilder var label: Label

    var body: some View {
        HStack(spacing: 12) {
            leading.frame(width: 22, height: 22)
            label
                .font(.inter(16, selected ? .medium : .regular))
                .foregroundStyle(Theme.foreground)
                .lineLimit(1)
            Spacer(minLength: 8)
            if count > 0 {
                Text("\(count)")
                    .font(.inter(13, relativeTo: .footnote))
                    .monospacedDigit()
                    .foregroundStyle(Theme.mutedForeground)
            }
            if let trailing { Icon(trailing, size: 18).foregroundStyle(Theme.accentText) }
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 46)
        .background(selected ? Theme.accent : .clear, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
        .contentShape(Rectangle())
    }
}

private extension View {
    /// A list row that draws nothing of its own: no separator, no system highlight.
    func sidebarRow(insets: EdgeInsets) -> some View {
        listRowSeparator(.hidden)
            .listRowInsets(insets)
            .listRowBackground(Color.clear)
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
