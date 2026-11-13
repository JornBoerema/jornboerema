import SwiftUI

/// What sits above a conversation besides its summary: the parcel or invoice
/// it is about, and the tasks made from it (`components/parcels.tsx`,
/// `invoices.tsx`, `todo-from-mail.tsx`, `moneybird-button.tsx`).
struct ConversationExtras: View {
    let thread: MailThread
    let messages: [MailMessage]

    @Environment(MailStore.self) private var store
    @Environment(Navigator.self) private var navigator
    @State private var shipment: Shipment?
    @State private var invoice: Invoice?
    @State private var todos: [MailTodo] = []

    private struct ShipmentAnswer: Decodable { let shipment: Shipment? }
    private struct InvoiceAnswer: Decodable { let invoice: Invoice? }
    private struct TodosAnswer: Decodable { let todos: [MailTodo] }

    var body: some View {
        VStack(spacing: 8) {
            if let shipment { ShipmentCard(shipment: shipment) }
            if let invoice { InvoiceCard(invoice: invoice, thread: thread, messages: messages) }
            ForEach(todos) { todo in
                Button {
                    if let url = URL(string: todo.url) { UIApplication.shared.open(url) }
                } label: {
                    HStack(spacing: 10) {
                        Icon(todo.completed ? "task-done-01" : "task-01", size: 18)
                            .foregroundStyle(todo.completed ? Theme.mutedForeground : Theme.accentText)
                        Text(todo.title)
                            .font(.inter(15, relativeTo: .subheadline))
                            .foregroundStyle(todo.completed ? Theme.mutedForeground : Theme.foreground)
                            .strikethrough(todo.completed)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        Text(todo.listName)
                            .font(.inter(12.5, relativeTo: .caption))
                            .foregroundStyle(Theme.mutedForeground)
                            .lineLimit(1)
                        Icon("arrow-up-right-01", size: 14).foregroundStyle(Theme.mutedForeground)
                    }
                    .extraCard()
                }
                .buttonStyle(.plain)
                .accessibilityHint(t("Opens in Even doen", "Opent in Even doen"))
            }
        }
        .task { await load() }
        // A task just made from this conversation shows at once.
        .onChange(of: navigator.todo == nil) { _, closed in
            if closed { Task { await loadTodos() } }
        }
    }

    private func load() async {
        if Demo.enabled {
            if thread.id == Demo.threads[2].id { invoice = Demo.invoices[1] }
            return
        }
        async let parcel: ShipmentAnswer? = store.preferences.parcels != false ? try? await API.get(conversationPath(thread.id, "/shipment")) : nil
        async let bill: InvoiceAnswer? = store.preferences.invoices != false ? try? await API.get(conversationPath(thread.id, "/invoice")) : nil
        async let tasks: Void = loadTodos()
        let (foundParcel, foundBill, _) = await (parcel, bill, tasks)
        withAnimation(.snappy(duration: 0.2)) {
            shipment = foundParcel?.shipment
            invoice = foundBill?.invoice
        }
    }

    private func loadTodos() async {
        guard !Demo.enabled, store.preferences.todos != false else { return }
        if let answer: TodosAnswer = try? await API.get(conversationPath(thread.id, "/todos")) {
            withAnimation(.snappy(duration: 0.2)) { todos = answer.todos }
        }
    }
}

private extension View {
    func extraCard() -> some View {
        padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).strokeBorder(Theme.border))
    }
}

/// A small button inside a card: outlined, or filled for the thing to do.
private struct CardButton: View {
    let title: String
    var icon: String?
    var filled = false
    var busy = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if busy { ProgressView().controlSize(.small) } else if let icon { Icon(icon, size: 15) }
                Text(title).font(.inter(14, .medium, relativeTo: .subheadline)).lineLimit(1)
            }
            .foregroundStyle(filled ? Theme.primaryForeground : Theme.foreground)
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .background(filled ? Theme.primary : Theme.background, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(filled ? .clear : Theme.border))
        }
        .buttonStyle(.plain)
        .disabled(busy)
    }
}

private struct ShipmentCard: View {
    let shipment: Shipment

