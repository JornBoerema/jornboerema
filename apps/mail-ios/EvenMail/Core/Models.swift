import Foundation

// The API's shapes, as `packages/mail-core/src/types.ts` describes them.

struct MailAccount: Codable, Identifiable, Hashable {
    let id: String
    let provider: String
    let email: String
    let displayName: String?
    let status: String
    let color: Int
    var signatures: SignatureChoice?

    struct SignatureChoice: Codable, Hashable {
        let newId: String?
        let replyId: String?
    }

    var isActive: Bool { status == "active" }
    /// Only Outlook can delete mail for good; Gmail would need full mailbox access.
    var canDeleteForever: Bool { provider == "outlook" }
}

struct MailAddress: Codable, Hashable {
    var name: String?
    var email: String

    /// The name when there is one, the address otherwise.
    var label: String { name?.isEmpty == false ? name! : email }
}

/// One line in a list: a conversation, described by its newest message.
struct MailThread: Codable, Identifiable, Hashable {
    var id: String
    var accountId: String
    var subject: String
    var snippet: String
    var fromName: String?
    var fromEmail: String?
    var receivedAt: Date
    var isRead: Bool
    var isStarred: Bool
    var hasAttachments: Bool
    var messageCount: Int
    var to: [MailAddress]?
}

struct ThreadsPage: Codable {
    let threads: [MailThread]
    let nextCursor: String?
}

struct MailAttachment: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let size: Int
    let contentType: String
}

struct MailInlineImage: Codable, Hashable {
    let id: String
    let contentId: String
    let size: Int
    let contentType: String
}

/// A full message, read live from the provider and never stored.
struct MailMessage: Codable, Identifiable, Hashable {
    let id: String
    let subject: String
    let from: MailAddress?
    let replyTo: [MailAddress]
    let to: [MailAddress]
    let cc: [MailAddress]
    let receivedAt: Date
    /// Untrusted: only ever shown in the locked-down reader.
    let html: String?
    let text: String?
    let attachments: [MailAttachment]
    let inline: [MailInlineImage]
    /// How to leave the mailing list this came from, when it says.
    var unsubscribe: Unsubscribe?

    struct Unsubscribe: Codable, Hashable {
        let url: String?
        let oneClick: Bool?
    }
}

struct ThreadDetail: Codable {
    let messages: [MailMessage]
}

struct SyncResult: Codable {
    let done: Bool
    let busy: Bool
    let rateLimited: Bool
    let changed: Int
}

struct SearchHit: Codable {
    let accountId: String
    let threadId: String
    let subject: String
    let snippet: String
    let fromName: String?
    let fromEmail: String?
    let receivedAt: Date
    let isRead: Bool
    let hasAttachments: Bool
    let isStarred: Bool?
    let to: [MailAddress]?
    let messageId: String?
}

struct SearchResult: Codable {
    let hits: [SearchHit]
}

struct SnoozedThread: Codable {
    let thread: MailThread
    let until: Date
}

struct Snoozes: Codable {
    let snoozed: [SnoozedThread]
    let returned: [SnoozedThread]
}

struct MailDraftLine: Codable, Identifiable, Hashable {
    let id: String
    let accountId: String
    let subject: String
    let snippet: String
    let to: [MailAddress]
    let updatedAt: Date
    let hasAttachments: Bool
}

struct DraftList: Codable {
    let drafts: [MailDraftLine]
}

struct AttachmentRef: Codable, Hashable {
    let uploadId: String
    let name: String
    let contentType: String
    let size: Int
}

struct DraftReply: Codable, Hashable {
    let threadId: String
    let inReplyTo: String?
    let references: String?
}

/// An opened draft, its files already copied into uploads.
struct OpenedDraft: Codable {
    let id: String
    let to: [MailAddress]
    let cc: [MailAddress]
    let bcc: [MailAddress]
    let subject: String
    let text: String
    let html: String?
    let attachments: [AttachmentRef]
    let reply: DraftReply?
}

struct SavedDraft: Codable {
    let id: String
}

/// A signature the user wrote, as editor HTML.
struct MailSignature: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let html: String
}

/// An image the body shows inline, which refers to it as `cid:<contentId>`.
struct InlineUpload: Codable, Hashable {
    let contentId: String
    let name: String
    let contentType: String
    let data: String
}

struct MailSummary: Codable {
    let kind: String
    let code: String?
    let summary: String?
}

