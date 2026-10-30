import type { auth as en } from "../en/auth"

// Dutch texts for the "auth" namespace; typed against the English keys.
export const auth: typeof en = {
  layout: {
    homeLabel: "Even doen, naar inloggen",
    tagline: "Je eigen lijsten. Een taak tegelijk.",
  },
  pageTitles: {
    login: "Inloggen",
    register: "Registreren",
    forgot: "Wachtwoord vergeten",
    reset: "Wachtwoord herstellen",
  },
  login: {
    title: "Welkom terug",
    description: "Log in en ga verder met je lijsten.",
    action: "Inloggen",
  },
  register: {
    title: "Maak ruimte in je hoofd",
    description: "Maak een account aan voor je eigen takenlijsten.",
    action: "Account aanmaken",
  },
  forgot: {
    title: "Wachtwoord vergeten?",
    description: "We sturen je een link om een nieuw wachtwoord te kiezen.",
    action: "Verstuur herstellink",
  },
  reset: {
    title: "Een nieuw wachtwoord",
    description: "Kies een nieuw wachtwoord voor je account.",
    action: "Wachtwoord opslaan",
  },
  errors: {
    invalidCredentials: "Je e-mailadres of wachtwoord klopt niet.",
    emailNotVerified: "Bevestig eerst je e-mailadres. We hebben je een nieuwe bevestigingslink gestuurd.",
    tooManyRequests: "Te veel pogingen. Wacht even en probeer het opnieuw.",
    invalidToken: "Deze link is ongeldig of verlopen. Vraag een nieuwe link aan.",
    passwordTooShort: "Gebruik minstens 8 tekens voor je wachtwoord.",
    generic: "Dit is niet gelukt. Controleer je gegevens en probeer het opnieuw.",
    passwordMismatch: "De wachtwoorden komen niet overeen.",
  },
  sent: {
    title: "Bekijk je inbox",
    register: "Als dit adres nog niet geregistreerd is, ontvang je een link om je account te bevestigen. Daarna kun je meteen beginnen.",
    forgot: "Als er een account met dit e-mailadres bestaat, ontvang je een herstellink. De link is één uur geldig.",
    spam: "Niets ontvangen? Kijk ook in je spamfolder.",
  },
  passwordChanged: {
    title: "Wachtwoord gewijzigd",
    description: "Je kunt inloggen met je nieuwe wachtwoord.",
  },
  verificationExpired: {
    title: "Bevestigingslink verlopen",
    description: "Log hieronder in om een nieuwe bevestigingslink te ontvangen.",
  },
  invalidReset: {
    title: "Deze link is ongeldig of verlopen",
    action: "Vraag een nieuwe herstellink aan.",
  },
  fields: {
    name: "Naam",
    namePlaceholder: "Je naam",
    email: "E-mailadres",
    emailPlaceholder: "jij@voorbeeld.nl",
    password: "Wachtwoord",
    forgot: "Vergeten?",
    passwordHint: "Minstens 8 tekens.",
    remember: "Ingelogd blijven",
    confirm: "Herhaal wachtwoord",
  },
  switch: {
    noAccount: "Nog geen account?",
    createAccount: "Maak een account aan",
    haveAccount: "Al een account?",
    signIn: "Inloggen",
    backToSignIn: "Terug naar inloggen",
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
  consent: {
    pageTitle: "Account koppelen",
    startFromClient: "Start de koppeling vanuit ChatGPT en log in met je Even doen-account.",
    fallbackClient: "De aanvragende app",
    title: "Even doen koppelen",
    description: (client) => `Je geeft ${client} toegang tot jouw account.`,
    failed: "Koppelen is niet gelukt. Start de koppeling opnieuw vanuit ChatGPT.",
    allow: "Toestaan",
    scopes: {
      "todos:read": "Je lijsten en taken bekijken",
      "todos:write": "Lijsten en taken toevoegen, wijzigen en verwijderen",
      openid: "Je account herkennen",
      profile: "Je naam bekijken",
      email: "Je e-mailadres bekijken",
      offline_access: "Verbonden blijven totdat je de toegang intrekt",
    },
  },
}
