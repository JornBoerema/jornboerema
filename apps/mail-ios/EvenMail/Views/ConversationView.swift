import QuickLook
import SwiftUI

/// Mail is marked read once it has been open this long (`MARK_READ_DELAY_MS`).
private let markReadDelay: UInt64 = 1_200_000_000

/// An opened conversation (`pages/conversation.tsx`).
struct ConversationView: View {
    let thread: MailThread

    @Environment(MailStore.self) private var store
    @Environment(Navigator.self) private var navigator
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var detail: ThreadDetail?
    @State private var error: String?
    @State private var summary: MailSummary?
    @State private var showImagesOnce = false
    @State private var starred: Bool
    @State private var seen: Bool

    init(thread: MailThread) {
        self.thread = thread
        _starred = State(initialValue: thread.isStarred)
        _seen = State(initialValue: thread.isRead)
    }

    private var place: Place { navigator.shownPlace }
    private var account: MailAccount? { store.account(thread.accountId) }
    private var allowImages: Bool { store.preferences.remoteImages != false || showImagesOnce }
    private var latest: MailMessage? { detail?.messages.last }

    private var imagesBlocked: Bool {
        guard !allowImages, let detail else { return false }
        return detail.messages.contains { $0.html.map(EmailDocument.hasRemoteImages) ?? false }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(thread.title)
                    .font(.inter(22, .semibold, relativeTo: .title2))
                    .foregroundStyle(Theme.foreground)
                    .padding(.bottom, 4)
                if let account, store.accounts.count > 1 {
                    HStack(spacing: 6) {
                        AccountDot(color: account.color)
                        Text(account.email)
                            .font(.inter(12.5, relativeTo: .caption))
                            .foregroundStyle(Theme.mutedForeground)
                    }
                    .padding(.bottom, 8)
                }
                if let summary { SummaryCard(summary: summary).padding(.vertical, 8) }
                if imagesBlocked {
                    Button { showImagesOnce = true } label: {
                        Notice(icon: "image-02", text: t("Pictures in this mail are hidden. Tap to show them.", "Afbeeldingen in deze mail zijn verborgen. Tik om ze te tonen."))
                    }
                    .buttonStyle(.plain)
                    .padding(.vertical, 8)
                }
                if let detail {
                    ForEach(detail.messages) { message in
                        if message.id != detail.messages.first?.id { Divider().overlay(Theme.border) }
                        MessageView(thread: thread, message: message, latest: message.id == latest?.id, allowImages: allowImages)
                    }
                } else if let error {
                    EmptyState(icon: "cloud-alert", title: t("Could not open this conversation", "Dit gesprek openen lukte niet"), text: error) {
                        OutlineButton(title: t("Try again", "Opnieuw proberen"), icon: "refresh") { Task { await load(fresh: true) } }
                            .frame(maxWidth: 220)
                    }
                    .frame(minHeight: 320)
                } else {
                    ProgressView().frame(maxWidth: .infinity, minHeight: 200)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 24)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .task {
            await load(fresh: false)
            summary = await store.summary(thread.id)
        }
        .task {
            // Open long enough to have been read.
            guard !thread.isRead else { return }
            try? await Task.sleep(nanoseconds: markReadDelay)
            guard !Task.isCancelled else { return }
            seen = true
            store.act(.read, on: [thread], in: place)
        }
    }

    private func load(fresh: Bool) async {
        error = nil
        if let kept = store.cachedDetail(thread.id), !fresh { detail = kept }
        do { detail = try await store.detail(thread.id, fresh: fresh) } catch {
            if detail == nil { self.error = errorText(error) }
        }
    }

