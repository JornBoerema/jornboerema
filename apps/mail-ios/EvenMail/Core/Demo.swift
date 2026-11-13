import Foundation

/// Made-up mail for screenshots and for trying the screens without an account:
/// launch with `EVEN_DEMO=1`. Nothing is asked of the API in this mode.
enum Demo {
    static let enabled = ProcessInfo.processInfo.environment["EVEN_DEMO"] == "1"

    static let user = SessionUser(id: "demo", email: "sam@example.com", name: "Sam de Vries")

    static let accounts = [
        MailAccount(id: "a1", provider: "gmail", email: "sam@example.com", displayName: "Sam de Vries", status: "active", color: 0, signatures: nil),
        MailAccount(id: "a2", provider: "outlook", email: "sam@studio.example", displayName: "Studio", status: "active", color: 1, signatures: nil),
    ]

    private static func line(_ index: Int, _ account: String, _ name: String, _ email: String, _ subject: String, _ snippet: String, minutes: Double, read: Bool = true, star: Bool = false, files: Bool = false, count: Int = 1) -> MailThread {
        MailThread(
            id: "m\(index)", accountId: account, subject: subject, snippet: snippet, fromName: name, fromEmail: email,
            receivedAt: Date().addingTimeInterval(-minutes * 60), isRead: read, isStarred: star, hasAttachments: files,
            messageCount: count, to: nil
        )
    }

    static let threads: [MailThread] = [
        line(1, "a1", "Noor Jansen", "noor@example.com", "Planning voor donderdag", "Zullen we om tien uur beginnen? Dan hebben we de middag vrij voor de rest.", minutes: 12, read: false, count: 3),
        line(2, "a2", "Bakkerij Het Hoekje", "bestel@bakkerij.example", "Je bestelling staat klaar", "Je kunt je bestelling vanaf 8:00 ophalen aan de Dorpsstraat.", minutes: 48, read: false),
        line(3, "a1", "Lars Visser", "lars@example.com", "Re: Offerte website", "Dank voor de snelle reactie, ik heb de offerte doorgestuurd naar Marit.", minutes: 95, star: true, files: true, count: 2),
        line(4, "a2", "Gemeente Voorbeeldstad", "noreply@gemeente.example", "Uw afspraak is bevestigd", "U heeft een afspraak op dinsdag 18 november om 14:20 bij het stadskantoor.", minutes: 180),
        line(5, "a1", "Marit de Boer", "marit@example.com", "Foto's van het weekend", "Ze zijn eindelijk klaar! Kijk maar welke je wilt hebben, dan stuur ik ze door.", minutes: 320, files: true),
        line(6, "a1", "Energie Direct", "service@energie.example", "Je jaarafrekening", "Je jaarafrekening staat klaar. Je krijgt dit jaar € 84,12 terug.", minutes: 60 * 26),
        line(7, "a2", "Tom Bakker", "tom@studio.example", "Notulen overleg", "Hierbij de notulen van afgelopen maandag, met de actiepunten onderaan.", minutes: 60 * 31, count: 4),
        line(8, "a1", "Bibliotheek", "info@bibliotheek.example", "Je boeken moeten bijna terug", "Over drie dagen verloopt de leentermijn van twee boeken.", minutes: 60 * 54),
        line(9, "a1", "Sanne Mulder", "sanne@example.com", "Verjaardag Joris", "Kom je zaterdag ook? We beginnen rond vier uur in de tuin.", minutes: 60 * 80, star: true),
        line(10, "a2", "Fietsenmaker Rap", "werkplaats@rap.example", "Je fiets is klaar", "De nieuwe ketting zit erop. Ophalen kan tot zes uur.", minutes: 60 * 110),
    ]

    static func detail(_ id: String) -> ThreadDetail {
        let thread = threads.first { $0.id == id } ?? threads[0]
        let from = MailAddress(name: thread.fromName, email: thread.fromEmail ?? "")
        let me = MailAddress(name: user.name, email: user.email)
        let html = "<p>Hoi Sam,</p><p>\(thread.snippet)</p><p>Laat je het even weten? Dan zet ik het in de agenda.</p><p>Groet,<br>\(thread.fromName ?? "")</p>"
        let earlier = MailMessage(
            id: "\(id)-0", subject: thread.subject, from: me, replyTo: [], to: [from], cc: [],
            receivedAt: thread.receivedAt.addingTimeInterval(-3600), html: nil,
            text: "Hoi, zie jij kans om hier even naar te kijken? Groet, Sam", attachments: [], inline: []
        )
        let latest = MailMessage(
            id: id, subject: thread.subject, from: from, replyTo: [], to: [me], cc: [],
            receivedAt: thread.receivedAt, html: html, text: thread.snippet,
            attachments: thread.hasAttachments ? [MailAttachment(id: "f1", name: "Offerte.pdf", size: 248_000, contentType: "application/pdf")] : [],
            inline: []
        )
        return ThreadDetail(messages: thread.messageCount > 1 ? [earlier, latest] : [latest])
    }

    static let replies = [
        ReplySuggestion(label: "Donderdag past", text: "Hoi Lars,\n\nDonderdag past prima. Zet het maar in de agenda.\n\nGroet,\nSam"),
        ReplySuggestion(label: "Liever volgende week", text: "Hoi Lars,\n\nDeze week lukt het niet. Kan het volgende week?\n\nGroet,\nSam"),
        ReplySuggestion(label: "Ik kom erop terug", text: "Hoi Lars,\n\nDank je, ik kom er morgen op terug.\n\nGroet,\nSam"),
    ]

    static let translation = MailTranslation(same: false, from: "Dutch", text: "Hi Sam,\n\nThanks for the quick reply, I forwarded the quote to Marit.\n\nWill you let me know? Then I'll put it in the calendar.\n\nRegards,\nLars Visser")

    static let written = "Hoi Lars,\n\nDank voor het doorsturen. Donderdag past prima, zet het gerust in de agenda.\n\nGroet,\nSam"

    static let summary = MailSummary(kind: "summary", code: nil, summary: "Vraagt of het voorstel past en wil het daarna in de agenda zetten. Verwacht een kort antwoord.")
}
