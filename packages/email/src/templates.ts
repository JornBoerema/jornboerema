import type { Language } from "@evido/i18n"
import type { Email } from "./index"

const brand = "Evido"

export const authEmails = {
  verify: (to: string, url: string, language: Language): Email =>
    language === "nl"
      ? {
          to,
          subject: `Bevestig je e-mailadres · ${brand}`,
          text: `Bevestig je e-mailadres voor ${brand}:\n${url}\n\nDeze link is 1 uur geldig.`,
        }
      : {
          to,
          subject: `Confirm your email address · ${brand}`,
          text: `Confirm your email address for ${brand}:\n${url}\n\nThis link is valid for 1 hour.`,
        },
  resetPassword: (to: string, url: string, language: Language): Email =>
    language === "nl"
      ? {
          to,
          subject: `Stel je wachtwoord opnieuw in · ${brand}`,
          text: `Je hebt een nieuw wachtwoord aangevraagd.\n\nKies hier je nieuwe wachtwoord (geldig voor 1 uur):\n${url}\n\nNiet aangevraagd? Je kunt deze e-mail negeren.`,
        }
      : {
          to,
          subject: `Reset your password · ${brand}`,
          text: `You asked for a new password.\n\nChoose your new password here (valid for 1 hour):\n${url}\n\nDidn't ask for this? You can ignore this email.`,
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
          subject: `Uitnodiging voor ${input.workspaceName} · Even doen`,
          text: `${input.inviterName} nodigt je uit voor de workspace “${input.workspaceName}” in Even doen.\n\nJe wordt ${input.role === "admin" ? "beheerder: je kunt alle lijsten bewerken en leden uitnodigen" : "lid: je kunt alle lijsten in deze workspace bekijken en bewerken"}.\n\nBekijk en accepteer de uitnodiging:\n${input.url}\n\nNog geen account? Maak er eerst een aan met dit e-mailadres en bevestig je e-mail. Daarna kom je terug bij de uitnodiging.\n\nDe uitnodiging is 7 dagen geldig. Niet verwacht? Dan kun je deze e-mail negeren.`,
        }
      : {
          to: input.to,
          subject: `Invitation to ${input.workspaceName} · Even doen`,
          text: `${input.inviterName} invited you to the workspace “${input.workspaceName}” in Even doen.\n\nYou'll be ${input.role === "admin" ? "an admin: you can edit all lists and invite members" : "a member: you can view and edit all lists in this workspace"}.\n\nView and accept the invitation:\n${input.url}\n\nNo account yet? Create one with this email address first and confirm your email. You'll then return to the invitation.\n\nThe invitation is valid for 7 days. Not expecting this? You can ignore this email.`,
        },
}
