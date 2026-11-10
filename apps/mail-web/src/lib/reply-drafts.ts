import type { MailInlineUpload } from "@evido/mail-core/types"

/**
 * Under the cache prefix, so signing out clears these with the rest of what the
 * browser keeps for this user.
 */
const PREFIX = "evido.mail.cache.reply."
/** A reply nobody came back to in a month isn't worth bringing back. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export type ReplyMode = "reply" | "all" | "forward"

/** A half written reply or forward, kept in this browser per conversation. */
export type ReplyDraft = {
  mode: ReplyMode
  html: string
  inline: MailInlineUpload[]
  /** Forwards choose their own recipients. */
  to?: string
  savedAt: number
}

export function readReplyDraft(conversationId: string): ReplyDraft | null {
  try {
    const raw = localStorage.getItem(PREFIX + conversationId)
    if (!raw) return null
    const draft = JSON.parse(raw) as ReplyDraft
    if (Date.now() - draft.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(PREFIX + conversationId)
      return null
    }
    return draft
  } catch {
    return null
  }
}

export function saveReplyDraft(conversationId: string, draft: Omit<ReplyDraft, "savedAt">) {
  try {
    localStorage.setItem(PREFIX + conversationId, JSON.stringify({ ...draft, savedAt: Date.now() }))
  } catch {
    // Full or blocked storage: the reply just isn't kept, as before.
  }
}

export function clearReplyDraft(conversationId: string) {
  try {
    localStorage.removeItem(PREFIX + conversationId)
  } catch {
    // Nothing kept, then.
  }
}