struct UnreadSummary: Codable {
    let count: Int
}

struct Access: Codable {
    let access: Bool
    let requested: Bool
}

struct MailPreferences: Codable {
    var summaries: Bool?
    var codes: Bool?
    var aiWriting: Bool?
    var replySuggestions: Bool?
    var remoteImages: Bool?
    var parcels: Bool?
    var invoices: Bool?
    var senders: Bool?
    var todos: Bool?
    var pins: Bool?
    var unsubscribe: Bool?
    /// The places in the order the user gave them on the web.
    var sidebar: Sidebar?

    struct Sidebar: Codable {
        let main: [String]
        let more: [String]
        let hidden: [String]
    }
}

/// A parcel followed in the mail (`MailShipmentView`).
struct Shipment: Codable {
    let carrier: String?
    let trackingCode: String?
    let trackingUrl: String?
    let merchant: String?
    let status: String?
    let subject: String
    let receivedAt: Date
    let thread: MailThread?

    static let carriers = ["postnl": "PostNL", "dhl": "DHL", "dpd": "DPD", "gls": "GLS", "ups": "UPS", "budbee": "Budbee", "trunkrs": "Trunkrs", "dragonfly": "Dragonfly", "amazon": "Amazon"]

    var carrierName: String? { carrier.flatMap { Shipment.carriers[$0] } }
    var title: String { merchant ?? carrierName ?? subject }

    var statusLabel: String {
        switch status {
        case "announced": t("Announced", "Aangemeld")
        case "in_transit": t("On its way", "Onderweg")
        case "out_for_delivery": t("Arrives today", "Komt vandaag")
        case "pickup": t("Ready to collect", "Ligt klaar")
        case "delivered": t("Delivered", "Bezorgd")
        case "problem": t("Needs attention", "Let op")
        default: t("Parcel", "Pakketje")
        }
    }
}

/// An invoice, receipt or payment request from mail (`MailInvoiceView`).
struct Invoice: Codable {
    let vendor: String?
    let amountCents: Int?
    let currency: String?
    let dueDate: String?
    let invoiceNumber: String?
    let payUrl: String?
    let status: String
    let overdue: Bool
    let subject: String
    let receivedAt: Date
    let thread: MailThread?

    /// Waiting to be paid by you: neither paid, nor collected automatically.
    var isOpen: Bool { status == "due" || status == "failed" }

    var statusLabel: String {
        switch status {
        case "paid": t("Paid", "Betaald")
        case "auto": t("Collected automatically", "Wordt automatisch afgeschreven")
        case "failed": t("Payment failed", "Betaling mislukt")
        default: t("To pay", "Te betalen")
        }
    }

    /// "€ 121,00" in the reader's locale, in the invoice's currency.
    var amount: String? {
        guard let amountCents else { return nil }
        return formatMoney(amountCents, currency: currency)
    }

    var due: Date? {
        guard let dueDate else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: String(dueDate.prefix(10)))
    }
}

func formatMoney(_ cents: Int, currency: String?, round: Bool = false) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    formatter.locale = Prefs.shared.locale
    formatter.currencyCode = currency ?? "EUR"
    if round { formatter.maximumFractionDigits = 0 }
    return formatter.string(from: NSNumber(value: Double(cents) / 100)) ?? "\(currency ?? "") \(cents / 100)"
}

/// Someone who fills the inbox, for tidying up per sender (`MailSenderView`).
struct Sender: Codable, Identifiable {
    let email: String
    let name: String?
    let messages: Int
    let unread: Int
    let conversations: Int
    let latest: Date
    let providerMessageId: String
    let thread: MailThread?

    var id: String { email }
    var label: String { name ?? email }
}

/// A message waiting to be sent (`MailScheduledView`).
struct ScheduledMail: Codable, Identifiable {
    let id: String
    let accountId: String
    let draftId: String
    let subject: String
    let to: [MailAddress]
    let sendAt: Date
    let failed: Bool
}

/// A task list in Even doen that a task from mail can go to.
struct TodoList: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let workspaceId: String
    let workspaceName: String
}

/// A task in Even doen made from a conversation, and where it opens.
struct MailTodo: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let completed: Bool
    let inProgress: Bool
    let listName: String
    let url: String
}

struct MoneybirdAdministration: Codable, Identifiable, Hashable {
    let id: String
    let name: String
}