    var body: some View {
        HStack(spacing: 12) {
            Icon(shipment.status == "delivered" ? "package-delivered" : "package", size: 22)
                .foregroundStyle(ParcelsView.tone(shipment.status))
            VStack(alignment: .leading, spacing: 2) {
                Text(shipment.statusLabel)
                    .font(.inter(15, .medium, relativeTo: .subheadline))
                    .foregroundStyle(Theme.foreground)
                Text([shipment.carrierName, shipment.trackingCode].compactMap { $0 }.joined(separator: " · "))
                    .font(.inter(13, relativeTo: .footnote))
                    .foregroundStyle(Theme.mutedForeground)
                    .lineLimit(1)
                    .textSelection(.enabled)
            }
            Spacer(minLength: 8)
            if let link = shipment.trackingUrl, let url = URL(string: link) {
                CardButton(title: t("Track", "Volgen"), icon: "arrow-up-right-01") { UIApplication.shared.open(url) }
            }
        }
        .extraCard()
    }
}

/// The invoice a conversation carries: what, how much, by when; paying it, and
/// putting its file in Moneybird's inbox.
private struct InvoiceCard: View {
    let invoice: Invoice
    let thread: MailThread
    let messages: [MailMessage]

    @Environment(MailStore.self) private var store
    @State private var moneybird: MoneybirdThread?
    @State private var sending = false
    @State private var choosing = false

    private struct File {
        let message: MailMessage
        let attachment: MailAttachment
        var key: String { "\(attachment.size):\(attachment.name)" }
    }

    private struct SendBody: Encodable {
        let messageId: String
        let attachmentId: String
        let name: String
        let contentType: String
        let size: Int
        let administrationId: String
        let subject: String
    }

    private struct Sent: Decodable {
        let export: MoneybirdExport
    }