    private func act(_ action: ThreadAction) {
        navigator.act(action, on: thread, store: store, compact: sizeClass == .compact)
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            ForEach(place.moveActions(canDelete: account?.canDeleteForever ?? false), id: \.self) { action in
                Button { act(action) } label: { Icon(action.icon) }
                    .accessibilityLabel(action.label(in: place))
            }
            Menu {
                Button {
                    seen.toggle()
                    act(seen ? .read : .unread)
                } label: { ActionLabel(action: seen ? .unread : .read, place: place) }
                Button {
                    starred.toggle()
                    act(starred ? .star : .unstar)
                } label: { ActionLabel(action: starred ? .unstar : .star, place: place) }
                if place == .inbox {
                    Button { navigator.snoozing = SnoozeRequest(thread: thread) } label: {
                        Label { Text(t("Snooze", "Uitstellen")) } icon: { Image("hi-alarm-clock") }
                    }
                }
                if place.canReportSpam {
                    Divider()
                    Button(role: .destructive) { act(.spam) } label: { ActionLabel(action: .spam, place: place) }
                }
            } label: {
                Icon("more-horizontal")
            }
            .accessibilityLabel(t("More", "Meer"))
        }
        ToolbarItemGroup(placement: .bottomBar) {
            if let latest {
                let everyone = replyRecipients(latest, selfEmail: account?.email ?? "", all: true)
                Button { navigator.compose = ComposeRequest(mode: .reply(thread: thread, message: latest, all: false)) } label: {
                    BarLabel(icon: "mail-reply-01", title: t("Reply", "Beantwoorden"))
                }
                Spacer()
                if everyone.to.count + everyone.cc.count > 1 {
                    Button { navigator.compose = ComposeRequest(mode: .reply(thread: thread, message: latest, all: true)) } label: {
                        BarLabel(icon: "mail-reply-all-01", title: t("Reply all", "Allen"))
                    }
                    Spacer()
                }
                Button { navigator.compose = ComposeRequest(mode: .forward(thread: thread, message: latest)) } label: {
                    BarLabel(icon: "arrow-right-02", title: t("Forward", "Doorsturen"))
                }
            }
        }
    }
}

private struct BarLabel: View {
    let icon: String
    let title: String

    var body: some View {
        HStack(spacing: 6) {
            Icon(icon, size: 20)
            Text(title).font(.inter(15, .medium, relativeTo: .subheadline))
        }
    }
}

/// Three lines on what the mail says, or the code it carries (`components/mail-summary.tsx`).
private struct SummaryCard: View {
    let summary: MailSummary
    @State private var copied = false

