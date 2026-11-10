import { env } from "../env"

/** The apps the admin portal manages. Invite-only ones need an AppAccess row to use. */
export const APPS = [
  { id: "mail", name: "Even mailen", url: () => env.mailWebUrl, inviteOnly: true },
] as const

export type AppId = (typeof APPS)[number]["id"]

export const findApp = (id: string) => APPS.find((app) => app.id === id)
