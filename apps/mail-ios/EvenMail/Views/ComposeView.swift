import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// A file in the composer: uploading, uploaded, or failed (`lib/uploads.ts`).
struct ComposerFile: Identifiable {
    let id = UUID()
    let name: String
    let contentType: String
    let size: Int
    var uploadId: String?
    /// 0 to 1.
    var progress = 0.0
    var failed = false

    var isUploaded: Bool { uploadId != nil && progress >= 1 && !failed }
}

/// All files on one message, as Gmail allows; they are uploaded in chunks first.
private let maxAttachmentBytes = 25 * 1024 * 1024
/// One chunk per request, comfortably under the server's request limit.
private let uploadChunkBytes = 2 * 1024 * 1024

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
    @State private var aiOpen = false
    @State private var aiInstruction = ""
    @State private var aiPending = false
    @State private var aiTask: Task<Void, Never>?
    /// What stood there before the model wrote, to take its text back.
    @State private var aiBefore: (text: String, subject: String)?
    @FocusState private var aiFocused: Bool
    @State private var files: [ComposerFile] = []
    @State private var pickingFiles = false
    @State private var pickingPhotos = false
    @State private var photos: [PhotosPickerItem] = []
    @State private var scheduling = false
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
        guard !sending, !loadingDraft, account != nil, !uploading else { return false }
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
                    if !(draft?.attachments ?? []).isEmpty || !files.isEmpty {
                        VStack(spacing: 6) {
                            ForEach(draft?.attachments ?? [], id: \.uploadId) { file in
                                fileRow(name: file.name, detail: formatSize(file.size), progress: 1, failed: false, remove: nil)
                            }
                            ForEach(files) { file in
                                fileRow(
                                    name: file.name,
                                    detail: file.failed ? t("Upload failed", "Uploaden mislukt") : formatSize(file.size),
                                    progress: file.progress, failed: file.failed
                                ) { remove(file) }
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 24)
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom, spacing: 0) { aiBar }
            .fileImporter(isPresented: $pickingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
                if case .success(let urls) = result { Task { await attach(urls) } }
            }
            .photosPicker(isPresented: $pickingPhotos, selection: $photos, maxSelectionCount: 10, matching: .any(of: [.images, .videos]))
            .onChange(of: photos) { _, items in
                guard !items.isEmpty else { return }
                photos = []
                Task { await attach(items) }
            }
            .sheet(isPresented: $scheduling) {
                WhenSheet(title: t("Send later", "Later versturen"), confirm: { t("Send \($0)", "Versturen \($0)") }) { date in
                    Task { await schedule(date) }
                }
                .presentationDetents([.medium, .large])
            }
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
        // The app's own toasts sit under this sheet; what goes wrong here shows here.
        .overlay(alignment: .bottom) { ToastView().environment(store) }
        .task { await prepare() }
        .onDisappear { aiTask?.cancel() }
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

    // MARK: Writing with AI (`components/ai-writer.tsx`)

    /// One line: what to write, or what to change in what is there. The text
    /// appears as the model writes it, and can be taken back in one step.
    private var aiBar: some View {
        VStack(spacing: 0) {
            Divider().overlay(Theme.border)
            HStack(spacing: 10) {
                if aiOpen {
                    Icon("sparkles", size: 18).foregroundStyle(Theme.accentText)
                    TextField(
                        written ? t("What should change? For example: shorter, more formal", "Wat moet er anders? Bijvoorbeeld: korter, formeler")
                            : t("What should the mail say?", "Wat moet erin?"),
                        text: $aiInstruction,
                        axis: .vertical
                    )
                    .font(.inter(16))
                    .lineLimit(1...3)
                    .focused($aiFocused)
                    .disabled(aiPending)
                    .submitLabel(.go)
                    .onSubmit { startWriting() }
                    if aiPending {
                        Text(t("Writing…", "Schrijven…"))
                            .font(.inter(13, relativeTo: .footnote))
                            .foregroundStyle(Theme.mutedForeground)
                    } else {
                        Button { closeAi() } label: { Icon("cancel-01", size: 18).foregroundStyle(Theme.mutedForeground).frame(width: 36, height: 36) }
                            .buttonStyle(.plain)
                            .accessibilityLabel(t("Close", "Sluiten"))
                    }
                    // One round control: write, or stop while writing.
                    let ready = aiPending || !aiInstruction.trimmingCharacters(in: .whitespaces).isEmpty
                    Button { aiPending ? stopWriting() : startWriting() } label: {
                        Icon(aiPending ? "stop" : "arrow-up-02", size: aiPending ? 14 : 18)
                            .foregroundStyle(ready ? Theme.primaryForeground : Theme.mutedForeground)
                            .frame(width: 36, height: 36)
                            .background(ready ? Theme.primary : Theme.muted, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!ready)
                    .accessibilityLabel(aiPending ? t("Stop writing", "Stoppen met schrijven") : t("Write", "Schrijven"))
                } else {
                    if store.aiWriting {
                    Button {
                        aiOpen = true
                        aiFocused = true
                    } label: {
                        HStack(spacing: 7) {
                            Icon("sparkles", size: 18).foregroundStyle(Theme.accentText)
                            Text(written ? t("Rewrite with AI", "Herschrijven met AI") : t("Write with AI", "Schrijven met AI"))
                                .font(.inter(15, .medium, relativeTo: .subheadline))
                                .foregroundStyle(Theme.foreground)
                                .lineLimit(1)
                                .fixedSize()
                        }
                        .padding(.horizontal, 13)
                        .frame(minHeight: 38)
                        .overlay(Capsule().strokeBorder(Theme.border))
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    }
                    Spacer(minLength: 0)
                    if aiBefore != nil {
                        Button(t("Undo", "Ongedaan maken")) { undoWriting() }
                            .font(.inter(14, .semibold, relativeTo: .subheadline))
                            .foregroundStyle(Theme.accentText)
                            .lineLimit(1)
                            .fixedSize()
                            .accessibilityHint(t("Takes back what the AI wrote", "Haalt weg wat de AI schreef"))
                    }
                    // A forward carries the original's files; it takes none of its own.
                    if !isForward {
                        Menu {
                            Button { pickingPhotos = true } label: { Label { Text(t("Photos", "Foto's")) } icon: { Image("hi-image-02") } }
                            Button { pickingFiles = true } label: { Label { Text(t("Files", "Bestanden")) } icon: { Image("hi-folder-01") } }
                        } label: {
                            Icon("attachment-01", size: 20).foregroundStyle(Theme.foreground).frame(width: 40, height: 40)
                        }
                        .accessibilityLabel(t("Attach", "Bijlage toevoegen"))
                    }
                    if !isReply, !isForward {
                        Button { scheduling = true } label: {
                            Icon("clock-01", size: 20)
                                .foregroundStyle(canSend ? Theme.foreground : Theme.mutedForeground)
                                .frame(width: 40, height: 40)
                        }
                        .buttonStyle(.plain)
                        .disabled(!canSend)
                        .accessibilityLabel(t("Send later", "Later versturen"))
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 9)
        }
        .background(Theme.background)
    }

    // MARK: Files (`components/attachment-picker.tsx`)

    private var uploading: Bool { files.contains { !$0.failed && $0.progress < 1 } }

    /// The finished files, as a message refers to them.
    private var attachmentRefs: [AttachmentRef] {
        (draft?.attachments ?? []) + files.filter(\.isUploaded).map { AttachmentRef(uploadId: $0.uploadId ?? "", name: $0.name, contentType: $0.contentType, size: $0.size) }
    }

    private func fileRow(name: String, detail: String, progress: Double, failed: Bool, remove: (() -> Void)?) -> some View {
        HStack(spacing: 10) {
            Icon("attachment-01", size: 18).foregroundStyle(failed ? Theme.destructive : Theme.mutedForeground)
            VStack(alignment: .leading, spacing: 3) {
                Text(name).font(.inter(14, .medium, relativeTo: .subheadline)).foregroundStyle(Theme.foreground).lineLimit(1)
                if progress < 1, !failed {
                    ProgressView(value: progress).tint(Theme.accentText)
                } else {
                    Text(detail).font(.inter(12, relativeTo: .caption)).foregroundStyle(failed ? Theme.destructive : Theme.mutedForeground)
                }
            }
            Spacer(minLength: 0)
            if let remove {
                Button(action: remove) { Icon("cancel-01", size: 16).foregroundStyle(Theme.mutedForeground).frame(width: 36, height: 36) }
                    .buttonStyle(.plain)
                    .accessibilityLabel(t("Remove \(name)", "Verwijder \(name)"))
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, remove == nil ? 12 : 2)
        .frame(minHeight: 50)
        .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).strokeBorder(Theme.border))
    }

    private func attach(_ urls: [URL]) async {
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { continue }
            let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            await upload(data, name: url.lastPathComponent, contentType: type)
        }
    }

    private func attach(_ items: [PhotosPickerItem]) async {
        for (index, item) in items.enumerated() {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            let type = item.supportedContentTypes.first
            let name = "\(type?.conforms(to: .movie) == true ? "video" : "foto")-\(index + 1).\(type?.preferredFilenameExtension ?? "jpg")"
            await upload(data, name: name, contentType: type?.preferredMIMEType ?? "image/jpeg")
        }
    }

    private struct NewUpload: Encodable {
        let name: String
        let contentType: String
        let size: Int
    }

    private struct Created: Decodable { let id: String }

    /// Sends a file in chunks, one request each, so no request comes near the
    /// server's size limit.
    private func upload(_ data: Data, name: String, contentType: String) async {
        let total = attachmentRefs.reduce(0) { $0 + $1.size } + files.filter { !$0.isUploaded && !$0.failed }.reduce(0) { $0 + $1.size }
        guard total + data.count <= maxAttachmentBytes else {
            store.present(Toast(message: t("Together the files are larger than 25 MB.", "Samen zijn de bestanden groter dan 25 MB."), isError: true))
            return
        }
        let file = ComposerFile(name: name, contentType: contentType, size: data.count)
        files.append(file)
        func change(_ update: (inout ComposerFile) -> Void) {
            if let index = files.firstIndex(where: { $0.id == file.id }) { update(&files[index]) }
        }
        if Demo.enabled {
            change { $0.uploadId = "demo"; $0.progress = 1 }
            return
        }
        do {
            let created: Created = try await API.post("/api/mail/uploads", NewUpload(name: name, contentType: contentType, size: data.count))
            change { $0.uploadId = created.id }
            let chunks = max(1, Int((Double(data.count) / Double(uploadChunkBytes)).rounded(.up)))
            for index in 0..<chunks {
                // Removed meanwhile: stop sending the rest.
                guard files.contains(where: { $0.id == file.id }) else { return }
                let part = data.subdata(in: index * uploadChunkBytes..<min(data.count, (index + 1) * uploadChunkBytes))
                try await API.upload("/api/mail/uploads/\(created.id)/chunks/\(index)", part)
                change { $0.progress = Double(index + 1) / Double(chunks) }
            }
        } catch {
            change { $0.failed = true }
            store.show(error)
        }
    }

    private func remove(_ file: ComposerFile) {
        files.removeAll { $0.id == file.id }
        if let id = file.uploadId, !Demo.enabled { Task { try? await API.run("/api/mail/uploads/\(id)", method: "DELETE") } }
    }

    // MARK: Sending later

    private func schedule(_ date: Date) async {
        guard canSend, let account else { return }
        sending = true
        defer { sending = false }
        var message = outgoing()
        message.isDraft = true
        if case .draft(_, let draftId) = request.mode { message.draftId = draftId }
        message.attachmentsChanged = !files.isEmpty
        message.reply = draft?.reply
        message.sendAt = date
        do {
            try await API.run("/api/mail/accounts/\(account.id.queryEncoded)/scheduled", message)
            store.present(Toast(message: t("Will be sent \(formatMoment(date))", "Wordt verstuurd \(formatMoment(date))")))
            await store.refreshCounts()
            dismiss()
        } catch {
            store.show(error)
        }
    }

    private struct WriteBody: Encodable {
        let instruction: String
        let draft: String
        let subject: String
        let hasSignature: Bool
        let forward: Bool
    }

    private func startWriting() {
        guard !aiPending, !aiInstruction.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        aiTask = Task { await write() }
    }

    /// Stops the model and keeps what it wrote so far.
    private func stopWriting() {
        aiTask?.cancel()
    }

    private func closeAi() {
        aiOpen = false
        focus = .body
    }

    private func undoWriting() {
        guard let before = aiBefore else { return }
        text = before.text
        subject = before.subject
        aiBefore = nil
    }

    private func write() async {
        let before = (text: text, subject: subject)
        // A new message with no subject yet gets one from the model.
        let fillsSubject = !isReply && !isForward && subject.trimmingCharacters(in: .whitespaces).isEmpty
        let path: String
        switch request.mode {
        case .reply(let thread, _, _), .forward(let thread, _): path = conversationPath(thread.id, "/write")
        case .new, .draft: path = "/api/mail/write"
        }
        let body = WriteBody(instruction: aiInstruction.trimmingCharacters(in: .whitespaces), draft: text, subject: subject, hasSignature: signature != nil, forward: isForward)
        aiPending = true
        var raw = ""
        do {
            if Demo.enabled {
                for word in Demo.written.split(separator: " ", omittingEmptySubsequences: false) {
                    raw += (raw.isEmpty ? "" : " ") + word
                    text = parseWritten(raw, done: false).text
                    try await Task.sleep(nanoseconds: 40_000_000)
                }
            } else {
                for try await soFar in API.stream(path, body) {
                    raw = soFar
                    let partial = parseWritten(raw, done: false)
                    text = partial.text
                    if fillsSubject, let found = partial.subject { subject = found }
                }
            }
        } catch {
            // Stopped by hand: what is there stays. Anything else puts the old text back.
            if !(error is CancellationError), !Task.isCancelled {
                text = before.text
                subject = before.subject
                aiPending = false
                store.show(error)
                return
            }
        }
        aiPending = false
        let result = parseWritten(raw)
        guard !result.text.isEmpty else {
            text = before.text
            subject = before.subject
            if !Task.isCancelled { store.present(Toast(message: t("The AI wrote nothing. Try describing it differently.", "De AI schreef niets. Probeer het anders te omschrijven."), isError: true)) }
            return
        }
        text = result.text
        if fillsSubject, let found = result.subject { subject = found }
        aiBefore = before
        aiOpen = false
        aiInstruction = ""
    }

    // MARK: Start

    private func prepare() async {
        guard !ready else { return }
        ready = true
        switch request.mode {
        case .new:
            accountId = store.defaultAccount?.id ?? ""
            if Demo.enabled, request.prefill == "attach" {
                to = [MailAddress(name: "Lars Visser", email: "lars@example.com")]
                subject = "Offerte website"
                text = "Hoi Lars,\n\nHierbij de getekende offerte.\n\nGroet,\nSam"
                files = [ComposerFile(name: "Offerte-getekend.pdf", contentType: "application/pdf", size: 312_000, uploadId: "demo", progress: 1)]
            }
        case .reply(let thread, let message, let all):
            accountId = thread.accountId
            let recipients = replyRecipients(message, selfEmail: account?.email ?? "", all: all)
            to = recipients.to
            cc = recipients.cc
            if Demo.enabled, request.prefill == "ai" {
                aiInstruction = "zeg dat donderdag past"
                aiOpen = true
                await write()
                return
            }
            // A suggested reply is a start: it stands there ready to change.
            if let prefill = request.prefill { text = prefill }
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
        var sendAt: Date?
        /// Saving a draft: the API wants `draftId` named even when there is none yet.
        var isDraft = false

        private enum CodingKeys: String, CodingKey {
            case messageId, to, cc, bcc, subject, text, html, attachments, inline, draftId, attachmentsChanged, reply, sendAt
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
            try container.encodeIfPresent(sendAt, forKey: .sendAt)
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
            text: body, html: wrapEmailHtml(html), attachments: attachmentRefs, inline: inline.isEmpty ? nil : inline
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
                message.attachmentsChanged = !files.isEmpty
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
        message.attachmentsChanged = !files.isEmpty
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
