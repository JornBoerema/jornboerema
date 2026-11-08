import type { en } from "./en"

export const nl: typeof en = {
  login: {
    title: "Inloggen",
    hint: "Gebruik je Evido-account.",
    email: "E-mail",
    password: "Wachtwoord",
    submit: "Inloggen",
    failed: "Inloggen is niet gelukt.",
  },
  accounts: {
    title: "Mailboxen",
    signOut: "Uitloggen",
    addGmail: "Gmail koppelen",
    addOutlook: "Outlook koppelen",
    empty: "Nog geen mailboxen gekoppeld.",
    loadFailed: "Je mailboxen konden niet worden geladen.",
    connected: "Mailbox gekoppeld.",
    disconnect: "Ontkoppelen",
    reconnect: "Opnieuw koppelen",
    reconnectNeeded: "Toegang verlopen",
    confirmDisconnect: (email: string) => `${email} ontkoppelen?`,
    inbox: (total: number, unread: number) => `Inbox: ${total} berichten, ${unread} ongelezen`,
    inboxLoading: "Inbox controleren…",
    inboxFailed: "Inbox niet beschikbaar",
  },
  connectErrors: {
    denied: "Koppelen is geannuleerd, of je organisatie staat deze app niet toe.",
    expired: "Dat duurde te lang. Probeer het opnieuw.",
    session: "Log eerst in en koppel daarna je mailbox.",
    missing_scope: "Geef op het Google-scherm toegang tot je mail om deze mailbox te koppelen.",
    failed: "Koppelen is niet gelukt. Probeer het opnieuw.",
  },
}