/// A connected service (`ConnectionView`); only Moneybird for now.
struct Connection: Codable {
    let provider: String
    let status: String
    let defaultTarget: MoneybirdAdministration?
    let administrations: [MoneybirdAdministration]
}

struct MoneybirdExport: Codable, Hashable {
    let attachmentKey: String
    let administrationId: String
    let administrationName: String
    let url: String
}

struct MoneybirdThread: Codable {
    var exports: [MoneybirdExport]
    var suggestedAdministrationId: String?
}

/// A reply a model suggests: a few words to pick it by, and the reply itself.
struct ReplySuggestion: Codable, Hashable {
    let label: String
    let text: String
}

/// A message in the reader's language. `same` when it already was in theirs.
struct MailTranslation: Codable {
    let same: Bool
    let from: String
    let text: String
}

/// What a language model wrote for a message, as it streams in or once it's
/// done (`parseWritten` in `packages/mail-core/src/write.ts`). While the first
/// line might still turn out to be a subject line, the body waits for it.
func parseWritten(_ content: String, done: Bool = true) -> (subject: String?, text: String) {
    let marker = "subject:"
    var text = content.replacingOccurrences(of: "\r\n", with: "\n")
    text = String(text.drop(while: { $0.isWhitespace }))
    var subject: String?
    let lead = text.prefix(marker.count).lowercased()
    if !lead.isEmpty, marker.hasPrefix(lead) {
        if let lineEnd = text.firstIndex(of: "\n") {
            if lead == marker {
                let line = text[text.index(text.startIndex, offsetBy: marker.count)..<lineEnd].trimmingCharacters(in: .whitespaces)
                subject = line.isEmpty ? nil : line
                text = String(text[text.index(after: lineEnd)...])
            }
        } else {
            if !done { return (nil, "") }
            if lead == marker {
                let line = text.dropFirst(marker.count).trimmingCharacters(in: .whitespaces)
                return (line.isEmpty ? nil : line, "")
            }
        }
    }
    // Models like to fence or bold things; a mail body has neither.
    for (pattern, replacement) in [(#"^\s*```[a-z]*\n?"#, ""), (#"\n?```\s*$"#, ""), (#"\*\*(.+?)\*\*"#, "$1"), (#"\n{3,}"#, "\n\n")] {
        text = text.replacingOccurrences(of: pattern, with: replacement, options: .regularExpression)
    }
    return (subject, done ? text.trimmingCharacters(in: .whitespacesAndNewlines) : String(text.drop(while: { $0.isWhitespace })))
}

struct Contact: Codable, Hashable {
    let name: String?
    let email: String
}

struct SessionUser: Codable, Equatable {
    let id: String
    let email: String
    let name: String?
}

enum ThreadAction: String {
    case read, unread, archive, trash, star, unstar, inbox, spam, delete
}

/// The places of the sidebar that the phone shows (`packages/mail-core/src/sidebar.ts`).
enum Place: String, CaseIterable, Identifiable {
    case inbox, starred, parcels, invoices, snoozed, drafts, scheduled, sent, senders, archive, spam, trash

    /// Places that are lists of something other than conversations.
    var isSpecial: Bool { [.parcels, .invoices, .scheduled, .senders].contains(self) }

    var id: String { rawValue }

    /// The folder the API lists it by; the inbox has none.
    var folder: String? {
        switch self {
        case .starred, .sent, .archive, .spam, .trash: rawValue
        case .inbox, .snoozed, .drafts, .parcels, .invoices, .scheduled, .senders: nil
        }
    }

    var icon: String {
        switch self {
        case .inbox: "inbox"
        case .starred: "star"
        case .snoozed: "alarm-clock"
        case .drafts: "file-01"
        case .parcels: "package"
        case .invoices: "invoice-02"
        case .scheduled: "mail-send-01"
        case .senders: "clean"
        case .sent: "sent"
        case .archive: "archive"
        case .spam: "spam"
        case .trash: "delete-02"
        }
    }

    var title: String {
        switch self {
        case .inbox: t("Inbox", "Inbox")
        case .starred: t("Starred", "Met ster")
        case .snoozed: t("Snoozed", "Gesnoozed")
        case .drafts: t("Drafts", "Concepten")
        case .parcels: t("Parcels", "Pakketjes")
        case .invoices: t("Invoices", "Facturen")
        case .scheduled: t("Scheduled", "Gepland")
        case .senders: t("Tidy up", "Opruimen")
        case .sent: t("Sent", "Verzonden")
        case .archive: t("Archive", "Archief")
        case .spam: t("Spam", "Spam")
        case .trash: t("Trash", "Prullenbak")
        }
    }

    /// Whether an action takes a conversation out of this list (`leavesList` in `lib/mail.ts`).
    func leaves(_ action: ThreadAction) -> Bool {
        switch self {
        case .starred: [.unstar, .trash, .spam].contains(action)
        case .sent: action == .trash
        case .archive: [.trash, .inbox, .spam].contains(action)
        case .spam: [.trash, .inbox, .delete].contains(action)
        case .trash: [.inbox, .delete].contains(action)
        case .inbox, .snoozed, .drafts, .parcels, .invoices, .scheduled, .senders: [.archive, .trash, .spam].contains(action)
        }
    }

    /// The actions that move a conversation on, as offered here (`moveActions`).
    func moveActions(canDelete: Bool) -> [ThreadAction] {
        switch self {
        case .trash: canDelete ? [.inbox, .delete] : [.inbox]
        case .spam: canDelete ? [.inbox, .trash, .delete] : [.inbox, .trash]
        case .archive: [.inbox, .trash]
        case .sent: [.trash]
        case .inbox, .starred, .snoozed, .drafts, .parcels, .invoices, .scheduled, .senders: [.archive, .trash]
        }
    }

    var canReportSpam: Bool { self != .spam && self != .trash && self != .sent }
}

private let remotePrefix = "remote:"

extension MailThread {
    /// A search or folder hit as a list line, so it opens like any other
    /// (`searchHitAsThread`). Ones outside the synced inbox have no row id and
    /// are addressed by mailbox and provider thread id.
    init(hit: SearchHit) {
        self.init(
            id: hit.messageId ?? "\(remotePrefix)\(hit.accountId):-:\(hit.threadId)",
            accountId: hit.accountId,
            subject: hit.subject,
            snippet: hit.snippet,
            fromName: hit.fromName,
            fromEmail: hit.fromEmail,
            receivedAt: hit.receivedAt,
            isRead: hit.isRead,
            isStarred: hit.isStarred ?? false,
            hasAttachments: hit.hasAttachments,
            messageCount: 1,
            to: nil
        )
    }

    /// Who the line names: the recipients in folders of sent mail, the sender elsewhere.
    var who: String {
        if let to {
            let names = to.map(\.label).joined(separator: ", ")
            return t("To: \(names.isEmpty ? "—" : names)", "Aan: \(names.isEmpty ? "—" : names)")
        }
        return fromName ?? fromEmail ?? t("Unknown sender", "Onbekende afzender")
    }

    var title: String { subject.isEmpty ? t("(no subject)", "(geen onderwerp)") : subject }
}

/// The API path of a conversation (`conversationUrl` in `lib/mail.ts`).
func conversationPath(_ id: String, _ suffix: String = "") -> String {
    func encoded(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
    guard id.hasPrefix(remotePrefix) else { return "/api/mail/threads/\(encoded(id))\(suffix)" }
    let parts = id.dropFirst(remotePrefix.count).split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
    let accountId = parts.first ?? ""
    let hidden = parts.count > 1 && parts[1] == "h" ? "&hidden=1" : ""
    let thread = parts.count > 2 ? parts[2] : ""
    return "/api/mail/accounts/\(encoded(accountId))/conversation\(suffix)?thread=\(encoded(thread))\(hidden)"
}

/// Who a reply goes to (`replyRecipients` in mail-core): shown and sent exactly as returned.
func replyRecipients(_ message: MailMessage, selfEmail: String, all: Bool) -> (to: [MailAddress], cc: [MailAddress]) {
    let own = selfEmail.lowercased()
    let fromSelf = message.from?.email.lowercased() == own
    let primary: [MailAddress] = fromSelf ? message.to : !message.replyTo.isEmpty ? message.replyTo : message.from.map { [$0] } ?? []
    guard all else { return (primary, []) }
    var seen: Set<String> = [own]
    func keepNew(_ address: MailAddress) -> Bool { seen.insert(address.email.lowercased()).inserted }
    let to = (primary + message.to).filter(keepNew)
    return (to, message.cc.filter(keepNew))
}
