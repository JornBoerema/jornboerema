import SwiftUI

/// Writing a message (`pages/compose.tsx` and `components/reply-forms.tsx`): a
/// new one, a reply, a forward, or a draft picked up again.
struct ComposeView: View {
    let request: ComposeRequest

    @Environment(MailStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var accountId = ""
    @State private var to: [MailAddress] = []
    @State private var cc: [MailAddress] = []
    @State private var bcc: [MailAddress] = []
    @State private var toText = ""
    @State private var ccText = ""
    @State private var bccText = ""
    @State private var showCc = false
    @State private var subject = ""
    @State private var text = ""
    @State private var sending = false
    @State private var loadingDraft = false
    @State private var confirmClose = false
    @State private var draft: OpenedDraft?
    @State private var ready = false
    @FocusState private var focus: Field?

    private enum Field { case subject, body }

    private var account: MailAccount? { store.account(accountId) }

    private var isReply: Bool {
        if case .reply = request.mode { return true }
        return false
    }

    private var isForward: Bool {
        if case .forward = request.mode { return true }
        return false
    }

    /// A new message or a forward begins with who it is for.
    private var startsAtRecipients: Bool {
        switch request.mode {
        case .new, .forward: true
        case .reply, .draft: false
        }
    }

    /// Replies and forwards go out from the mailbox the conversation is in.
    private var fixedAccount: Bool { isReply || isForward || draft != nil }

    private var title: String {
        switch request.mode {
        case .new, .draft: t("New message", "Nieuw bericht")
        case .reply(_, _, let all): all ? t("Reply all", "Allen beantwoorden") : t("Reply", "Beantwoorden")
        case .forward: t("Forward", "Doorsturen")
        }
    }

    private var signature: MailSignature? {
        store.signature(for: account, reply: isReply || isForward)
    }

    private var written: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// What is typed but not yet a chip counts too, when it is an address.
    private func all(_ list: [MailAddress], _ typing: String) -> [MailAddress] {
        list + (parseAddress(typing).map { [$0] } ?? [])
    }

    private var canSend: Bool {
        guard !sending, !loadingDraft, account != nil else { return false }
        let recipients = all(to, toText).count + all(cc, ccText).count + all(bcc, bccText).count
        if isReply { return written && !to.isEmpty }
        if isForward { return !all(to, toText).isEmpty }
        return recipients > 0
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    if store.accounts.filter(\.isActive).count > 1 || fixedAccount {
                        row(t("From", "Van")) { fromPicker }
                    }
                    if isReply {
                        row(t("To", "Aan")) {
                            Text((to.map(\.label) + (cc.isEmpty ? [] : ["Cc: " + cc.map(\.label).joined(separator: ", ")])).joined(separator: " · "))
                                .font(.inter(15, relativeTo: .subheadline))
                                .foregroundStyle(Theme.foreground)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 12)
                        }
                    } else {
                        row(t("To", "Aan")) {
                            HStack(alignment: .top) {
                                AddressField(addresses: $to, text: $toText, autofocus: startsAtRecipients)
                                if !showCc, !isForward {
                                    Button(t("Cc/Bcc", "Cc/Bcc")) { showCc = true }
                                        .font(.inter(13, relativeTo: .footnote))
                                        .foregroundStyle(Theme.mutedForeground)
                                        .padding(.top, 13)
                                }
                            }
                        }
                        if showCc || isForward {
                            row("Cc") { AddressField(addresses: $cc, text: $ccText) }
                        }
                        if showCc, !isForward {
                            row("Bcc") { AddressField(addresses: $bcc, text: $bccText) }
                        }
                    }
                    if !isReply {
                        row(t("Subject", "Onderwerp")) {
                            TextField("", text: $subject)
                                .font(.inter(16))
                                .focused($focus, equals: .subject)
                                .disabled(isForward)
                                .foregroundStyle(isForward ? Theme.mutedForeground : Theme.foreground)
                                .padding(.vertical, 12)
                        }
                    }
                    ZStack(alignment: .topLeading) {
                        if text.isEmpty {
                            Text(isReply ? t("Write your reply…", "Schrijf je antwoord…") : isForward ? t("Add a note (optional)…", "Voeg een bericht toe (optioneel)…") : t("Write your message…", "Schrijf je bericht…"))
                                .font(.inter(16))
                                .foregroundStyle(Theme.mutedForeground)
                                .padding(.horizontal, 16)
                                .padding(.top, 16)
                        }
                        TextEditor(text: $text)
                            .font(.inter(16))
                            .foregroundStyle(Theme.foreground)
                            .scrollContentBackground(.hidden)
                            .scrollDisabled(true)
                            .focused($focus, equals: .body)
                            .frame(minHeight: 220)
                            .padding(.horizontal, 11)
                            .padding(.top, 8)
                    }
                    if let signature {
                        Text(plainText(signature.html))
                            .font(.inter(14, relativeTo: .subheadline))
                            .foregroundStyle(Theme.mutedForeground)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16)
                            .padding(.bottom, 16)
                            .accessibilityLabel(t("Signature", "Handtekening") + ": " + plainText(signature.html))
                    }
                    if isReply || isForward {
                        Text(isForward ? t("The original message is added below yours.", "Het oorspronkelijke bericht komt onder het jouwe.") : t("The earlier mail is quoted below your reply.", "De eerdere mail wordt onder je antwoord geciteerd."))
                            .font(.inter(12.5, relativeTo: .caption))
                            .foregroundStyle(Theme.mutedForeground)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16)
                            .padding(.bottom, 24)
                    }
                    if let draft, !draft.attachments.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(draft.attachments, id: \.uploadId) { file in
                                HStack(spacing: 8) {
                                    Icon("attachment-01", size: 16)
                                    Text("\(file.name) · \(formatSize(file.size))").font(.inter(13, relativeTo: .footnote)).lineLimit(1)
                                }
                                .foregroundStyle(Theme.mutedForeground)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 24)
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.background)
            .overlay { if loadingDraft { ProgressView() } }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("Cancel", "Annuleren")) { close() }
                        .font(.inter(16))
                        .foregroundStyle(Theme.foreground)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await send() } } label: {
                        if sending { ProgressView() } else {
                            Text(t("Send", "Versturen")).font(.inter(16, .semibold))
                        }
                    }
                    .disabled(!canSend)
                }
            }
            .confirmationDialog(t("Keep this message as a draft?", "Dit bericht als concept bewaren?"), isPresented: $confirmClose, titleVisibility: .visible) {
                Button(t("Save draft", "Concept bewaren")) { Task { await saveDraft() } }
                Button(t("Discard", "Weggooien"), role: .destructive) { dismiss() }
                Button(t("Keep writing", "Verder schrijven"), role: .cancel) {}
            }
        }
        .interactiveDismissDisabled(written || !subject.isEmpty)
        .task { await prepare() }
    }

    // MARK: Parts

    private func row<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 10) {
                Text(label)
                    .font(.inter(15, relativeTo: .subheadline))
                    .foregroundStyle(Theme.mutedForeground)
                    .padding(.top, 13)
                content()
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 46)
            Divider().overlay(Theme.border)
        }
    }

    @ViewBuilder
    private var fromPicker: some View {
        let label = HStack(spacing: 8) {
            if let account { AccountDot(color: account.color) }
            Text(account?.email ?? "—")
                .font(.inter(15, relativeTo: .subheadline))
                .foregroundStyle(Theme.foreground)
                .lineLimit(1)
            if !fixedAccount { Icon("unfold-more", size: 14).foregroundStyle(Theme.mutedForeground) }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 12)
        if fixedAccount {
            label
        } else {
            Menu {
                ForEach(store.accounts.filter(\.isActive)) { option in
                    Button {
                        accountId = option.id
                    } label: {
                        if option.id == accountId { Label(option.email, systemImage: "checkmark") } else { Text(option.email) }
                    }
                }
            } label: { label }
        }
    }

    // MARK: Start

    private func prepare() async {
        guard !ready else { return }
        ready = true
        switch request.mode {
        case .new:
            accountId = store.defaultAccount?.id ?? ""
        case .reply(let thread, let message, let all):
            accountId = thread.accountId
            let recipients = replyRecipients(message, selfEmail: account?.email ?? "", all: all)
            to = recipients.to
            cc = recipients.cc
            focus = .body
        case .forward(let thread, let message):
            accountId = thread.accountId
            subject = message.subject.lowercased().hasPrefix("fwd:") || message.subject.lowercased().hasPrefix("fw:") ? message.subject : "Fwd: \(message.subject)"
        case .draft(let draftAccount, let draftId):
            accountId = draftAccount
            loadingDraft = true
            defer { loadingDraft = false }
            do {
                let opened: OpenedDraft = try await API.get("/api/mail/accounts/\(draftAccount.queryEncoded)/drafts/\(draftId.queryEncoded)")
                draft = opened
                to = opened.to
                cc = opened.cc
                bcc = opened.bcc
                showCc = !opened.cc.isEmpty || !opened.bcc.isEmpty
                subject = opened.subject
                text = opened.text
            } catch {
                store.show(error)
                dismiss()
            }
        }
    }

    private func close() {
        // A reply or forward that is cancelled is thrown away, as on the web.
        let worthKeeping = !isReply && !isForward && (written || !subject.trimmingCharacters(in: .whitespaces).isEmpty)
        if worthKeeping { confirmClose = true } else { dismiss() }
    }

    // MARK: Sending

    private struct Outgoing: Encodable {
        var messageId: String?
        var to: [MailAddress]
        var cc: [MailAddress]
        var bcc: [MailAddress]?
        var subject: String?
        var text: String
        var html: String?
        var attachments: [AttachmentRef]?
        var inline: [InlineUpload]?
        var draftId: String?
        var attachmentsChanged: Bool?
        var reply: DraftReply?
        /// Saving a draft: the API wants `draftId` named even when there is none yet.
        var isDraft = false

        private enum CodingKeys: String, CodingKey {
            case messageId, to, cc, bcc, subject, text, html, attachments, inline, draftId, attachmentsChanged, reply
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encodeIfPresent(messageId, forKey: .messageId)
            try container.encode(to, forKey: .to)
            try container.encode(cc, forKey: .cc)
            try container.encodeIfPresent(bcc, forKey: .bcc)
            try container.encodeIfPresent(subject, forKey: .subject)
            try container.encode(text, forKey: .text)
            try container.encodeIfPresent(html, forKey: .html)
            try container.encodeIfPresent(attachments, forKey: .attachments)
            try container.encodeIfPresent(inline, forKey: .inline)
            if isDraft { try container.encode(draftId, forKey: .draftId) }
            try container.encodeIfPresent(attachmentsChanged, forKey: .attachmentsChanged)
            try container.encodeIfPresent(reply, forKey: .reply)
        }
    }

    /// The message as it is sent: the text, then the mailbox's signature.
    private func outgoing() -> Outgoing {
        var body = text
        var html = textToEmailHtml(text)
        var inline: [InlineUpload] = []
        if let signature {
            let prepared = withInlineImages(signature.html)
            inline = prepared.inline
            let plain = plainText(signature.html)
            body = body.isEmpty ? plain : "\(body)\n\n\(plain)"
            html += "<br>\(prepared.html)"
        }
        return Outgoing(
            to: all(to, toText), cc: all(cc, ccText), bcc: all(bcc, bccText), subject: subject,
            text: body, html: wrapEmailHtml(html), attachments: draft?.attachments ?? [], inline: inline.isEmpty ? nil : inline
        )
    }

    private func send() async {
        guard canSend, let account else { return }
        sending = true
        defer { sending = false }
        var message = outgoing()
        do {
            switch request.mode {
            case .new:
                try await API.run("/api/mail/accounts/\(account.id.queryEncoded)/send", message)
            case .draft(_, let draftId):
                message.isDraft = true
                message.draftId = draftId
                message.attachmentsChanged = false
                message.reply = draft?.reply
                try await API.run("/api/mail/accounts/\(account.id.queryEncoded)/drafts/\(draftId.queryEncoded)/send", message)
            case .reply(let thread, let original, _):
                message.messageId = original.id
                message.bcc = nil
                message.subject = nil
                try await API.run(conversationPath(thread.id, "/reply"), message)
                store.forget(detail: thread.id)
            case .forward(let thread, let original):
                message.messageId = original.id
                message.bcc = nil
                message.subject = nil
                message.attachments = nil
                try await API.run(conversationPath(thread.id, "/forward"), message)
            }
            store.present(Toast(message: t("Sent", "Verzonden")))
            store.syncSoon()
            dismiss()
        } catch {
            store.show(error)
        }
    }

    private func saveDraft() async {
        guard let account else { return dismiss() }
        var message = outgoing()
        // The signature is added again when the draft is sent.
        message.text = text
        message.html = wrapEmailHtml(textToEmailHtml(text))
        message.inline = nil
        message.isDraft = true
        if case .draft(_, let draftId) = request.mode { message.draftId = draftId }
        message.attachmentsChanged = false
        message.reply = draft?.reply
        do {
            try await API.run("/api/mail/accounts/\(account.id.queryEncoded)/drafts", message)
            store.present(Toast(message: t("Draft saved", "Concept bewaard")))
            if store.shownPlace == .drafts { await store.load(.drafts) }
        } catch {
            store.show(error)
        }
        dismiss()
    }
}

