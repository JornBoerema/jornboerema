import type { Context } from "hono"
import { pickLanguage, type Language } from "@evido/i18n"

/** User-facing API messages. Dutch is typed against English. */
const en = {
  // Session & request
  signInAgain: "Please sign in again.",
  invalidRequest: "Invalid request.",
  requestTooLarge: "Request too large.",
  checkInput: "Check your input.",
  confirmEmailFirst: "Confirm your email address first.",
  realtimeUnavailable: "Realtime is not available.",
  // Lists & tasks
  saveFailed: "Saving failed. Please try again.",
  listOrTaskGone: "This list or task no longer exists.",
  noWorkspaceAccess: "You don't have access to this workspace.",
  linkUnavailable: "This link is no longer available or doesn't allow editing.",
  useNoteEditor: "Use the note editor to change this note.",
  notANote: "This is not a note.",
  noteConflict: "This note was changed elsewhere in the meantime. Your text was not overwritten.",
  // Workspaces
  genericFailure: "That didn't work. Please try again in a minute.",
  onlyManagers: "Only the owner and admins can change this.",
  onlyOwnerDeletes: "Only the owner can delete this workspace.",
  ownerCannotLeave: "As the owner you can't leave this workspace. Delete it or transfer it first.",
  ownerUntouchable: "The owner can't be changed or removed.",
  useLeave: "Use ‘Leave workspace’ to remove yourself.",
  alreadyMember: "This email address is already a member of this workspace.",
  inviteTooSoon: "Wait a minute before inviting again.",
  inviteLimit: "You can send up to 20 invitations per hour. Please try again later.",
  inviteMailFailed:
    "The invitation was saved, but the email couldn't be sent. Please try again in a minute.",
  wrongInviteAccount: "Sign in with the confirmed email address this invitation was sent to.",
  // Invitations
  invitationUnavailable: "Invitation not available.",
  invitationGone: "This invitation has expired, been revoked or already been used.",
  acceptFailed: "Accepting the invitation failed.",
  // Defaults
  personalWorkspace: "Personal",
  // Validation codes from @evido/todo-core
  list_name_required: "Give your list a name.",
  task_title_required: "Enter a task.",
  note_too_long: "A note can contain at most 100,000 characters.",
  content_notes_only: "Content is only available for notes.",
  workspace_name_required: "Give your workspace a name.",
  invalid_email: "Enter a valid email address.",
  // Mail
  mailNotConfigured: "This mail provider isn't available yet.",
  mailAccountGone: "This mailbox is no longer connected.",
  mailSignatureGone: "This signature no longer exists.",
  mailTooManySignatures: "You've reached the maximum number of signatures.",
  mailMessageGone: "This message no longer exists.",
  mailReconnect: "Access to this mailbox has ended. Connect it again.",
  mailProviderFailed: "The mail provider didn't respond. Please try again in a minute.",
}

export type MessageKey = keyof typeof en

const nl: Record<MessageKey, string> = {
  signInAgain: "Log opnieuw in.",
  invalidRequest: "Ongeldig verzoek.",
  requestTooLarge: "Verzoek te groot.",
  checkInput: "Controleer je invoer.",
  confirmEmailFirst: "Bevestig eerst je e-mailadres.",
  realtimeUnavailable: "Realtime niet beschikbaar.",
  saveFailed: "Opslaan is niet gelukt. Probeer het opnieuw.",
  listOrTaskGone: "Deze lijst of taak bestaat niet meer.",
  noWorkspaceAccess: "Geen toegang tot deze workspace.",
  linkUnavailable: "Deze link is niet meer beschikbaar of geeft geen bewerkrechten.",
  useNoteEditor: "Gebruik de notitie-editor om deze notitie te wijzigen.",
  notANote: "Dit is geen notitie.",
  noteConflict: "Deze notitie is ondertussen elders gewijzigd. Je tekst is niet overschreven.",
  genericFailure: "Dit is niet gelukt. Probeer het over een minuut opnieuw.",
  onlyManagers: "Alleen de eigenaar en beheerders kunnen dit wijzigen.",
  onlyOwnerDeletes: "Alleen de eigenaar kan deze workspace verwijderen.",
  ownerCannotLeave:
    "Als eigenaar kun je de workspace niet verlaten. Verwijder hem of draag hem eerst over.",
  ownerUntouchable: "De eigenaar kan niet worden aangepast of verwijderd.",
  useLeave: "Gebruik ‘Workspace verlaten’ om jezelf te verwijderen.",
  alreadyMember: "Dit e-mailadres is al lid van deze workspace.",
  inviteTooSoon: "Wacht een minuut voordat je opnieuw uitnodigt.",
  inviteLimit: "Je kunt maximaal 20 uitnodigingen per uur versturen. Probeer later opnieuw.",
  inviteMailFailed:
    "De uitnodiging is opgeslagen, maar de e-mail kon niet worden verstuurd. Probeer het over een minuut opnieuw.",
  wrongInviteAccount: "Log in met het bevestigde e-mailadres waarvoor deze uitnodiging bedoeld is.",
  invitationUnavailable: "Uitnodiging niet beschikbaar.",
  invitationGone: "Deze uitnodiging is verlopen, ingetrokken of al gebruikt.",
  acceptFailed: "Accepteren is niet gelukt.",
  personalWorkspace: "Persoonlijk",
  list_name_required: "Geef je lijst een naam.",
  task_title_required: "Vul een taak in.",
  note_too_long: "Een notitie mag maximaal 100.000 tekens bevatten.",
  content_notes_only: "Inhoud is alleen beschikbaar voor notities.",
  workspace_name_required: "Geef je workspace een naam.",
  invalid_email: "Vul een geldig e-mailadres in.",
  mailNotConfigured: "Deze mailprovider is nog niet beschikbaar.",
  mailAccountGone: "Deze mailbox is niet meer gekoppeld.",
  mailSignatureGone: "Deze handtekening bestaat niet meer.",
  mailTooManySignatures: "Je hebt het maximum aantal handtekeningen bereikt.",
  mailMessageGone: "Dit bericht bestaat niet meer.",
  mailReconnect: "De toegang tot deze mailbox is verlopen. Koppel hem opnieuw.",
  mailProviderFailed: "De mailprovider reageert niet. Probeer het over een minuut opnieuw.",
}

const messages: Record<Language, Record<MessageKey, string>> = { en, nl }

/** Language of the request (Accept-Language sent by the web apps); English by default. */
export const languageOf = (c: Context): Language => pickLanguage(c.req.header("accept-language"))

/** Translated message for this request. */
export const msg = (c: Context, key: MessageKey) => messages[languageOf(c)][key]

export const isMessageKey = (value: unknown): value is MessageKey =>
  typeof value === "string" && Object.hasOwn(en, value)

/** Translates a validation code from @evido/todo-core, or falls back to "check your input". */
export const validationMessage = (c: Context, code: string | undefined) =>
  msg(c, isMessageKey(code) ? code : "checkInput")

/** An error whose message is a translatable key, thrown by the data layer. */
export class KeyedError extends Error {
  constructor(public key: MessageKey) {
    super(key)
  }
}

export const translate = (language: Language, key: MessageKey) => messages[language][key]
