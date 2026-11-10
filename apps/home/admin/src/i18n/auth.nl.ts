import type { auth as en } from "./auth.en"

export const auth: typeof en = {
  layout: {
    homeLabel: "Admin, naar inloggen",
    tagline: "jornboerema.nl",
  },
  pageTitles: {
    login: "Inloggen",
    register: "Registreren",
    forgot: "Wachtwoord vergeten",
    reset: "Wachtwoord herstellen",
  },
  login: {
    title: "Beheer",
    description: "Log in om de Even-apps te beheren.",
    action: "Inloggen",
  },
  register: {
    title: "Al je mail bij elkaar",
    description: "Maak een account aan om je mailboxen te koppelen.",
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
}
