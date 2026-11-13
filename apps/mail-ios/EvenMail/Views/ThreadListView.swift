import SwiftUI

/// A place's conversations (`pages/inbox.tsx`): pull to refresh, swipe to act.
struct ThreadListView: View {
    let place: Place

    @Environment(MailStore.self) private var store
    @Environment(Navigator.self) private var navigator
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var query = ""
    @State private var results: [MailThread]?
    @State private var searching = false
    @State private var searchError: String?

    private var list: ThreadList { store.list(place) }
    private var rows: [MailThread] { results ?? list.threads }
    private var compact: Bool { sizeClass == .compact }
    /// The dot that names the mailbox only helps when several share the list.
    private var showsMailbox: Bool { store.accountFilter.isEmpty && store.accounts.count > 1 }

    var body: some View {
        @Bindable var navigator = navigator
        List(selection: $navigator.selection) {
            if store.syncFailed, results == nil {
                Notice(icon: "cloud-alert", text: t("Could not fetch new mail. Pull down to try again.", "Nieuwe mail ophalen lukte niet. Trek omlaag om het opnieuw te proberen."))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12))
            }
            ForEach(rows) { thread in
                ThreadRow(
                    thread: thread,
                    mailbox: showsMailbox ? store.account(thread.accountId) : nil,
                    until: list.until[thread.id]
                )
                .tag(thread.id)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 1, leading: 8, bottom: 1, trailing: 8))
                .listRowBackground(
                    RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                        .fill(navigator.selection == thread.id && !compact ? Theme.accent : .clear)
                        .padding(.horizontal, 8)
                )
                .swipeActions(edge: .trailing, allowsFullSwipe: true) { trailing(thread) }
                .swipeActions(edge: .leading, allowsFullSwipe: true) { leading(thread) }
                .contextMenu { menu(thread) }
            }
            if results == nil, list.cursor != nil {
                HStack { Spacer(); ProgressView(); Spacer() }
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .task { await store.loadMore(place) }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .overlay { emptiness }
        .navigationTitle(place.title)
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: t("Search all mail", "Zoek in alle mail"))
        .onSubmit(of: .search) { Task { await search() } }
        .onChange(of: query) { _, text in
            if text.isEmpty {
                results = nil
                searchError = nil
            }
        }
        .refreshable { await store.refresh(place) }
        .toolbar {
            ToolbarItemGroup(placement: .bottomBar) {
                Spacer()
                Button { navigator.compose = ComposeRequest(mode: .new) } label: { Icon("pencil-edit-02", size: 22) }
                    .accessibilityLabel(t("New message", "Nieuw bericht"))
            }
        }
        .task(id: "\(place.rawValue)|\(store.accountFilter)") {
            store.showing(place)
            query = ""
            results = nil
            await store.load(place)
        }
        .onChange(of: navigator.selection) { _, id in open(id) }
    }

    @ViewBuilder
    private var emptiness: some View {
        if searching {
            ProgressView()
        } else if results != nil {
            if rows.isEmpty {
                EmptyState(icon: "search-01", title: t("Nothing found", "Niets gevonden"), text: searchError ?? t("No mail matches “\(query)”.", "Geen mail gevonden voor “\(query)”."))
            }
        } else if !list.loaded {
            if let error = list.error {
                EmptyState(icon: "cloud-alert", title: t("Could not load mail", "Mail laden lukte niet"), text: error)
            } else {
                ProgressView()
            }
        } else if store.accountsLoaded, store.accounts.isEmpty {
            EmptyState(
                icon: "mail-01",
                title: t("No mailboxes yet", "Nog geen mailboxen"),
                text: t("Connect a Gmail or Outlook mailbox on mail.jornboerema.nl to see your mail here.", "Koppel een Gmail- of Outlook-mailbox op mail.jornboerema.nl om je mail hier te zien.")
            ) {
                OutlineButton(title: t("Open Even mailen on the web", "Open Even mailen op het web"), icon: "arrow-up-right-01") {
                    UIApplication.shared.open(URL(string: "https://mail.jornboerema.nl")!)
                }
                .frame(maxWidth: 300)
            }
        } else if rows.isEmpty {
            EmptyState(icon: place.icon, title: place == .drafts ? t("No drafts", "Geen concepten") : t("No messages", "Geen berichten"), text: emptyText)
        }
    }

    private var emptyText: String {
        switch place {
        case .inbox: t("Nothing left to read. Enjoy.", "Niets meer te lezen. Geniet ervan.")
        case .drafts: t("A message becomes a draft as soon as you start on it.", "Een bericht wordt een concept zodra je eraan begint.")
        case .snoozed: t("Snoozed conversations wait here until they return.", "Uitgestelde gesprekken wachten hier tot ze terugkomen.")
        default: t("There's nothing here", "Hier staat niets")
        }
    }

    private func open(_ id: String?) {
        guard let id, let thread = rows.first(where: { $0.id == id }) else { return }
        if let draftId = thread.draftId {
            navigator.selection = nil
            navigator.compose = ComposeRequest(mode: .draft(accountId: thread.accountId, draftId: draftId))
            return
        }
        navigator.opened = thread
    }

    private func search() async {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        searching = true
        searchError = nil
        do { results = try await store.search(text) } catch {
            results = []
            searchError = errorText(error)
        }
        searching = false
    }

    private func act(_ action: ThreadAction, _ thread: MailThread) {
        navigator.act(action, on: thread, store: store, compact: compact)
    }

    private func canDelete(_ thread: MailThread) -> Bool { store.account(thread.accountId)?.canDeleteForever ?? false }

    @ViewBuilder
    private func trailing(_ thread: MailThread) -> some View {
        if thread.draftId == nil {
            let moves = place.moveActions(canDelete: canDelete(thread))
            ForEach(moves, id: \.self) { action in
                Button { act(action, thread) } label: { ActionLabel(action: action, place: place) }
                    .tint(action == .trash || action == .delete ? Theme.destructive : Theme.primary)
            }
        }
    }

    @ViewBuilder
    private func leading(_ thread: MailThread) -> some View {
        if thread.draftId == nil {
            Button { act(thread.isRead ? .unread : .read, thread) } label: { ActionLabel(action: thread.isRead ? .unread : .read, place: place) }
                .tint(Color(oklch(0.55, 0.02, 260)))
            Button { act(thread.isStarred ? .unstar : .star, thread) } label: { ActionLabel(action: thread.isStarred ? .unstar : .star, place: place) }
                .tint(Theme.starred)
        }
    }

    @ViewBuilder
    private func menu(_ thread: MailThread) -> some View {
        if thread.draftId == nil {
            Button { act(thread.isRead ? .unread : .read, thread) } label: { ActionLabel(action: thread.isRead ? .unread : .read, place: place) }
            Button { act(thread.isStarred ? .unstar : .star, thread) } label: { ActionLabel(action: thread.isStarred ? .unstar : .star, place: place) }
            if place == .snoozed {
                Button { Task { await store.unsnooze(thread) } } label: {
                    Label { Text(t("Back to inbox now", "Nu terug naar inbox")) } icon: { Image("hi-alarm-clock-off") }
                }
            } else if place == .inbox {
                Button { navigator.snoozing = SnoozeRequest(thread: thread) } label: {
                    Label { Text(t("Snooze", "Uitstellen")) } icon: { Image("hi-alarm-clock") }
                }
            }
            Divider()
            ForEach(place.moveActions(canDelete: canDelete(thread)), id: \.self) { action in
                Button(role: action == .trash || action == .delete ? .destructive : nil) { act(action, thread) } label: { ActionLabel(action: action, place: place) }
            }
            if place.canReportSpam {
                Button(role: .destructive) { act(.spam, thread) } label: { ActionLabel(action: .spam, place: place) }
            }
        }
    }
}

