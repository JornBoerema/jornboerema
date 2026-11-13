import Foundation
import SwiftUI

/// What a list shows: conversations, and where the next page starts.
struct ThreadList {
    var threads: [MailThread] = []
    var cursor: String?
    var loaded = false
    var loading = false
    var loadingMore = false
    var error: String?
    /// When each snoozed conversation comes back, by its id.
    var until: [String: Date] = [:]
}

struct Toast: Identifiable, Equatable {
    let id = UUID()
    let message: String
    var isError = false
    var hasUndo = false

    static func == (a: Toast, b: Toast) -> Bool { a.id == b.id }
}

/// A draft as a list line; opening one starts the composer instead of the reader.
let draftPrefix = "draft:"

/// The mail of the signed-in user: mailboxes, lists, conversations and what is
/// done to them. The web keeps this in its query cache (`lib/mail.ts`); the
/// rules are the same: the screen changes first and the server after it.
@Observable
@MainActor
final class MailStore {
    let user: SessionUser

    var access: Access?
    var accessError: String?
    var accounts: [MailAccount] = []
    var accountsLoaded = false
    /// The mailbox the lists show; empty for all of them.
    var accountFilter = ""
    var lists: [String: ThreadList] = [:]
    var unreadCount = 0
    var snoozedCount = 0
    var preferences = MailPreferences()
    var signatures: [MailSignature] = []
    /// Conversations pinned to the top of the inbox, for the mailbox shown.
    var pinned: [MailThread] = []
    var connections: [Connection] = []
    var scheduledCount = 0
    var syncing = false
    var syncFailed = false
    var toast: Toast?

    private var details: [String: ThreadDetail] = [:]
    private var summaries: [String: MailSummary] = [:]
    /// Moves that can still be taken back: what to send when the moment passes.
    private var pending: [UUID: () async -> Void] = [:]
    private var timers: [UUID: Task<Void, Never>] = [:]
    private var toastTimer: Task<Void, Never>?
    private var ticker: Task<Void, Never>?
    private var lastSync = Date.distantPast

    /// How long a move can be taken back before it reaches the provider (`UNDO_MS`).
    private let undoSeconds: UInt64 = 5

    init(user: SessionUser) {
        self.user = user
    }

    // MARK: Start

    func start() async {
        if Demo.enabled {
            access = Access(access: true, requested: false)
            accounts = Demo.accounts
            accountsLoaded = true
            lists[key(.inbox)] = ThreadList(threads: Demo.threads, loaded: true)
            unreadCount = Demo.threads.filter { !$0.isRead }.count
            return
        }
        await checkAccess()
        guard access?.access == true else { return }
        async let accounts: Void = loadAccounts()
        async let preferences: Void = loadPreferences()
        async let first: Void = load(.inbox)
        _ = await (accounts, preferences, first)
        await refreshCounts()
        await sync()
        watch()
    }

    func checkAccess() async {
        do {
            access = try await API.get("/api/access/mail")
            accessError = nil
        } catch {
            accessError = errorText(error)
        }
    }

    func requestAccess() async {
        do { access = try await API.post("/api/access/mail/request") } catch { show(error) }
    }

    private struct Accounts: Decodable { let accounts: [MailAccount] }
    private struct Preferences: Decodable { let preferences: MailPreferences }
    private struct Signatures: Decodable { let signatures: [MailSignature] }

    /// The signature a mailbox adds to new mail or to replies, if it has one.
    func signature(for account: MailAccount?, reply: Bool) -> MailSignature? {
        let id = reply ? account?.signatures?.replyId : account?.signatures?.newId
        return signatures.first { $0.id == id }
    }

    func loadAccounts() async {
        do {
            let answer: Accounts = try await API.get("/api/mail/accounts")
            accounts = answer.accounts
            accountsLoaded = true
            if !accountFilter.isEmpty, !accounts.contains(where: { $0.id == accountFilter }) { accountFilter = "" }
        } catch {
            if !accountsLoaded { show(error) }
        }
    }

