import SwiftUI

/// The places that list something other than conversations: parcels, invoices,
/// scheduled mail and senders (`ParcelRow`, `InvoiceRow`, `LaterRow` and
/// `SenderRow` in `pages/inbox.tsx`).
struct PlaceView: View {
    let place: Place

    var body: some View {
        switch place {
        case .parcels: ParcelsView()
        case .invoices: InvoicesView()
        case .scheduled: ScheduledView()
        case .senders: SendersView()
        default: ThreadListView(place: place)
        }
    }
}

private struct Scan: Decodable {
    let done: Bool
    let read: Int
}

/// Reads mail not seen yet, round after round, while the list shows what is
/// already known (`lib/scan.ts`). `found` runs after each round that read something.
private func scan(_ path: String, found: () async -> Void) async {
    for _ in 0..<60 {
        guard !Task.isCancelled, let round: Scan = try? await API.post(path) else { return }
        if round.read > 0 { await found() }
        if round.done { return }
        try? await Task.sleep(nanoseconds: 500_000_000)
    }
}

private extension View {
    /// What every place shares: the plain list, its title and the compose button.
    func placeChrome(_ place: Place) -> some View {
        modifier(PlaceChrome(place: place))
    }

    func placeRow() -> some View {
        listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 1, leading: 8, bottom: 1, trailing: 8))
            .listRowBackground(Color.clear)
    }
}

private struct PlaceChrome: ViewModifier {
    let place: Place
    @Environment(MailStore.self) private var store
    @Environment(Navigator.self) private var navigator

    func body(content: Content) -> some View {
        content
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle(place.title)
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItemGroup(placement: .bottomBar) {
                    Spacer()
                    Button { navigator.compose = ComposeRequest(mode: .new) } label: { Icon("pencil-edit-02", size: 22) }
                        .accessibilityLabel(t("New message", "Nieuw bericht"))
                }
            }
            .onAppear { store.showing(place) }
    }
}

/// A coloured dot for a status, in the gutter where unread mail has its dot.
private struct StatusDot: View {
    let color: Color

    var body: some View {
        Circle().fill(color).frame(width: 8, height: 8).frame(width: 24, height: 22)
    }
}

/// Two lines beside a dot: the shape every row in these places has.
private struct PlaceRow<Trailing: View>: View {
    let dot: Color
    let title: String
    let detail: String
    var strong = false
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            StatusDot(color: dot)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.inter(16, strong ? .semibold : .medium))
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(1)
                Text(detail)
                    .font(.inter(14.5, relativeTo: .subheadline))
                    .foregroundStyle(Theme.mutedForeground)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            trailing
        }
        .padding(.vertical, 9)
        .padding(.trailing, 12)
        .contentShape(Rectangle())
    }
}

// MARK: Parcels

struct ParcelsView: View {
    @Environment(MailStore.self) private var store
    @Environment(Navigator.self) private var navigator
    @State private var shipments: [Shipment] = []
    @State private var loaded = false
    @State private var reading = false
    @State private var error: String?

    private struct Answer: Decodable { let shipments: [Shipment] }

    static func tone(_ status: String?) -> Color {
        switch status {
        case "in_transit": Color(oklch(0.685, 0.169, 237))
        case "out_for_delivery": Theme.accentText
        case "pickup": Color(oklch(0.606, 0.25, 292))
        case "delivered": Color(oklch(0.696, 0.17, 162))
        case "problem": Theme.destructive
        default: Theme.mutedForeground.opacity(0.5)
        }
    }

