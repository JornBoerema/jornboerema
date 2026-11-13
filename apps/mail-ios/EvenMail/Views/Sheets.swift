import SwiftUI

/// When a conversation should come back (`components/when-picker.tsx`): the
/// usual moments, or one picked by hand.
struct SnoozeSheet: View {
    let thread: MailThread

    @Environment(MailStore.self) private var store
    @Environment(Navigator.self) private var navigator
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        WhenSheet(title: t("Snooze", "Uitstellen"), confirm: { t("Snooze until \($0)", "Uitstellen tot \($0)") }) { date in
            navigator.act(.archive, on: thread, store: store, compact: sizeClass == .compact, until: date)
        }
    }
}

/// Picks a moment: for snoozing a conversation, or for sending a message later.
struct WhenSheet: View {
    let title: String
    /// The words on the button for a moment picked by hand, given that moment.
    let confirm: (String) -> String
    let pick: (Date) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var picking = false
    @State private var custom = Date().addingTimeInterval(24 * 3600)

    private struct Option: Identifiable {
        let id: String
        let icon: String
        let title: String
        let date: Date
    }

    private var options: [Option] {
        let calendar = Calendar.current
        let now = Date()
        func morning(_ day: Date) -> Date { calendar.date(bySettingHour: 8, minute: 0, second: 0, of: day) ?? day }
        func next(weekday: Int) -> Date {
            morning(calendar.nextDate(after: now, matching: DateComponents(weekday: weekday), matchingPolicy: .nextTime) ?? now)
        }
        var list: [Option] = []
        let hour = calendar.component(.hour, from: now)
        if hour < 15 {
            let later = calendar.date(byAdding: .hour, value: 3, to: now) ?? now
            let rounded = calendar.date(bySetting: .minute, value: 0, of: later) ?? later
            list.append(Option(id: "later", icon: "coffee-02", title: t("Later today", "Later vandaag"), date: rounded > now ? rounded : later))
        } else if hour < 20 {
            let evening = calendar.date(bySettingHour: 20, minute: 0, second: 0, of: now) ?? now
            list.append(Option(id: "evening", icon: "moon-02", title: t("This evening", "Vanavond"), date: evening))
        }
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: now) ?? now
        list.append(Option(id: "tomorrow", icon: "sunrise", title: t("Tomorrow", "Morgen"), date: morning(tomorrow)))
        list.append(Option(id: "weekend", icon: "sun-03", title: t("This weekend", "Dit weekend"), date: next(weekday: 7)))
        list.append(Option(id: "week", icon: "calendar-03", title: t("Next week", "Volgende week"), date: next(weekday: 2)))
        // On a Friday the weekend is tomorrow, on a Sunday next week is: each moment once.
        var seen: Set<Date> = []
        return list.filter { seen.insert($0.date).inserted }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 2) {
                    ForEach(options) { option in
                        Button { snooze(option.date) } label: {
                            HStack(spacing: 12) {
                                Icon(option.icon, size: 20).foregroundStyle(Theme.mutedForeground)
                                Text(option.title).font(.inter(16)).foregroundStyle(Theme.foreground)
                                Spacer()
                                Text(formatMoment(option.date))
                                    .font(.inter(14, relativeTo: .subheadline))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.mutedForeground)
                            }
                            .padding(.horizontal, 12)
                            .frame(minHeight: 50)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                    Button { withAnimation(.snappy(duration: 0.2)) { picking.toggle() } } label: {
                        HStack(spacing: 12) {
                            Icon("calendar-add-01", size: 20).foregroundStyle(Theme.mutedForeground)
                            Text(t("Pick a moment", "Kies een moment")).font(.inter(16)).foregroundStyle(Theme.foreground)
                            Spacer()
                        }
                        .padding(.horizontal, 12)
                        .frame(minHeight: 50)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if picking {
                        DatePicker("", selection: $custom, in: Date().addingTimeInterval(60)..., displayedComponents: [.date, .hourAndMinute])
                            .datePickerStyle(.graphical)
                            .labelsHidden()
                            .tint(Theme.accentText)
                            .padding(.horizontal, 8)
                        PrimaryButton(title: confirm(formatMoment(custom))) { snooze(custom) }
                            .padding(.horizontal, 12)
                            .padding(.top, 4)
                    }
                }
                .padding(8)
            }
            .background(Theme.background)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("Cancel", "Annuleren")) { dismiss() }.foregroundStyle(Theme.foreground)
                }
            }
        }
    }

    private func snooze(_ date: Date) {
        dismiss()
        pick(date)
    }
}

/// Account, mailboxes, appearance and language (the desktop app's settings
/// window, for what a phone needs).
struct SettingsView: View {
    @Environment(MailStore.self) private var store
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var confirmSignOut = false