    private func loadPreferences() async {
        if let answer: Preferences = try? await API.get("/api/mail/preferences") { preferences = answer.preferences }
        if let answer: Signatures = try? await API.get("/api/mail/signatures") { signatures = answer.signatures }
        if let answer: Connections = try? await API.get("/api/connections") { connections = answer.connections }
    }

    private struct Connections: Decodable { let connections: [Connection] }
    private struct Threads: Decodable { let threads: [MailThread] }
    private struct ScheduledList: Decodable { let scheduled: [ScheduledMail] }

    /// Moneybird when it is connected and usable.
    var moneybird: Connection? { connections.first { $0.provider == "moneybird" && $0.status == "active" } }

    /// The places of the sidebar: in the order set on the web, without the
    /// hidden ones and the features that are turned off.
    var places: [Place] {
        let layout = preferences.sidebar
        var order = ((layout?.main ?? []) + (layout?.more ?? [])).compactMap(Place.init(rawValue:))
        let hidden = Set((layout?.hidden ?? []).compactMap(Place.init(rawValue:)))
        for place in Place.allCases where !order.contains(place) && !hidden.contains(place) { order.append(place) }
        if layout == nil { order = Place.allCases }
        return order.filter { place in
            switch place {
            case .parcels: preferences.parcels != false
            case .invoices: preferences.invoices != false
            case .senders: preferences.senders != false
            default: true
            }
        }
    }

    // MARK: Pins

    var pinsEnabled: Bool { preferences.pins != false }

    func loadPins() async {
        guard !Demo.enabled, pinsEnabled else { return }
        let query = accountFilter.isEmpty ? "" : "?account=\(accountFilter.queryEncoded)"
        if let answer: Threads = try? await API.get("/api/mail/pins\(query)") { pinned = answer.threads }
    }

    private struct PinBody: Encodable { let pinned: Bool }

    /// Pins or unpins, moving the line at once.
    func pin(_ thread: MailThread, _ on: Bool) {
        withAnimation(.snappy(duration: 0.28)) {
            pinned.removeAll { $0.id == thread.id }
            if on { pinned = (pinned + [thread]).sorted { $0.receivedAt > $1.receivedAt } }
        }
        guard !Demo.enabled else { return }
        Task {
            do { try await API.run("/api/mail/threads/\(thread.id.queryEncoded)/pin", PinBody(pinned: on)) } catch { show(error) }
            await loadPins()
        }
    }

    func account(_ id: String) -> MailAccount? { accounts.first { $0.id == id } }

    /// The mailbox new mail is written from: the one shown, or the first.
    var defaultAccount: MailAccount? {
        account(accountFilter) ?? accounts.first(where: \.isActive) ?? accounts.first
    }

    // MARK: Lists

    func key(_ place: Place) -> String { "\(accountFilter)|\(place.rawValue)" }

    func list(_ place: Place) -> ThreadList { lists[key(place)] ?? ThreadList() }

    private func place(of key: String) -> Place {
        Place(rawValue: String(key.split(separator: "|", omittingEmptySubsequences: false).last ?? "")) ?? .inbox
    }

    private func listPath(_ place: Place, cursor: String? = nil) -> String {
        var query: [String] = []
        if let folder = place.folder { query.append("folder=\(folder)") }
        if !accountFilter.isEmpty { query.append("account=\(accountFilter.queryEncoded)") }
        if let cursor { query.append("cursor=\(cursor.queryEncoded)") }
        return "/api/mail/threads" + (query.isEmpty ? "" : "?" + query.joined(separator: "&"))
    }