    var body: some View {
        @Bindable var navigator = navigator
        List(selection: $navigator.selection) {
            if reading {
                Notice(icon: "package", text: t("Still reading some shipping mail; more may follow.", "Nog bezig met wat verzendmail; er kunnen er meer bijkomen."))
                    .placeRow()
                    .padding(.horizontal, 4)
            }
            ForEach(Array(shipments.enumerated()), id: \.offset) { _, shipment in
                PlaceRow(
                    dot: Self.tone(shipment.status),
                    title: shipment.title,
                    detail: [shipment.statusLabel, shipment.carrierName, shipment.trackingCode].compactMap { $0 }.joined(separator: " · ")
                ) {
                    Text(shortDate(shipment.receivedAt))
                        .font(.inter(12.5, relativeTo: .caption))
                        .monospacedDigit()
                        .foregroundStyle(Theme.mutedForeground)
                }
                .tag(shipment.thread?.id ?? "")
                .placeRow()
                .swipeActions(edge: .trailing) {
                    if let link = shipment.trackingUrl, let url = URL(string: link) {
                        Button { UIApplication.shared.open(url) } label: {
                            Label { Text(t("Track", "Volgen")) } icon: { Image("hi-arrow-up-right-01") }
                        }
                        .tint(Theme.primary)
                    }
                }
            }
        }
        .placeChrome(.parcels)
        .overlay {
            if !loaded {
                if let error { EmptyState(icon: "cloud-alert", title: t("Could not load the parcels", "De pakketjes konden niet geladen worden"), text: error) } else { ProgressView() }
            } else if shipments.isEmpty, !reading {
                EmptyState(icon: "package", title: t("No parcels on their way", "Geen pakketjes onderweg"), text: t("Shipping mail with a track & trace link shows up here.", "Verzendmail met een track & trace-link komt hier te staan."))
            }
        }
        .refreshable { await load() }
        .task {
            await load()
            guard !Demo.enabled else { return }
            reading = true
            await scan("/api/mail/shipments/scan") { await load() }
            reading = false
        }
        .onChange(of: navigator.selection) { _, id in
            if let thread = shipments.compactMap(\.thread).first(where: { $0.id == id }) { navigator.opened = thread }
        }
    }

    private func load() async {
        if Demo.enabled {
            shipments = Demo.shipments
            loaded = true
            return
        }
        do {
            let answer: Answer = try await API.get("/api/mail/shipments")
            shipments = answer.shipments
            loaded = true
        } catch {
            self.error = errorText(error)
        }
    }
}

// MARK: Invoices

struct InvoicesView: View {
    @Environment(MailStore.self) private var store
    @Environment(Navigator.self) private var navigator
    @State private var invoices: [Invoice] = []
    @State private var loaded = false
    @State private var reading = false
    @State private var error: String?
    @State private var filter = Filter.all

    private enum Filter: Hashable { case all, due, paid }
    private struct Answer: Decodable { let invoices: [Invoice] }

    /// A dot's colour per status: green paid, muted automatic, orange to pay, red late or failed.
    static func tone(_ invoice: Invoice) -> Color {
        if invoice.status == "failed" || invoice.overdue { return Theme.destructive }
        if invoice.status == "paid" { return Color(oklch(0.696, 0.17, 162)) }
        if invoice.status == "auto" { return Theme.mutedForeground.opacity(0.5) }
        return Theme.accentText
    }

    static func detail(_ invoice: Invoice) -> String {
        var parts = [invoice.overdue ? t("Overdue", "Te laat") : invoice.statusLabel]
        if invoice.isOpen, let due = invoice.due {
            let formatter = DateFormatter()
            formatter.locale = Prefs.shared.locale
            formatter.setLocalizedDateFormatFromTemplate("d MMM")
            parts.append(t("by \(formatter.string(from: due))", "vóór \(formatter.string(from: due))"))
        }
        if invoice.vendor != nil { parts.append(invoice.subject) }
        return parts.joined(separator: " · ")
    }

    private var shown: [Invoice] {
        switch filter {
        case .all: invoices
        case .due: invoices.filter(\.isOpen)
        case .paid: invoices.filter { $0.status == "paid" }
        }
    }

    /// What is still to pay, when it is all in one currency.
    private var dueLabel: String {
        let open = invoices.filter(\.isOpen)
        let currencies = Set(open.map { $0.currency ?? "EUR" })
        let label = t("To pay", "Te betalen")
        guard !open.isEmpty, currencies.count == 1, let currency = currencies.first else { return label }
        return "\(label) \(formatMoney(open.compactMap(\.amountCents).reduce(0, +), currency: currency, round: true))"
    }

