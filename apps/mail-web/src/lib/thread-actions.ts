import { ArchiveIcon, Delete02Icon, Delete04Icon, InboxIcon, SpamIcon } from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import type { MailFolder, MailThreadAction } from "@evido/mail-core/types"
import type { en } from "@/i18n/en"

type ConversationTexts = (typeof en)["conversation"]

export const MOVE_ICONS: Partial<Record<MailThreadAction, IconSvgElement>> = {
  archive: ArchiveIcon,
  trash: Delete02Icon,
  inbox: InboxIcon,
  spam: SpamIcon,
  delete: Delete04Icon,
}

export const MOVE_KEYS: Partial<Record<MailThreadAction, string>> = {
  archive: "E",
  trash: "#",
  inbox: "I",
  spam: "!",
}

/** Red on hover, as every action that throws mail away. */
export const DANGER = "hover:bg-transparent! hover:text-destructive! dark:hover:bg-transparent!"
export const isDestructive = (action: MailThreadAction) => action === "trash" || action === "delete"

/** "Move to inbox" from spam is "Not spam". */
export function moveLabel(action: MailThreadAction, folder: MailFolder | null, t: ConversationTexts) {
  if (action === "inbox") return folder === "spam" ? t.notSpam : t.moveToInbox
  if (action === "delete") return t.deleteForever
  if (action === "spam") return t.reportSpam
  return action === "archive" ? t.archive : t.trash
}