    /// Loads a list's first page. Further pages already shown stay below it.
    func load(_ place: Place) async {
        guard !Demo.enabled, !place.isSpecial else { return }
        if place == .inbox { Task { await loadPins() } }
        let key = key(place)
        let filter = accountFilter
        var current = lists[key] ?? ThreadList()
        guard !current.loading else { return }
        current.loading = true
        lists[key] = current
        do {
            var next = lists[key] ?? ThreadList()
            switch place {
            case .snoozed:
                let answer: Snoozes = try await API.get("/api/mail/snoozes")
                let shown = answer.snoozed.filter { filter.isEmpty || $0.thread.accountId == filter }
                next.threads = shown.map(\.thread)
                next.until = Dictionary(shown.map { ($0.thread.id, $0.until) }, uniquingKeysWith: { first, _ in first })
                next.cursor = nil
                snoozedCount = answer.snoozed.count
            case .drafts:
                let answer: DraftList = try await API.get("/api/mail/drafts")
                next.threads = answer.drafts.filter { filter.isEmpty || $0.accountId == filter }.map(MailThread.init(draft:))
                next.cursor = nil
            default:
                let page: ThreadsPage = try await API.get(listPath(place))
                let fresh = Set(page.threads.map(\.id))
                // Pages loaded before stay, below what the first page now holds.
                let oldest = page.threads.last?.receivedAt ?? .distantPast
                let rest = next.cursor == nil && next.loaded && next.threads.count <= page.threads.count
                    ? []
                    : next.threads.filter { !fresh.contains($0.id) && $0.receivedAt < oldest }
                next.threads = page.threads + rest
                if rest.isEmpty { next.cursor = page.nextCursor }
            }
            next.loaded = true
            next.loading = false
            next.error = nil
            // A move still waiting must not come back with the fresh list.
            next.threads.removeAll { leaving.contains($0.id) }
            lists[key] = next
        } catch {
            var failed = lists[key] ?? ThreadList()
            failed.loading = false
            failed.error = failed.loaded ? nil : errorText(error)
            lists[key] = failed
        }
    }

    func loadMore(_ place: Place) async {
        let key = key(place)
        guard var current = lists[key], let cursor = current.cursor, !current.loadingMore else { return }
        current.loadingMore = true
        lists[key] = current
        let page: ThreadsPage? = try? await API.get(listPath(place, cursor: cursor))
        guard var next = lists[key] else { return }
        next.loadingMore = false
        if let page {
            let known = Set(next.threads.map(\.id))
            next.threads += page.threads.filter { !known.contains($0.id) }
            next.cursor = page.nextCursor
        }
        lists[key] = next
    }

    func refreshCounts() async {
        guard !Demo.enabled else { return }
        if let unread: UnreadSummary = try? await API.get("/api/mail/unread") { unreadCount = unread.count }
        if let snoozes: Snoozes = try? await API.get("/api/mail/snoozes") { snoozedCount = snoozes.snoozed.count }
        if let answer: ScheduledList = try? await API.get("/api/mail/scheduled") { scheduledCount = answer.scheduled.count }
    }

    // MARK: Sync

    /// Asks the server to fetch what is new for every active mailbox. New mail
    /// normally arrives there through webhooks; this is the safety net, and what
    /// pulling the list down does.
    func sync() async {
        guard !Demo.enabled, !syncing else { return }
        syncing = true
        lastSync = Date()
        var failed = false
        await withTaskGroup(of: Bool.self) { group in
            for account in accounts where account.isActive {
                group.addTask {
                    // Each call does what fits in one run; `done` says it caught up.
                    for _ in 0..<20 {
                        guard let result: SyncResult = try? await API.post("/api/mail/accounts/\(account.id)/sync") else { return false }
                        if result.done || result.rateLimited { return true }
                        if result.busy { try? await Task.sleep(nanoseconds: 3_000_000_000) }
                    }
                    return true
                }
            }
            for await ok in group where !ok { failed = true }
        }
        syncing = false
        syncFailed = failed && !API.blocksWrites
    }