extension ThreadAction {
    var icon: String {
        switch self {
        case .read: "mail-open-01"
        case .unread: "mail-01"
        case .archive: "archive"
        case .trash: "delete-02"
        case .star: "star"
        case .unstar: "star"
        case .inbox: "inbox"
        case .spam: "spam"
        case .delete: "delete-04"
        }
    }

    /// The words for it; moving back names where it goes (`moveLabel` on the web).
    func label(in place: Place) -> String {
        switch self {
        case .read: t("Mark as read", "Markeer als gelezen")
        case .unread: t("Mark as unread", "Markeer als ongelezen")
        case .archive: t("Archive", "Archiveren")
        case .trash: t("Move to trash", "Naar prullenbak")
        case .star: t("Star", "Ster toevoegen")
        case .unstar: t("Remove star", "Ster verwijderen")
        case .inbox: place == .spam ? t("Not spam", "Geen spam") : t("Move to inbox", "Naar inbox")
        case .spam: t("Report spam", "Spam melden")
        case .delete: t("Delete for good", "Definitief verwijderen")
        }
    }
}

struct ActionLabel: View {
    let action: ThreadAction
    let place: Place

    var body: some View {
        Label { Text(action.label(in: place)) } icon: { Image("hi-\(action.icon)").renderingMode(.template) }
    }
}