    var body: some View {
        @Bindable var navigator = navigator
        List(selection: $navigator.selection) {
            Segmented(selection: $filter, options: [(.all, t("All", "Alles")), (.due, dueLabel), (.paid, t("Paid", "Betaald"))])
                .placeRow()
                .padding(.horizontal, 6)
                .padding(.bottom, 6)
            if reading {
                Notice(icon: "invoice-02", text: t("Still reading some mail about money; more may follow.", "Nog bezig met wat mail over geld; er kunnen er meer bijkomen."))
                    .placeRow()
                    .padding(.horizontal, 4)
            }
            ForEach(Array(shown.enumerated()), id: \.offset) { _, invoice in
                PlaceRow(dot: Self.tone(invoice), title: invoice.vendor ?? invoice.subject, detail: Self.detail(invoice), strong: invoice.isOpen) {
                    Text(invoice.amount ?? shortDate(invoice.receivedAt))
                        .font(.inter(15, invoice.isOpen ? .semibold : .regular, relativeTo: .subheadline))
                        .monospacedDigit()
                        .foregroundStyle(invoice.amount == nil ? Theme.mutedForeground : Theme.foreground)
                }
                .tag(invoice.thread?.id ?? "")
                .placeRow()
                .swipeActions(edge: .trailing) {
                    if invoice.isOpen, let link = invoice.payUrl, let url = URL(string: link) {
                        Button { UIApplication.shared.open(url) } label: {
                            Label { Text(t("Pay", "Betalen")) } icon: { Image("hi-arrow-up-right-01") }
                        }
                        .tint(Theme.primary)
                    }
                }
            }
        }
        .placeChrome(.invoices)
        .overlay {
            if !loaded {
                if let error { EmptyState(icon: "cloud-alert", title: t("Could not load the invoices", "De facturen konden niet geladen worden"), text: error) } else { ProgressView() }
            } else if invoices.isEmpty, !reading {
                EmptyState(icon: "invoice-02", title: t("No invoices", "Geen facturen"), text: t("No invoices or payments in your mail of the last months.", "Geen facturen of betalingen in je mail van de laatste maanden."))
            } else if shown.isEmpty, !reading {
                Text(t("Nothing here.", "Hier staat niets.")).font(.inter(15)).foregroundStyle(Theme.mutedForeground)
            }
        }
        .refreshable { await load() }
        .task {
            await load()
            guard !Demo.enabled else { return }
            reading = true
            await scan("/api/mail/invoices/scan") { await load() }
            reading = false
        }
        .onChange(of: navigator.selection) { _, id in
            if let thread = invoices.compactMap(\.thread).first(where: { $0.id == id }) { navigator.opened = thread }
        }
    }

    private func load() async {
        if Demo.enabled {
            invoices = Demo.invoices
            loaded = true
            return
        }
        do {
            let answer: Answer = try await API.get("/api/mail/invoices")
            invoices = answer.invoices
            loaded = true
        } catch {
            self.error = errorText(error)
        }
    }
}

// MARK: Scheduled

struct ScheduledView: View {
    @Environment(MailStore.self) private var store
    @Environment(Navigator.self) private var navigator
    @State private var scheduled: [ScheduledMail] = []
    @State private var loaded = false
    @State private var picked: ScheduledMail?

    private struct Answer: Decodable { let scheduled: [ScheduledMail] }