    /// Without a live connection the phone looks again now and then while open.
    private func watch() {
        ticker?.cancel()
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 45_000_000_000)
                guard let self, !Task.isCancelled else { return }
                await self.tick()
            }
        }
    }

    private var active = true
    private(set) var shownPlace: Place = .inbox

    func showing(_ place: Place) { shownPlace = place }

    private func tick() async {
        guard active else { return }
        if Date().timeIntervalSince(lastSync) > 5 * 60 { await sync() }
        await load(shownPlace)
        await refreshCounts()
    }

    /// The app came to the front, or left it.
    func setActive(_ active: Bool) async {
        self.active = active
        guard !Demo.enabled else { return }
        if active {
            guard accountsLoaded else { return }
            await loadAccounts()
            await sync()
            await load(shownPlace)
            await refreshCounts()
        } else {
            // Leaving doesn't take anything back: what was waiting goes now.
            await flush()
        }
    }

    func refresh(_ place: Place) async {
        await sync()
        await load(place)
        await refreshCounts()
    }

    // MARK: Actions

    /// Ids on their way out of the lists, so a reload doesn't bring them back.
    private var leaving: Set<String> = []

    private struct ActionBody: Encodable { let action: String }
    private struct SnoozeBody: Encodable { let until: Date }

    /// Acts on conversations shown in `place`. Moves wait a moment so they can be
    /// taken back; marks and stars go at once.
    func act(_ action: ThreadAction, on threads: [MailThread], in place: Place, until: Date? = nil) {
        let ids = threads.map(\.id).filter { !$0.hasPrefix(draftPrefix) }
        guard !ids.isEmpty else { return }
        let moves = until != nil || [.archive, .trash, .inbox, .spam, .delete].contains(action)
        if until != nil || [.archive, .trash, .spam, .delete].contains(action) { pinned.removeAll { ids.contains($0.id) } }
        for index in pinned.indices where ids.contains(pinned[index].id) {
            switch action {
            case .read: pinned[index].isRead = true
            case .unread: pinned[index].isRead = false
            case .star: pinned[index].isStarred = true
            case .unstar: pinned[index].isStarred = false
            default: break
            }
        }
        withAnimation(.snappy(duration: 0.25)) {
            for key in lists.keys {
                guard var list = lists[key] else { continue }
                let leaves = until != nil || self.place(of: key).leaves(action)
                if leaves {
                    list.threads.removeAll { ids.contains($0.id) }
                } else {
                    for index in list.threads.indices where ids.contains(list.threads[index].id) {
                        switch action {
                        case .read: list.threads[index].isRead = true
                        case .unread: list.threads[index].isRead = false
                        case .star: list.threads[index].isStarred = true
                        case .unstar: list.threads[index].isStarred = false
                        default: break
                        }
                    }
                }
                lists[key] = list
            }
        }
        if action == .read || action == .unread {
            let change = threads.filter { $0.isRead != (action == .read) }.count
            unreadCount = max(0, unreadCount + (action == .read ? -change : change))
        }
        let send: () async -> Void = { [weak self] in
            guard !Demo.enabled else { return }
            await withTaskGroup(of: Error?.self) { group in
                for id in ids {
                    group.addTask {
                        do {
                            if let until { try await API.run(conversationPath(id, "/snooze"), SnoozeBody(until: until)) }
                            else { try await API.run(conversationPath(id, "/actions"), ActionBody(action: action.rawValue)) }
                            return nil
                        } catch { return error }
                    }
                }
                for await error in group {
                    if let error { await self?.failed(error) }
                }
            }
            await self?.settled(ids)
        }

        guard moves else {
            Task { await send() }
            return
        }
        leaving.formUnion(ids)
        let message: String
        if let until {
            let moment = formatMoment(until)
            message = t("Snoozed until \(moment)", "Uitgesteld tot \(moment)")
        } else {
            message = doneMessage(action, count: ids.count)
        }
        let toast = Toast(message: message, hasUndo: true)
        let id = toast.id
        pending[id] = send
        timers[id] = Task { [weak self] in
            try? await Task.sleep(nanoseconds: (self?.undoSeconds ?? 5) * 1_000_000_000)
            guard !Task.isCancelled else { return }
            await self?.go(id)
        }
        present(toast)
    }

    private func doneMessage(_ action: ThreadAction, count: Int) -> String {
        let many = count > 1
        switch action {
        case .archive: return many ? t("\(count) conversations archived", "\(count) gesprekken gearchiveerd") : t("Archived", "Gearchiveerd")
        case .trash: return many ? t("\(count) conversations moved to trash", "\(count) gesprekken naar prullenbak") : t("Moved to trash", "Naar prullenbak verplaatst")
        case .inbox: return many ? t("\(count) conversations moved to inbox", "\(count) gesprekken naar inbox") : t("Moved to inbox", "Naar inbox verplaatst")
        case .spam: return many ? t("\(count) conversations reported as spam", "\(count) gesprekken als spam gemeld") : t("Reported as spam", "Als spam gemeld")
        case .delete: return many ? t("\(count) conversations deleted", "\(count) gesprekken verwijderd") : t("Deleted for good", "Definitief verwijderd")
        default: return ""
        }
    }

    private func go(_ id: UUID) async {
        timers[id] = nil
        guard let send = pending.removeValue(forKey: id) else { return }
        if toast?.id == id { dismissToast() }
        await send()
    }

    /// Takes back the move the toast speaks of: nothing was sent, so the lists
    /// simply come back from the server.
    func undo(_ toast: Toast) {
        timers.removeValue(forKey: toast.id)?.cancel()
        guard pending.removeValue(forKey: toast.id) != nil else { return }
        dismissToast()
        leaving.removeAll()
        Task {
            await load(shownPlace)
            await refreshCounts()
        }
    }

    /// Sends everything still waiting, now.
    func flush() async {
        for id in Array(pending.keys) {
            timers.removeValue(forKey: id)?.cancel()
            await go(id)
        }
    }

    private func settled(_ ids: [String]) async {
        leaving.subtract(ids)
        guard pending.isEmpty else { return }
        await refreshCounts()
        if shownPlace == .snoozed { await load(.snoozed) }
    }

    private func failed(_ error: Error) async {
        show(error)
        await load(shownPlace)
    }

    func unsnooze(_ thread: MailThread) async {
        withAnimation { lists[key(.snoozed)]?.threads.removeAll { $0.id == thread.id } }
        do {
            try await API.run(conversationPath(thread.id, "/snooze"), method: "DELETE")
            present(Toast(message: t("Back in the inbox", "Terug in de inbox")))
        } catch { show(error) }
        await load(.inbox)
        await refreshCounts()
    }

    // MARK: Reading

    func cachedDetail(_ id: String) -> ThreadDetail? { details[id] }

    func detail(_ id: String, fresh: Bool = false) async throws -> ThreadDetail {
        if Demo.enabled { return Demo.detail(id) }
        if !fresh, let kept = details[id] { return kept }
        let detail: ThreadDetail = try await API.get(conversationPath(id))
        // Kept in memory only, and only a handful: mail bodies are never stored.
        if details.count > 20 { details.removeAll() }
        details[id] = detail
        return detail
    }

    func summary(_ id: String) async -> MailSummary? {
        if Demo.enabled { return Demo.summary }
        // Each can be off on its own; with both off nothing is asked at all.
        let model = preferences.summaries != false
        let codes = preferences.codes != false
        guard model || codes else { return nil }
        if let kept = summaries[id] { return kept }
        let path = conversationPath(id, "/summary")
        let off = [model ? nil : "ai=0", codes ? nil : "codes=0"].compactMap { $0 }.joined(separator: "&")
        let url = off.isEmpty ? path : "\(path)\(path.contains("?") ? "&" : "?")\(off)"
        guard let summary: MailSummary = try? await API.get(url) else { return nil }
        summaries[id] = summary
        return summary
    }

    private struct Replies: Decodable { let replies: [ReplySuggestion] }

    /// Three replies to start from, when the newest message asks for an answer.
    func replies(_ id: String) async -> [ReplySuggestion] {
        if Demo.enabled { return Demo.replies }
        guard preferences.replySuggestions != false else { return [] }
        let answer: Replies? = try? await API.get(conversationPath(id, "/replies"))
        return answer?.replies ?? []
    }

    /// One message in the reader's language; asked for on request, never kept.
    func translation(thread: String, message: String) async throws -> MailTranslation {
        if Demo.enabled { return Demo.translation }
        let path = conversationPath(thread, "/translation")
        return try await API.get("\(path)\(path.contains("?") ? "&" : "?")message=\(message.queryEncoded)")
    }

    var aiWriting: Bool { preferences.aiWriting != false }

    private struct AttachmentBody: Encodable {
        let messageId: String
        let attachmentId: String
    }

    /// Downloads a file to a temporary place and answers where it is.
    func download(_ attachment: MailAttachment, message: MailMessage, thread: String) async throws -> URL {
        let data = try await API.bytes(conversationPath(thread, "/attachment"), AttachmentBody(messageId: message.id, attachmentId: attachment.id))
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        // Only the last part of the name: a stranger chose it.
        let name = attachment.name.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? "file"
        let url = folder.appendingPathComponent(name)
        try data.write(to: url, options: .completeFileProtection)
        return url
    }

    func inlineImage(_ image: MailInlineImage, message: MailMessage, thread: String) async -> Data? {
        try? await API.bytes(conversationPath(thread, "/attachment"), AttachmentBody(messageId: message.id, attachmentId: image.id))
    }

    // MARK: Search

    func search(_ query: String) async throws -> [MailThread] {
        if Demo.enabled { return Demo.threads.filter { "\($0.subject) \($0.fromName ?? "")".localizedCaseInsensitiveContains(query) } }
        let result: SearchResult = try await API.get("/api/mail/search?q=\(query.queryEncoded)")
        return result.hits.map(MailThread.init(hit:))
    }

    private struct Contacts: Decodable { let contacts: [Contact] }

    func contacts(_ query: String) async -> [Contact] {
        guard !Demo.enabled else { return [] }
        let answer: Contacts? = try? await API.get("/api/mail/contacts?q=\(query.queryEncoded)")
        return answer?.contacts ?? []
    }

    // MARK: Writing

    /// Syncs these mailboxes a moment after sending, so the message is in Sent (`syncSoon`).
    func syncSoon() {
        Task {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            await sync()
            await load(shownPlace)
        }
    }

    func forget(detail id: String) { details[id] = nil }

    // MARK: Toasts

    func present(_ toast: Toast) {
        toastTimer?.cancel()
        withAnimation(.snappy(duration: 0.25)) { self.toast = toast }
        let seconds: UInt64 = toast.hasUndo ? undoSeconds : 3
        toastTimer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: seconds * 1_000_000_000)
            guard !Task.isCancelled else { return }
            if self?.toast?.id == toast.id { self?.dismissToast() }
        }
    }

    func dismissToast() {
        withAnimation(.snappy(duration: 0.25)) { toast = nil }
    }

    func show(_ error: Error) {
        present(Toast(message: errorText(error), isError: true))
    }

    func stop() {
        ticker?.cancel()
        toastTimer?.cancel()
    }
}

extension MailThread {
    init(draft: MailDraftLine) {
        self.init(
            id: "\(draftPrefix)\(draft.accountId):\(draft.id)",
            accountId: draft.accountId,
            subject: draft.subject,
            snippet: draft.snippet,
            fromName: nil,
            fromEmail: nil,
            receivedAt: draft.updatedAt,
            isRead: true,
            isStarred: false,
            hasAttachments: draft.hasAttachments,
            messageCount: 1,
            to: draft.to
        )
    }

    /// The provider's draft id, when this line is a draft.
    var draftId: String? {
        guard id.hasPrefix(draftPrefix) else { return nil }
        return String(id.dropFirst(draftPrefix.count + accountId.count + 1))
    }
}
