import type { auth as en } from "../en/auth"

// Dutch texts for the "auth" namespace; typed against the English keys.
export const auth: typeof en = {
  layout: {
    homeLabel: "Even doen, naar je lijsten",
    tagline: "Je eigen lijsten. Een taak tegelijk.",
  },
  invitation: {
    pageTitle: "Uitnodiging voor een workspace",
    unavailableTitle: "Uitnodiging niet beschikbaar",
    unavailableDescription: "Deze link is verlopen of ingetrokken. Vraag de eigenaar om een nieuwe uitnodiging.",
    joinTitle: (workspace) => `Doe mee met ${workspace}`,
    invitedTitle: "Je bent uitgenodigd",
    joinDescription: (role) =>
      `Je wordt ${role === "admin" ? "beheerder" : "lid"} van deze workspace en ziet al zijn lijsten.`,
    invitedDescription: (workspace) =>
      `Je bent uitgenodigd voor de workspace ${workspace}. Maak een account aan of log in om de uitnodiging te accepteren.`,
    useInvitedEmail: "Gebruik het e-mailadres waarop je de uitnodiging hebt ontvangen.",
    createAccount: "Account aanmaken",
    haveAccount: "Ik heb al een account",
    switchAccount: "Ander account gebruiken",
    accept: "Uitnodiging accepteren",
  },
}