    var body: some View {
        List {
            ForEach(scheduled) { mail in
                Button { picked = mail } label: {
                    PlaceRow(
                        dot: mail.failed ? Theme.destructive : Theme.accentText,
                        title: mail.subject.isEmpty ? t("(no subject)", "(geen onderwerp)") : mail.subject,
                        detail: t("To: \(mail.to.map(\.label).joined(separator: ", "))", "Aan: \(mail.to.map(\.label).joined(separator: ", "))")
                    ) {
                        Text(mail.failed ? t("Not sent", "Niet verstuurd") : formatMoment(mail.sendAt))
                            .font(.inter(12.5, relativeTo: .caption))
                            .monospacedDigit()
                            .foregroundStyle(mail.failed ? Theme.destructive : Theme.accentText)
                    }
                }
                .buttonStyle(.plain)
                .placeRow()
                .swipeActions(edge: .trailing) {
                    Button { Task { await sendNow(mail) } } label: { Label { Text(t("Send now", "Nu versturen")) } icon: { Image("hi-sent") } }
                        .tint(Theme.primary)
                    Button { Task { await cancel(mail) } } label: { Label { Text(t("Keep as draft", "Als concept")) } icon: { Image("hi-file-01") } }
                        .tint(Color(oklch(0.55, 0.02, 260)))
                }
            }
        }
        .placeChrome(.scheduled)
        .overlay {
            if !loaded { ProgressView() } else if scheduled.isEmpty {
                EmptyState(icon: "mail-send-01", title: t("Nothing scheduled", "Niets gepland"), text: t("Choose Send later in a message to send it at a set moment.", "Kies Later versturen in een bericht om het op een vast moment te versturen."))
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .confirmationDialog(picked?.subject ?? "", isPresented: Binding(get: { picked != nil }, set: { if !$0 { picked = nil } }), titleVisibility: .visible) {
            if let mail = picked {
                Button(t("Send now", "Nu versturen")) { Task { await sendNow(mail) } }
                Button(t("Don't send; keep as a draft", "Niet versturen; als concept bewaren")) { Task { await cancel(mail) } }
                Button(t("Cancel", "Annuleren"), role: .cancel) {}
            }
        }
    }

    private func load() async {
        guard !Demo.enabled else {
            loaded = true
            return
        }
        if let answer: Answer = try? await API.get("/api/mail/scheduled") { scheduled = answer.scheduled }
        loaded = true
        store.scheduledCount = scheduled.count
    }

    private func sendNow(_ mail: ScheduledMail) async {
        do {
            try await API.run("/api/mail/scheduled/\(mail.id.queryEncoded)/send")
            store.present(Toast(message: t("Sent", "Verstuurd")))
            store.syncSoon()
        } catch { store.show(error) }
        await load()
    }

    private func cancel(_ mail: ScheduledMail) async {
        do {
            try await API.run("/api/mail/scheduled/\(mail.id.queryEncoded)", method: "DELETE")
            store.present(Toast(message: t("Kept as a draft", "Bewaard als concept")))
        } catch { store.show(error) }
        await load()
    }
}

// MARK: Senders

struct SendersView: View {
    @Environment(MailStore.self) private var store
    @Environment(Navigator.self) private var navigator
    @State private var senders: [Sender] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var picked: Sender?

    private struct Answer: Decodable { let senders: [Sender] }

    static func count(_ sender: Sender) -> String {
        var parts = [sender.messages == 1 ? t("1 message", "1 bericht") : t("\(sender.messages) messages", "\(sender.messages) berichten")]
        if sender.unread > 0 { parts.append(t("\(sender.unread) unread", "\(sender.unread) ongelezen")) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        List {
            if loaded, !senders.isEmpty {
                Text(t("Who fills your inbox, busiest first.", "Wie je inbox vult, de drukste eerst."))
                    .font(.inter(14, relativeTo: .subheadline))
                    .foregroundStyle(Theme.mutedForeground)
                    .placeRow()
                    .padding(.horizontal, 12)
                    .padding(.bottom, 6)
            }
            ForEach(senders) { sender in
                Button { picked = sender } label: {
                    HStack(spacing: 12) {
                        ContactAvatar(name: sender.name, email: sender.email, size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(sender.label)
                                .font(.inter(16, sender.unread > 0 ? .semibold : .medium))
                                .foregroundStyle(Theme.foreground)
                                .lineLimit(1)
                            Text(Self.count(sender))
                                .font(.inter(14, relativeTo: .subheadline))
                                .foregroundStyle(Theme.mutedForeground)
                        }
                        Spacer(minLength: 8)
                        Icon("arrow-right-01", size: 16).foregroundStyle(Theme.mutedForeground)
                    }
                    .padding(.vertical, 8)
                    .padding(.horizontal, 12)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .placeRow()
            }
        }
        .placeChrome(.senders)
        .overlay {
            if !loaded {
                if let error { EmptyState(icon: "cloud-alert", title: t("Could not load the senders", "De afzenders konden niet geladen worden"), text: error) } else { ProgressView() }
            } else if senders.isEmpty {
                EmptyState(icon: "clean", title: t("Nothing to tidy up", "Niets op te ruimen"), text: t("Nobody has more than one message in your inbox.", "Niemand heeft meer dan één bericht in je inbox."))
            }
        }
        .refreshable { await load() }
        .task(id: store.accountFilter) { await load() }
        .sheet(item: $picked, onDismiss: { Task { await load() } }) { sender in
            SenderSheet(sender: sender).environment(store).environment(navigator)
        }
    }

    private func load() async {
        if Demo.enabled {
            senders = Demo.senders
            loaded = true
            return
        }
        do {
            let query = store.accountFilter.isEmpty ? "" : "?account=\(store.accountFilter.queryEncoded)"
            let answer: Answer = try await API.get("/api/mail/senders\(query)")
            senders = answer.senders
            loaded = true
        } catch {
            self.error = errorText(error)
        }
    }
}

/// One sender: everything from them at once, and their conversations
/// (`components/sender-pane.tsx`, `useTidy` in `lib/senders.ts`).
private struct SenderSheet: View {
    let sender: Sender

    @Environment(MailStore.self) private var store
    @Environment(Navigator.self) private var navigator
    @Environment(\.dismiss) private var dismiss
    @State private var threads: [MailThread]?
    @State private var confirming: String?
    @State private var busy: String?

    private struct Threads: Decodable { let threads: [MailThread] }
    private struct TidyBody: Encodable {
        let email: String
        let action: String
        let account: String?
    }
    private struct Round: Decodable {
        let handled: Int
        let remaining: Int
    }
    private struct UnsubscribeBody: Encodable { let messageId: String }
    private struct Unsubscribed: Decodable {
        let done: Bool
        let url: String?
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 12) {
                        ContactAvatar(name: sender.name, email: sender.email, size: 44)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(sender.label).font(.inter(18, .semibold, relativeTo: .headline)).foregroundStyle(Theme.foreground)
                            Text("\(sender.email) · \(SendersView.count(sender))")
                                .font(.inter(13, relativeTo: .footnote))
                                .foregroundStyle(Theme.mutedForeground)
                        }
                        .lineLimit(1)
                    }
                    if let busy {
                        HStack(spacing: 10) {
                            ProgressView()
                            Text(busy).font(.inter(14, relativeTo: .subheadline)).foregroundStyle(Theme.mutedForeground)
                        }
                    } else {
                        VStack(spacing: 8) {
                            HStack(spacing: 8) {
                                OutlineButton(title: t("Archive all", "Alles archiveren"), icon: "archive") { confirming = "archive" }
                                OutlineButton(title: t("All read", "Alles gelezen"), icon: "mail-open-01") { Task { await tidy("read") } }
                            }
                            HStack(spacing: 8) {
                                OutlineButton(title: t("Unsubscribe", "Uitschrijven"), icon: "filter-mail-remove") { Task { await unsubscribe() } }
                                OutlineButton(title: t("Delete all", "Alles verwijderen"), icon: "delete-02") { confirming = "trash" }
                            }
                        }
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(t("Their conversations", "Hun gesprekken"))
                            .font(.inter(13, .medium, relativeTo: .footnote))
                            .foregroundStyle(Theme.mutedForeground)
                        if let threads {
                            if threads.isEmpty {
                                Text(t("Nothing of theirs is left in the inbox.", "Er staat niets meer van ze in de inbox."))
                                    .font(.inter(15, relativeTo: .subheadline))
                                    .foregroundStyle(Theme.mutedForeground)
                                    .padding(.top, 8)
                            }
                            ForEach(threads) { thread in
                                Button {
                                    dismiss()
                                    // Once this sheet is gone, the conversation opens on top of the list.
                                    Task {
                                        try? await Task.sleep(nanoseconds: 450_000_000)
                                        navigator.reading = thread
                                    }
                                } label: {
                                    ThreadRow(thread: thread, mailbox: nil).padding(.leading, -8)
                                }
                                .buttonStyle(.plain)
                            }
                        } else {
                            ProgressView().frame(maxWidth: .infinity).padding(.top, 20)
                        }
                    }
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle(t("Tidy up", "Opruimen"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(t("Done", "Klaar")) { dismiss() }.font(.inter(16, .medium)) }
            }
            .confirmationDialog(
                confirming == "trash"
                    ? t("Move \(sender.conversations) conversations from \(sender.label) to the trash?", "\(sender.conversations) gesprekken van \(sender.label) naar de prullenbak?")
                    : t("Archive \(sender.conversations) conversations from \(sender.label)?", "\(sender.conversations) gesprekken van \(sender.label) archiveren?"),
                isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
                titleVisibility: .visible
            ) {
                let action = confirming ?? "archive"
                Button(action == "trash" ? t("Delete all", "Alles verwijderen") : t("Archive all", "Alles archiveren"), role: action == "trash" ? .destructive : nil) {
                    Task { await tidy(action) }
                }
                Button(t("Cancel", "Annuleren"), role: .cancel) {}
            } message: {
                Text(confirming == "trash"
                    ? t("They go to the trash, at Gmail or Outlook too, where you can still get them back for a while.", "Ze gaan naar de prullenbak, ook bij Gmail of Outlook, waar je ze nog een tijdje terug kunt halen.")
                    : t("They leave your inbox and stay in your archive, at Gmail or Outlook too.", "Ze verdwijnen uit je inbox en blijven in je archief staan, ook bij Gmail of Outlook."))
            }
        }
        .overlay(alignment: .bottom) { ToastView().environment(store) }
        .task { await load() }
    }

    private var accountQuery: String { store.accountFilter.isEmpty ? "" : "&account=\(store.accountFilter.queryEncoded)" }

    private func load() async {
        if Demo.enabled {
            threads = Array(Demo.threads.prefix(3))
            return
        }
        let answer: Threads? = try? await API.get("/api/mail/senders/conversations?email=\(sender.email.queryEncoded)\(accountQuery)")
        threads = answer?.threads ?? []
    }

    /// Everything from them at once, in rounds the API can finish in time.
    private func tidy(_ action: String) async {
        let total = action == "read" ? sender.unread : sender.conversations
        func progress(_ done: Int) -> String {
            switch action {
            case "read": t("Marking read… \(done) of \(total)", "Gelezen markeren… \(done) van \(total)")
            case "trash": t("Deleting… \(done) of \(total)", "Verwijderen… \(done) van \(total)")
            default: t("Archiving… \(done) of \(total)", "Archiveren… \(done) van \(total)")
            }
        }
        var done = 0
        busy = progress(0)
        defer { busy = nil }
        do {
            while true {
                let body = TidyBody(email: sender.email, action: action, account: store.accountFilter.isEmpty ? nil : store.accountFilter)
                let round: Round = try await API.post("/api/mail/senders/action", body)
                done += round.handled
                if round.remaining == 0 { break }
                // A round that got nowhere won't do better next time.
                if round.handled == 0 { throw APIError(message: t("Stopped halfway; try again for the rest.", "Halverwege gestopt; probeer het nog eens voor de rest."), status: 0) }
                busy = progress(min(done, total))
            }
            let finished: String = switch action {
            case "read": t("Everything from \(sender.label) read", "Alles van \(sender.label) gelezen")
            case "trash": t("\(done) conversations from \(sender.label) moved to the trash", "\(done) gesprekken van \(sender.label) naar de prullenbak")
            default: t("\(done) conversations from \(sender.label) archived", "\(done) gesprekken van \(sender.label) gearchiveerd")
            }
            store.present(Toast(message: finished))
        } catch {
            store.show(error)
        }
        await load()
        await store.load(.inbox)
        await store.refreshCounts()
    }

    /// Unsubscribing goes through their newest message.
    private func unsubscribe() async {
        let none = APIError(message: t("\(sender.label) offers no unsubscribe link.", "\(sender.label) biedt geen uitschrijflink."), status: 400)
        guard let thread = sender.thread else { return store.show(none) }
        do {
            let result: Unsubscribed = try await API.post(conversationPath(thread.id, "/unsubscribe"), UnsubscribeBody(messageId: sender.providerMessageId))
            if result.done {
                store.present(Toast(message: t("Unsubscribed from \(sender.label)", "Uitgeschreven bij \(sender.label)")))
            } else if let link = result.url, let url = URL(string: link) {
                await UIApplication.shared.open(url)
            }
        } catch let failure as APIError where failure.status == 400 {
            store.show(none)
        } catch {
            store.show(error)
        }
    }
}
