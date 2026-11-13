import { env } from "../env"

/**
 * Even mailen is invite-only as a whole until MAIL_OPEN is set. From then on
 * anyone may use it with Outlook, and only Gmail still takes an invitation:
 * Google caps an unverified app at a hundred users.
 */
export const mailOpen = () => ["1", "true"].includes(process.env.MAIL_OPEN ?? "")

/** The apps the admin portal manages. Invite-only ones need an AppAccess row to use. */
export const APPS = [
  { id: "mail", name: "Even mailen", url: () => env.mailWebUrl, inviteOnly: () => !mailOpen() },
  { id: "gmail", name: "Gmail in Even mailen", url: () => env.mailWebUrl, inviteOnly: () => true },
] as const

export type AppId = (typeof APPS)[number]["id"]

export const findApp = (id: string) => APPS.find((app) => app.id === id)