    var body: some View {
        if summary.kind == "code", let code = summary.code {
            Button {
                UIPasteboard.general.string = code
                copied = true
            } label: {
                HStack(spacing: 10) {
                    Icon("security-check", size: 18).foregroundStyle(Theme.accentText)
                    Text(code)
                        .font(.inter(18, .semibold, relativeTo: .headline))
                        .monospacedDigit()
                        .foregroundStyle(Theme.foreground)
                    Spacer()
                    HStack(spacing: 4) {
                        Icon(copied ? "tick-02" : "copy-01", size: 16)
                        Text(copied ? t("Copied", "Gekopieerd") : t("Copy", "Kopiëren")).font(.inter(13, .medium, relativeTo: .footnote))
                    }
                    .foregroundStyle(Theme.mutedForeground)
                }
                .padding(12)
                .background(Theme.muted, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
            }
            .buttonStyle(.plain)
        } else if summary.kind == "summary", let text = summary.summary, !text.isEmpty {
            HStack(alignment: .top, spacing: 10) {
                Icon("sparkles", size: 16).foregroundStyle(Theme.accentText).padding(.top, 2)
                Text(text)
                    .font(.inter(14, relativeTo: .subheadline))
                    .foregroundStyle(Theme.foreground)
                    .lineSpacing(3)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(12)
            .background(Theme.muted, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
        }
    }
}

/// One message: who and when, then its body and files. Earlier messages start
/// folded to a line; the newest is open.
private struct MessageView: View {
    let thread: MailThread
    let message: MailMessage
    let latest: Bool
    let allowImages: Bool

    @Environment(MailStore.self) private var store
    @State private var expanded: Bool
    @State private var html: String?
    @State private var preview: URL?
    @State private var downloading: String?

    init(thread: MailThread, message: MailMessage, latest: Bool, allowImages: Bool) {
        self.thread = thread
        self.message = message
        self.latest = latest
        self.allowImages = allowImages
        _expanded = State(initialValue: latest)
    }

    private var sender: String { message.from?.label ?? t("Unknown sender", "Onbekende afzender") }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                if !latest { withAnimation(.snappy(duration: 0.2)) { expanded.toggle() } }
            } label: {
                HStack(alignment: .top, spacing: 10) {
                    ContactAvatar(name: message.from?.name, email: message.from?.email ?? "?", size: 34)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(sender)
                                .font(.inter(15, .medium, relativeTo: .subheadline))
                                .foregroundStyle(Theme.foreground)
                                .lineLimit(1)
                            Spacer(minLength: 8)
                            Text(expanded ? longDate(message.receivedAt) : shortDate(message.receivedAt))
                                .font(.inter(12, relativeTo: .caption))
                                .monospacedDigit()
                                .foregroundStyle(Theme.mutedForeground)
                                .layoutPriority(1)
                        }
                        Text(expanded ? recipients : (message.text ?? "").prefix(160).replacingOccurrences(of: "\n", with: " "))
                            .font(.inter(13, relativeTo: .footnote))
                            .foregroundStyle(Theme.mutedForeground)
                            .lineLimit(expanded ? 2 : 1)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(latest ? "" : expanded ? t("Collapses the message", "Klapt het bericht in") : t("Opens the message", "Opent het bericht"))

            if expanded {
                EmailBody(html: html ?? source, allowImages: allowImages)
                    .task { await inlineImages() }
                if !message.attachments.isEmpty {
                    VStack(spacing: 6) {
                        ForEach(message.attachments) { file in
                            AttachmentChip(file: file, busy: downloading == file.id) { Task { await open(file) } }
                        }
                    }
                }
            }
        }
        .padding(.vertical, 14)
        .quickLookPreview($preview)
    }

    private var recipients: String {
        var parts: [String] = []
        if !message.to.isEmpty { parts.append("\(t("To", "Aan")): \(message.to.map(\.label).joined(separator: ", "))") }
        if !message.cc.isEmpty { parts.append("Cc: \(message.cc.map(\.label).joined(separator: ", "))") }
        return parts.isEmpty ? (message.from?.email ?? "") : parts.joined(separator: " · ")
    }

    /// The body as HTML: the mail's own, cleaned, or its text as written.
    private var source: String {
        if let html = message.html, !html.isEmpty { return EmailDocument.clean(html) }
        return "<pre>\(EmailDocument.escape(message.text ?? ""))</pre>"
    }

    /// Pictures the body carries along (`cid:`) are fetched and put in place;
    /// only real picture types, and not too many or too large, as on the web.
    private func inlineImages() async {
        guard html == nil, let raw = message.html, raw.contains("cid:") else { return }
        var body = source
        let safe = message.inline
            .filter { $0.contentType.range(of: #"^image/(png|jpe?g|gif|webp)$"#, options: [.regularExpression, .caseInsensitive]) != nil && $0.size <= 2 * 1024 * 1024 }
            .prefix(20)
        for image in safe where body.contains("cid:\(image.contentId)") {
            guard let data = await store.inlineImage(image, message: message, thread: thread.id) else { continue }
            body = body.replacingOccurrences(of: "cid:\(image.contentId)", with: "data:\(image.contentType.lowercased());base64,\(data.base64EncodedString())")
        }
        html = body
    }

    private func open(_ file: MailAttachment) async {
        guard downloading == nil else { return }
        downloading = file.id
        defer { downloading = nil }
        do { preview = try await store.download(file, message: message, thread: thread.id) } catch { store.show(error) }
    }
}

/// A file on a message; tapping downloads it and shows it (`AttachmentChip`).
private struct AttachmentChip: View {
    let file: MailAttachment
    let busy: Bool
    let action: () -> Void

    private var icon: String {
        let type = file.contentType.lowercased()
        if type.hasPrefix("image/") { return "image-02" }
        if type.contains("pdf") { return "pdf-02" }
        if type.contains("zip") { return "zip-02" }
        if type.contains("sheet") || type.contains("excel") || type.contains("csv") { return "xls-02" }
        if type.contains("word") || type.contains("document") { return "doc-02" }
        if type.hasPrefix("video/") { return "video-02" }
        if type.hasPrefix("audio/") { return "music-note-02" }
        return "file-01"
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Icon(icon, size: 20).foregroundStyle(Theme.mutedForeground)
                VStack(alignment: .leading, spacing: 1) {
                    Text(file.name)
                        .font(.inter(14, .medium, relativeTo: .subheadline))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(1)
                    Text(formatSize(file.size))
                        .font(.inter(12, relativeTo: .caption))
                        .foregroundStyle(Theme.mutedForeground)
                }
                Spacer(minLength: 0)
                if busy { ProgressView() } else { Icon("download-04", size: 18).foregroundStyle(Theme.mutedForeground) }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 52)
            .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).strokeBorder(Theme.border))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