    var body: some View {
        @Bindable var prefs = Prefs.shared
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    section(t("Account", "Account")) {
                        HStack(spacing: 12) {
                            ContactAvatar(name: store.user.name, email: store.user.email, size: 40)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(store.user.name ?? store.user.email).font(.inter(16, .medium)).foregroundStyle(Theme.foreground)
                                Text(store.user.email).font(.inter(13, relativeTo: .footnote)).foregroundStyle(Theme.mutedForeground)
                            }
                            .lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .padding(14)
                    }

                    section(t("Mailboxes", "Mailboxen"), footer: t("Mailboxes are connected and removed on mail.jornboerema.nl.", "Mailboxen koppel en verwijder je op mail.jornboerema.nl.")) {
                        if store.accounts.isEmpty {
                            Text(t("No mailboxes yet", "Nog geen mailboxen"))
                                .font(.inter(15, relativeTo: .subheadline))
                                .foregroundStyle(Theme.mutedForeground)
                                .padding(14)
                        }
                        ForEach(store.accounts) { account in
                            if account.id != store.accounts.first?.id { Divider().overlay(Theme.border) }
                            HStack(spacing: 12) {
                                AccountDot(color: account.color, size: 10)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(account.email).font(.inter(15, relativeTo: .subheadline)).foregroundStyle(Theme.foreground).lineLimit(1)
                                    Text(account.isActive ? (account.provider == "gmail" ? "Gmail" : "Outlook") : t("Needs reconnecting on the web", "Opnieuw koppelen op het web"))
                                        .font(.inter(12.5, relativeTo: .caption))
                                        .foregroundStyle(account.isActive ? Theme.mutedForeground : Theme.destructive)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(14)
                        }
                    }

                    section(
                        t("Notifications", "Meldingen"),
                        footer: !Push.shared.allowed && prefs.notifications
                            ? t("Notifications are off for Even mailen in the phone's settings.", "Meldingen staan uit voor Even mailen in de instellingen van je telefoon.")
                            : !Push.shared.serverReady ? t("Notifications aren't set up on the server yet.", "Meldingen zijn op de server nog niet ingesteld.") : nil
                    ) {
                        Toggle(isOn: $prefs.notifications) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(t("New mail", "Nieuwe mail")).font(.inter(16)).foregroundStyle(Theme.foreground)
                                Text(t("A notification when mail arrives in your inbox.", "Een melding zodra er mail in je inbox komt."))
                                    .font(.inter(13, relativeTo: .footnote))
                                    .foregroundStyle(Theme.mutedForeground)
                            }
                        }
                        .tint(Theme.primary)
                        .padding(14)
                        .onChange(of: prefs.notifications) { _, on in
                            Task {
                                if on { await Push.shared.start() } else { await Push.shared.stop() }
                                await Push.shared.refresh()
                            }
                        }
                        if !Push.shared.allowed, prefs.notifications {
                            Divider().overlay(Theme.border)
                            Button {
                                if let url = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) }
                            } label: {
                                HStack {
                                    Text(t("Open the phone's settings", "Open de instellingen van je telefoon"))
                                        .font(.inter(15, .medium, relativeTo: .subheadline))
                                        .foregroundStyle(Theme.accentText)
                                    Spacer()
                                    Icon("arrow-up-right-01", size: 16).foregroundStyle(Theme.accentText)
                                }
                                .padding(14)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .task { await Push.shared.refresh() }

                    section(t("Appearance", "Weergave")) {
                        VStack(alignment: .leading, spacing: 14) {
                            setting(t("Theme", "Thema")) {
                                Segmented(selection: $prefs.appearance, options: [
                                    (.system, t("System", "Systeem")), (.light, t("Light", "Licht")), (.dark, t("Dark", "Donker")),
                                ])
                            }
                            setting(t("Language", "Taal")) {
                                Segmented(selection: $prefs.language, options: [
                                    (.system, t("System", "Systeem")), (.en, "English"), (.nl, "Nederlands"),
                                ])
                            }
                        }
                        .padding(14)
                    }

                    VStack(spacing: 12) {
                        OutlineButton(title: t("Sign out", "Uitloggen"), icon: "logout-01") { confirmSignOut = true }
                        Text("Even mailen \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")")
                            .font(.inter(12, relativeTo: .caption))
                            .foregroundStyle(Theme.mutedForeground)
                    }
                }
                .padding(16)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
            .background(Theme.background)
            .navigationTitle(t("Settings", "Instellingen"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("Done", "Klaar")) { dismiss() }.font(.inter(16, .medium))
                }
            }
            .confirmationDialog(t("Sign out of Even mailen?", "Uitloggen bij Even mailen?"), isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button(t("Sign out", "Uitloggen"), role: .destructive) {
                    Task {
                        await store.flush()
                        await session.signOut()
                    }
                }
                Button(t("Cancel", "Annuleren"), role: .cancel) {}
            }
        }
        .preferredColorScheme(prefs.appearance.colorScheme)
    }

    private func section<Content: View>(_ title: String, footer: String? = nil, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.inter(13, .medium, relativeTo: .footnote))
                .foregroundStyle(Theme.mutedForeground)
                .padding(.horizontal, 4)
            VStack(alignment: .leading, spacing: 0) { content() }
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(RoundedRectangle(cornerRadius: Theme.radius * 1.4, style: .continuous).strokeBorder(Theme.border))
            if let footer {
                Text(footer)
                    .font(.inter(12.5, relativeTo: .caption))
                    .foregroundStyle(Theme.mutedForeground)
                    .padding(.horizontal, 4)
            }
        }
    }

    private func setting<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.inter(15, relativeTo: .subheadline)).foregroundStyle(Theme.foreground)
            content()
        }
    }
}

/// A small segmented control, as the web draws its filters (`.invoice-filter`).
struct Segmented<Value: Hashable>: View {
    @Binding var selection: Value
    let options: [(Value, String)]

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.0) { value, label in
                let selected = selection == value
                Button {
                    withAnimation(.snappy(duration: 0.18)) { selection = value }
                } label: {
                    Text(label)
                        .font(.inter(14, .medium, relativeTo: .subheadline))
                        .foregroundStyle(selected ? Theme.foreground : Theme.mutedForeground)
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .background {
                            if selected {
                                RoundedRectangle(cornerRadius: 7, style: .continuous)
                                    .fill(Theme.background)
                                    .shadow(color: .black.opacity(0.12), radius: 1, y: 1)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(2)
        .background(Theme.muted, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
    }
}