    /// Files worth booking: PDFs first, pictures only without one, and of
    /// those the one named most like an invoice (`bookableFiles`, `likeliestInvoiceFile`).
    private var file: File? {
        let all = messages.reversed().flatMap { message in message.attachments.map { File(message: message, attachment: $0) } }
            .filter { $0.attachment.size > 0 && $0.attachment.size <= 25 * 1024 * 1024 }
        func matches(_ text: String, _ pattern: String) -> Bool { text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil }
        let pdfs = all.filter { matches($0.attachment.contentType, "pdf") || matches($0.attachment.name, #"\.pdf$"#) }
        let pictures = all.filter { (matches($0.attachment.contentType, #"^image/(jpe?g|png|heic|heif|webp)$"#) || matches($0.attachment.name, #"\.(jpe?g|png|heic)$"#)) && $0.attachment.size > 20_000 }
        func score(_ file: File) -> Int {
            (matches(file.attachment.name, "factuur|invoice|receipt|nota|bon|rekening|rechnung|credit") ? 2 : 0)
                - (matches(file.attachment.name, "voorwaarden|terms|conditions|privacy|algemene|brochure|flyer|nieuwsbrief|newsletter") ? 3 : 0)
        }
        return (pdfs.isEmpty ? pictures : pdfs).reduce(nil) { best, next in best == nil || score(next) > score(best!) ? next : best }
    }

    private var sent: MoneybirdExport? {
        guard let file else { return nil }
        return moneybird?.exports.first { $0.attachmentKey == file.key }
    }

    /// Where it goes without asking: where this sender's mail went before, the
    /// default, or the only administration there is.
    private var target: MoneybirdAdministration? {
        guard let connection = store.moneybird else { return nil }
        let known = { (id: String?) in connection.administrations.first { $0.id == id } }
        return known(moneybird?.suggestedAdministrationId) ?? known(connection.defaultTarget?.id) ?? (connection.administrations.count == 1 ? connection.administrations.first : nil)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Icon("invoice-02", size: 22).foregroundStyle(InvoicesView.tone(invoice))
                VStack(alignment: .leading, spacing: 2) {
                    Text(invoice.vendor ?? invoice.subject)
                        .font(.inter(15, .medium, relativeTo: .subheadline))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(1)
                    Text(InvoicesView.detail(Invoice(vendor: nil, amountCents: invoice.amountCents, currency: invoice.currency, dueDate: invoice.dueDate, invoiceNumber: nil, payUrl: nil, status: invoice.status, overdue: invoice.overdue, subject: "", receivedAt: invoice.receivedAt, thread: nil)))
                        .font(.inter(13, relativeTo: .footnote))
                        .foregroundStyle(invoice.overdue ? Theme.destructive : Theme.mutedForeground)
                    if let number = invoice.invoiceNumber {
                        Text("\(t("Invoice number", "Factuurnummer")) \(number)")
                            .font(.inter(13, relativeTo: .footnote))
                            .foregroundStyle(Theme.mutedForeground)
                            .textSelection(.enabled)
                    }
                }
                Spacer(minLength: 8)
                Text(invoice.amount ?? t("Amount in the attachment", "Bedrag in de bijlage"))
                    .font(.inter(invoice.amount == nil ? 13 : 17, invoice.amount == nil ? .regular : .semibold, relativeTo: .subheadline))
                    .monospacedDigit()
                    .foregroundStyle(invoice.amount == nil ? Theme.mutedForeground : Theme.foreground)
            }
            let pay = invoice.isOpen ? invoice.payUrl.flatMap(URL.init(string:)) : nil
            if pay != nil || (store.moneybird != nil && file != nil) {
                HStack(spacing: 8) {
                    if let pay { CardButton(title: t("Pay", "Betalen"), icon: "arrow-up-right-01", filled: true) { UIApplication.shared.open(pay) } }
                    if store.moneybird != nil, file != nil {
                        if let sent {
                            CardButton(title: t("In the inbox of \(sent.administrationName)", "In de inbox van \(sent.administrationName)"), icon: "tick-02") {
                                if let url = URL(string: sent.url) { UIApplication.shared.open(url) }
                            }
                        } else {
                            CardButton(title: t("To Moneybird", "Naar Moneybird"), icon: "share-08", busy: sending) {
                                if let target { Task { await send(to: target) } } else { choosing = true }
                            }
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .extraCard()
        .task {
            guard !Demo.enabled, store.moneybird != nil, file != nil else { return }
            moneybird = try? await API.get(conversationPath(thread.id, "/moneybird"))
        }
        .confirmationDialog(t("Choose an administration", "Kies een administratie"), isPresented: $choosing, titleVisibility: .visible) {
            ForEach(store.moneybird?.administrations ?? []) { administration in
                Button(administration.name) { Task { await send(to: administration) } }
            }
            Button(t("Cancel", "Annuleren"), role: .cancel) {}
        }
    }

    private func send(to administration: MoneybirdAdministration) async {
        guard let file, !sending else { return }
        sending = true
        defer { sending = false }
        do {
            let body = SendBody(
                messageId: file.message.id, attachmentId: file.attachment.id, name: file.attachment.name,
                contentType: file.attachment.contentType, size: file.attachment.size,
                administrationId: administration.id, subject: String(thread.subject.prefix(900))
            )
            let answer: Sent = try await API.post(conversationPath(thread.id, "/moneybird"), body)
            var next = moneybird ?? MoneybirdThread(exports: [], suggestedAdministrationId: nil)
            next.exports.insert(answer.export, at: 0)
            next.suggestedAdministrationId = answer.export.administrationId
            moneybird = next
            store.present(Toast(message: t("Put in Moneybird, in the inbox of \(answer.export.administrationName)", "In Moneybird gezet, in de inbox van \(answer.export.administrationName)")))
        } catch {
            store.show(error)
        }
    }
}

/// A task for Even doen from a mail: the task as it will look there, and its
/// list (`components/todo-from-mail.tsx`).
struct TodoSheet: View {
    let thread: MailThread

    @Environment(MailStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var lists: [TodoList]?
    @State private var listId: String?
    @State private var saving = false
    @FocusState private var focused: Bool

    private struct Lists: Decodable { let lists: [TodoList] }
    private struct TodoBody: Encodable {
        let listId: String
        let title: String
    }

    private static let lastListKey = "todo-list"

    init(thread: MailThread) {
        self.thread = thread
        _title = State(initialValue: thread.subject.replacingOccurrences(of: #"^((re|fwd?|aw|antw)\s*:\s*)+"#, with: "", options: [.regularExpression, .caseInsensitive]))
    }

    private var workspaces: [(name: String, lists: [TodoList])] {
        var order: [String] = []
        var groups: [String: [TodoList]] = [:]
        for list in lists ?? [] {
            if groups[list.workspaceId] == nil { order.append(list.workspaceId) }
            groups[list.workspaceId, default: []].append(list)
        }
        return order.map { id in (groups[id]?.first?.workspaceName ?? "", groups[id] ?? []) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .top, spacing: 12) {
                            RoundedRectangle(cornerRadius: 5, style: .continuous)
                                .strokeBorder(Theme.foreground.opacity(0.35), lineWidth: 1.5)
                                .frame(width: 18, height: 18)
                                .padding(.top, 3)
                            TextField(t("What needs doing?", "Wat moet er gebeuren?"), text: $title, axis: .vertical)
                                .font(.inter(16, .medium))
                                .lineLimit(1...4)
                                .focused($focused)
                        }
                        HStack(spacing: 6) {
                            Icon("mail-01", size: 13)
                            Text(thread.fromName ?? thread.fromEmail ?? thread.title).lineLimit(1)
                        }
                        .font(.inter(12.5, relativeTo: .caption))
                        .foregroundStyle(Theme.mutedForeground)
                        .padding(.leading, 30)
                    }
                    .padding(14)
                    .background(Theme.foreground.opacity(0.05), in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).strokeBorder(focused ? Theme.accentText.opacity(0.55) : Theme.border))

                    if let lists {
                        if lists.isEmpty {
                            Text(t("Make a list in Even doen first.", "Maak eerst een lijst in Even doen."))
                                .font(.inter(15, relativeTo: .subheadline))
                                .foregroundStyle(Theme.mutedForeground)
                        }
                        ForEach(workspaces, id: \.name) { workspace in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(workspace.name)
                                    .font(.inter(13, .medium, relativeTo: .footnote))
                                    .foregroundStyle(Theme.mutedForeground)
                                    .padding(.leading, 12)
                                    .padding(.bottom, 4)
                                ForEach(workspace.lists) { list in
                                    let selected = list.id == listId
                                    Button { listId = list.id } label: {
                                        HStack(spacing: 12) {
                                            Icon("left-to-right-list-bullet", size: 18)
                                                .foregroundStyle(selected ? Theme.accentText : Theme.mutedForeground)
                                            Text(list.name)
                                                .font(.inter(16, selected ? .medium : .regular))
                                                .foregroundStyle(Theme.foreground)
                                            Spacer()
                                            if selected { Icon("tick-02", size: 18).foregroundStyle(Theme.accentText) }
                                        }
                                        .padding(.horizontal, 12)
                                        .frame(minHeight: 46)
                                        .background(selected ? Theme.accent : .clear, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityAddTraits(selected ? .isSelected : [])
                                }
                            }
                        }
                    } else {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle(t("Task from mail", "Taak uit mail"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("Cancel", "Annuleren")) { dismiss() }.foregroundStyle(Theme.foreground)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await save() } } label: {
                        if saving { ProgressView() } else { Text(t("Add", "Toevoegen")).font(.inter(16, .semibold)) }
                    }
                    .disabled(saving || listId == nil || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .overlay(alignment: .bottom) { ToastView().environment(store) }
        .task {
            if Demo.enabled {
                lists = Demo.todoLists
            } else {
                let answer: Lists? = try? await API.get("/api/mail/todo-lists")
                lists = answer?.lists ?? []
            }
            // The list picked last time, so the next task goes there without asking.
            let last = UserDefaults.standard.string(forKey: Self.lastListKey)
            listId = lists?.first { $0.id == last }?.id ?? lists?.first?.id
        }
    }

    private func save() async {
        guard let listId else { return }
        saving = true
        defer { saving = false }
        do {
            try await API.run(conversationPath(thread.id, "/todo"), TodoBody(listId: listId, title: title.trimmingCharacters(in: .whitespacesAndNewlines)))
            UserDefaults.standard.set(listId, forKey: Self.lastListKey)
            let name = lists?.first { $0.id == listId }?.name ?? ""
            store.present(Toast(message: t("Task added to \(name)", "Taak toegevoegd aan \(name)")))
            dismiss()
        } catch {
            store.show(error)
        }
    }
}