// MARK: Addresses

/// "name@example.com" or "Name <name@example.com>" as an address, if it is one.
func parseAddress(_ raw: String) -> MailAddress? {
    let text = raw.trimmingCharacters(in: CharacterSet(charactersIn: " ,;\n\t"))
    guard !text.isEmpty else { return nil }
    var name: String?
    var email = text
    if let open = text.lastIndex(of: "<"), let close = text.lastIndex(of: ">"), open < close {
        email = String(text[text.index(after: open)..<close]).trimmingCharacters(in: .whitespaces)
        let before = text[..<open].trimmingCharacters(in: CharacterSet(charactersIn: " \""))
        name = before.isEmpty ? nil : before
    }
    guard email.range(of: #"^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$"#, options: .regularExpression) != nil else { return nil }
    return MailAddress(name: name, email: email)
}

/// Recipients as chips with a field after them; people the mailboxes know are
/// suggested while typing (`components/address-row.tsx`).
struct AddressField: View {
    @Binding var addresses: [MailAddress]
    @Binding var text: String
    /// Takes the keyboard when the composer opens.
    var autofocus = false

    @Environment(MailStore.self) private var store
    @State private var suggestions: [Contact] = []
    @State private var focusedOnce = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            FlowLayout(spacing: 6) {
                ForEach(addresses, id: \.self) { address in
                    Button {
                        addresses.removeAll { $0 == address }
                    } label: {
                        HStack(spacing: 4) {
                            Text(address.label).font(.inter(14, relativeTo: .subheadline)).lineLimit(1)
                            Icon("cancel-01", size: 12).foregroundStyle(Theme.mutedForeground)
                        }
                        .foregroundStyle(Theme.foreground)
                        .padding(.horizontal, 9)
                        .frame(minHeight: 30)
                        .background(Theme.muted, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(t("Remove \(address.label)", "Verwijder \(address.label)"))
                }
                TextField("", text: $text)
                    .font(.inter(16))
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .frame(minWidth: 120, minHeight: 30)
                    .focused($focused)
                    .onSubmit { commit() }
                    .onChange(of: text) { _, value in
                        // A comma, semicolon or space ends an address, as it does on the web.
                        if let last = value.last, ",; ".contains(last), parseAddress(value) != nil { commit() }
                    }
            }
            .padding(.vertical, 8)
            if focused, !suggestions.isEmpty {
                VStack(spacing: 0) {
                    ForEach(suggestions.prefix(5), id: \.self) { contact in
                        Button {
                            add(MailAddress(name: contact.name, email: contact.email))
                        } label: {
                            HStack(spacing: 10) {
                                ContactAvatar(name: contact.name, email: contact.email, size: 28)
                                VStack(alignment: .leading, spacing: 0) {
                                    if let name = contact.name, !name.isEmpty {
                                        Text(name).font(.inter(14, .medium, relativeTo: .subheadline)).foregroundStyle(Theme.foreground)
                                    }
                                    Text(contact.email).font(.inter(13, relativeTo: .footnote)).foregroundStyle(Theme.mutedForeground)
                                }
                                .lineLimit(1)
                                Spacer(minLength: 0)
                            }
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.bottom, 6)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: text) {
            let query = text.trimmingCharacters(in: .whitespaces)
            guard query.count >= 2 else {
                suggestions = []
                return
            }
            // Wait for a pause in typing before asking.
            try? await Task.sleep(nanoseconds: 180_000_000)
            guard !Task.isCancelled else { return }
            let found = await store.contacts(query)
            guard !Task.isCancelled else { return }
            suggestions = found.filter { contact in !addresses.contains { $0.email.lowercased() == contact.email.lowercased() } }
        }
        .onChange(of: focused) { _, isFocused in
            if !isFocused { commit() }
        }
        .task(id: autofocus) {
            guard autofocus, !focusedOnce else { return }
            focusedOnce = true
            // A sheet still sliding up doesn't take the keyboard yet.
            try? await Task.sleep(nanoseconds: 450_000_000)
            focused = true
        }
    }

    private func commit() {
        guard let address = parseAddress(text) else { return }
        add(address)
    }

    private func add(_ address: MailAddress) {
        if !addresses.contains(where: { $0.email.lowercased() == address.email.lowercased() }) { addresses.append(address) }
        text = ""
        suggestions = []
    }
}

/// Lays chips out on lines, wrapping where they no longer fit.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        return CGSize(width: proposal.width ?? rows.width, height: rows.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = arrange(width: bounds.width, subviews: subviews)
        for (index, frame) in rows.frames.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                proposal: ProposedViewSize(width: frame.width, height: frame.height)
            )
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (frames: [CGRect], width: CGFloat, height: CGFloat) {
        var frames: [CGRect] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0
        var widest: CGFloat = 0
        for (index, subview) in subviews.enumerated() {
            var size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
            size.width = min(size.width, width)
            if x > 0, x + size.width > width {
                x = 0
                y += lineHeight + spacing
                lineHeight = 0
            }
            // The last one is the field: it takes what is left of its line.
            if index == subviews.count - 1, width.isFinite { size.width = max(size.width, width - x) }
            frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return (frames, widest, y + lineHeight)
    }
}

// MARK: Mail HTML

/// Typed text as mail clients need it: every line a paragraph without margins,
/// an empty line as the gap (`lib/email-compose.ts`).
func textToEmailHtml(_ text: String) -> String {
    text.trimmingCharacters(in: .whitespacesAndNewlines)
        .components(separatedBy: .newlines)
        .map { line in "<p style=\"margin:0\">\(line.isEmpty ? "<br>" : EmailDocument.escape(line))</p>" }
        .joined()
}

func wrapEmailHtml(_ html: String) -> String {
    "<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5\">\(html)</div>"
}

/// HTML as the plain text beside it: tags gone, blocks and breaks as lines.
func plainText(_ html: String) -> String {
    var text = html.replacingOccurrences(of: #"<(br|/p|/div|/li|/tr)\b[^>]*>"#, with: "\n", options: [.regularExpression, .caseInsensitive])
    text = text.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
    for (entity, character) in ["&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'"] {
        text = text.replacingOccurrences(of: entity, with: character)
    }
    text = text.replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
}

/// A signature's pictures are kept in it as data; mail carries them along as
/// inline files the body points at (`lib/inline-images.ts`).
func withInlineImages(_ html: String) -> (html: String, inline: [InlineUpload]) {
    guard let regex = try? NSRegularExpression(pattern: #"src\s*=\s*["']data:(image/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)["']"#, options: .caseInsensitive) else { return (html, []) }
    var result = html
    var inline: [InlineUpload] = []
    let source = html as NSString
    for match in regex.matches(in: html, range: NSRange(location: 0, length: source.length)).reversed() {
        let type = source.substring(with: match.range(at: 1)).lowercased()
        let data = source.substring(with: match.range(at: 2)).components(separatedBy: .whitespacesAndNewlines).joined()
        let contentId = "\(UUID().uuidString.lowercased())@even.mail"
        let kind = type.split(separator: "/").last.map(String.init) ?? "png"
        inline.append(InlineUpload(contentId: contentId, name: "image-\(inline.count + 1).\(kind == "jpeg" ? "jpg" : kind)", contentType: type, data: data))
        result = (result as NSString).replacingCharacters(in: match.range, with: "src=\"cid:\(contentId)\"")
    }
    return (result, inline)
}