/// A quiet line above a list when something needs saying.
struct Notice: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Icon(icon, size: 18).foregroundStyle(Theme.mutedForeground)
            Text(text)
                .font(.inter(13, relativeTo: .footnote))
                .foregroundStyle(Theme.mutedForeground)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(Theme.muted, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
    }
}

/// One conversation (`ThreadRow` in `pages/inbox.tsx`): who and when on the
/// first line, subject and the start of the text below; unread mail is bold
/// with a dot in the gutter.
struct ThreadRow: View {
    let thread: MailThread
    /// Only set when several mailboxes share the list.
    let mailbox: MailAccount?
    /// When it comes back, in the Snoozed list.
    var until: Date?

    private var unread: Bool { !thread.isRead }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Circle()
                .fill(unread ? Theme.accentText : .clear)
                .frame(width: 7, height: 7)
                .frame(width: 24, height: 22)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    (Text(thread.who)
                        .font(.inter(16, unread ? .semibold : .regular))
                        .foregroundStyle(unread ? Theme.foreground : Theme.mutedForeground)
                        + Text(thread.messageCount > 1 ? "  \(thread.messageCount)" : "")
                        .font(.inter(13, relativeTo: .footnote))
                        .foregroundStyle(Theme.mutedForeground))
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if thread.isStarred {
                        Icon("star-filled", size: 14).foregroundStyle(Theme.starred)
                            .accessibilityLabel(t("Starred", "Met ster"))
                    }
                    if thread.hasAttachments {
                        Icon("attachment-01", size: 14).foregroundStyle(Theme.mutedForeground)
                            .accessibilityLabel(t("Has attachment", "Heeft bijlage"))
                    }
                    Text(until.map { formatMoment($0) } ?? shortDate(thread.receivedAt))
                        .font(.inter(12.5, relativeTo: .caption))
                        .monospacedDigit()
                        .foregroundStyle(until == nil ? Theme.mutedForeground : Theme.accentText)
                        .layoutPriority(1)
                }
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    (Text(thread.title)
                        .font(.inter(14.5, unread ? .medium : .regular, relativeTo: .subheadline))
                        .foregroundStyle(unread ? Theme.foreground : Theme.mutedForeground)
                        + Text(thread.snippet.isEmpty ? "" : " · \(thread.snippet)")
                        .font(.inter(14.5, relativeTo: .subheadline))
                        .foregroundStyle(Theme.mutedForeground))
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let mailbox {
                        AccountDot(color: mailbox.color)
                            .accessibilityLabel(mailbox.email)
                    }
                }
            }
        }
        .padding(.vertical, 9)
        .padding(.trailing, 12)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(unread ? t("Unread", "Ongelezen") + ": " : "")\(thread.who), \(thread.title)")
    }
}
