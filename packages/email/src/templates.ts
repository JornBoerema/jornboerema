import type { Language } from "@even/i18n"
import type { Email } from "./index"

const brand = "Even"

export const authEmails = {
  verify: (to: string, url: string, language: Language): Email =>
    language === "nl"
      ? {
          to,
          subject: `Bevestig je e-mailadres · ${brand}`,
          text: `Welkom bij ${brand}. Bevestig je e-mailadres om je account af te maken.\n\n${url}\n\nDeze link is 1 uur geldig. Heb je geen account gemaakt? Dan kun je deze e-mail negeren.`,
          button: "E-mailadres bevestigen",
          language: "nl",
        }
      : {
          to,
          subject: `Confirm your email address · ${brand}`,
          text: `Welcome to ${brand}. Confirm your email address to finish your account.\n\n${url}\n\nThis link is valid for 1 hour. Didn't create an account? You can ignore this email.`,
          button: "Confirm email address",
          language: "en",
        },
  resetPassword: (to: string, url: string, language: Language): Email =>
    language === "nl"
      ? {
          to,
          subject: `Stel je wachtwoord opnieuw in · ${brand}`,
          text: `Je hebt een nieuw wachtwoord aangevraagd.\n\n${url}\n\nDeze link is 1 uur geldig. Niet aangevraagd? Je kunt deze e-mail negeren.`,
          button: "Nieuw wachtwoord kiezen",
          language: "nl",
        }
      : {
          to,
          subject: `Reset your password · ${brand}`,
          text: `You asked for a new password.\n\n${url}\n\nThis link is valid for 1 hour. Didn't ask for this? You can ignore this email.`,
          button: "Choose a new password",
          language: "en",
        },
}

export const todoEmails = {
  workspaceInvitation: (input: {
    to: string
    inviterName: string
    workspaceName: string
    role: "owner" | "admin" | "member"
    url: string
    language: Language
  }): Email =>
    input.language === "nl"
      ? {
          to: input.to,
          subject: `Uitnodiging voor ${input.workspaceName} · Even`,
          text: `${input.inviterName} nodigt je uit voor de organisatie “${input.workspaceName}” in Even.\n\nJe wordt ${input.role === "admin" ? "beheerder: je kunt alle lijsten en notities bewerken en leden uitnodigen" : "lid: je kunt alle lijsten en notities in deze organisatie bekijken en bewerken"}.\n\n${input.url}\n\nNog geen account? Maak er eerst een aan met dit e-mailadres en bevestig je e-mail. Daarna kom je terug bij de uitnodiging.\n\nDe uitnodiging is 7 dagen geldig. Niet verwacht? Dan kun je deze e-mail negeren.`,
          button: "Uitnodiging bekijken",
          language: "nl",
        }
      : {
          to: input.to,
          subject: `Invitation to ${input.workspaceName} · Even`,
          text: `${input.inviterName} invited you to the organization “${input.workspaceName}” in Even.\n\nYou'll be ${input.role === "admin" ? "an admin: you can edit all lists and notes and invite members" : "a member: you can view and edit all lists and notes in this organization"}.\n\n${input.url}\n\nNo account yet? Create one with this email address first and confirm your email. You'll then return to the invitation.\n\nThe invitation is valid for 7 days. Not expecting this? You can ignore this email.`,
          button: "View invitation",
          language: "en",
        },
}

/** Invite-only apps: an invitation, a granted request, and a request for the admin. */
export const accessEmails = {
  invite: (input: { to: string; appName: string; url: string; language: Language }): Email =>
    input.language === "nl"
      ? {
          to: input.to,
          subject: `Je bent uitgenodigd voor ${input.appName}`,
          text: `Je bent uitgenodigd voor ${input.appName}.\n\nLog in, of maak een account aan, met dit e-mailadres.\n\n${input.url}\n\nNiet verwacht? Dan kun je deze e-mail negeren.`,
          button: "Even openen",
          language: "nl",
        }
      : {
          to: input.to,
          subject: `You're invited to ${input.appName}`,
          text: `You're invited to ${input.appName}.\n\nSign in, or create an account, with this email address.\n\n${input.url}\n\nNot expecting this? You can ignore this email.`,
          button: "Open Even",
          language: "en",
        },
  granted: (input: { to: string; appName: string; url: string; language: Language }): Email =>
    input.language === "nl"
      ? {
          to: input.to,
          subject: `Je hebt toegang tot ${input.appName}`,
          text: `Je aanvraag is goedgekeurd: je kunt ${input.appName} nu gebruiken.\n\n${input.url}`,
          button: "Even openen",
          language: "nl",
        }
      : {
          to: input.to,
          subject: `You now have access to ${input.appName}`,
          text: `Your request was approved: you can use ${input.appName} now.\n\n${input.url}`,
          button: "Open Even",
          language: "en",
        },
  requested: (input: { to: string; appName: string; who: string; url: string }): Email => ({
    to: input.to,
    subject: `Access request for ${input.appName}`,
    text: `${input.who} asked for access to ${input.appName}.\n\n${input.url}`,
    button: "Review in the admin portal",
    language: "en",
  }),
}

/** Even mailen: what a user or the admin must know when nobody is looking at the app. */
export const mailEmails = {
  /** In both languages: it is sent from the background, where the reader's language is unknown. */
  reconnect: (input: { to: string; mailbox: string; url: string }): Email => ({
    to: input.to,
    subject: `Koppel ${input.mailbox} opnieuw · Connect ${input.mailbox} again`,
    text: [
      `Even heeft geen toegang meer tot ${input.mailbox}. Dat gebeurt na een nieuw wachtwoord, of als de toegang is ingetrokken. Nieuwe mail komt niet meer binnen in de app tot je de mailbox opnieuw koppelt:`,
      input.url,
      "",
      `Even lost access to ${input.mailbox}. That happens after a new password, or when access was withdrawn. New mail no longer arrives in the app until you connect the mailbox again:`,
      input.url,
    ].join("\n"),
    button: "Opnieuw koppelen · Connect again",
  }),
  watchesFailed: (input: { to: string; failed: number; renewed: number; reasons: string[] }): Email => ({
    to: input.to,
    subject: `Even mailen: ${input.failed} mailbox notifications not renewed`,
    text: [
      `The daily run renewed ${input.renewed} mailbox notifications and failed on ${input.failed}.`,
      "Those mailboxes still sync when opened, but stop updating live once their notification expires.",
      "",
      ...input.reasons,
    ].join("\n"),
  }),
}

