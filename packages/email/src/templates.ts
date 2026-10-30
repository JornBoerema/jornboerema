import type { Email } from "./index"

const brand = "Evido"

export const authEmails = {
  verify: (to: string, url: string): Email => ({
    to,
    subject: `Bevestig je e-mailadres · ${brand}`,
    text: `Bevestig je e-mailadres voor ${brand}:\n${url}\n\nDeze link is 1 uur geldig.`,
  }),
  resetPassword: (to: string, url: string): Email => ({
    to,
    subject: `Stel je wachtwoord opnieuw in · ${brand}`,
    text: `Je hebt een nieuw wachtwoord aangevraagd.\n\nKies hier je nieuwe wachtwoord (geldig voor 1 uur):\n${url}\n\nNiet aangevraagd? Je kunt deze e-mail negeren.`,
  }),
}

export const todoEmails = {
  workspaceInvitation: (input: {
    to: string
    inviterName: string
    workspaceName: string
    role: "owner" | "admin" | "member"
    url: string
  }): Email => ({
    to: input.to,
    subject: `Uitnodiging voor ${input.workspaceName} · Even doen`,
    text: `${input.inviterName} nodigt je uit voor de workspace “${input.workspaceName}” in Even doen.\n\nJe wordt ${input.role === "admin" ? "beheerder: je kunt alle lijsten bewerken en leden uitnodigen" : "lid: je kunt alle lijsten in deze workspace bekijken en bewerken"}.\n\nBekijk en accepteer de uitnodiging:\n${input.url}\n\nNog geen account? Maak er eerst een aan met dit e-mailadres en bevestig je e-mail. Daarna kom je terug bij de uitnodiging.\n\nDe uitnodiging is 7 dagen geldig. Niet verwacht? Dan kun je deze e-mail negeren.`,
  }),
}
