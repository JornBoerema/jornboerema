import { useCallback, useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  isDraftWorthKeeping,
  type MailDraft,
  type MailDraftContent,
  type MailDraftView,
} from "@evido/mail-core/types"
import { api } from "@/lib/api"

export const DRAFTS_KEY = ["mail-drafts"]

/** Long enough to not save on every keystroke, short enough that little is lost. */
const SAVE_DELAY_MS = 1500

export type DraftRef = { accountId: string; id: string }

export type DraftStatus = "idle" | "saving" | "saved" | "failed"

export function useDrafts(enabled: boolean) {
  return useQuery({
    queryKey: DRAFTS_KEY,
    queryFn: () =>
      api<{ drafts: MailDraftView[]; failedAccounts: string[] }>(
        "/api/mail/drafts"
      ),
    enabled,
  })
}

const draftPath = ({ accountId, id }: DraftRef) =>
  `/api/mail/accounts/${encodeURIComponent(accountId)}/drafts/${encodeURIComponent(id)}`

/** Always read fresh: the draft may have changed in another client since. */
export function useDraft(ref: DraftRef | null) {
  return useQuery({
    queryKey: ["mail-draft", ref?.accountId, ref?.id],
    queryFn: () => api<MailDraft>(draftPath(ref as DraftRef)),
    enabled: ref !== null,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})

export const deleteDraft = (ref: DraftRef) =>
  api(draftPath(ref), { method: "DELETE" })

export function sendDraft(
  ref: DraftRef,
  content: MailDraftContent,
  attachmentsChanged: boolean
) {
  return api(
    `${draftPath(ref)}/send`,
    json({ ...content, draftId: ref.id, attachmentsChanged })
  )
}

/**
 * Everything but the files and pictures. Files are compared by identity; pictures
 * by content id, which the HTML already carries.
 */
const keyOf = (
  accountId: string,
  { attachments: _files, inline: _pictures, ...rest }: MailDraftContent
) => JSON.stringify([accountId, rest])

const pictureIds = (content: MailDraftContent) =>
  (content.inline ?? []).map((image) => image.contentId).join(",")

/**
 * Keeps the open message saved as a draft at its provider while it is written.
 * Saves run one at a time, so a slow one can't overwrite a newer one.
 */
export function useDraftAutosave({
  accountId,
  content,
  initial,
  ready,
  written,
  onSaved,
}: {
  accountId: string
  content: MailDraftContent
  /** The text holds more than a signature. */
  written: boolean
  /** The draft this message was opened from. */
  initial: DraftRef | null
  /** False until the content is complete; an opened draft isn't saved again unchanged. */
  ready: boolean
  onSaved: (ref: DraftRef | null) => void
}) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<DraftStatus>("idle")
  const latest = useRef({ accountId, content, written })
  latest.current = { accountId, content, written }
  const saved = useRef(initial)
  const savedKey = useRef<string | null>(
    initial ? null : keyOf(accountId, content)
  )
  const savedFiles = useRef(content.attachments)
  const savedPictures = useRef(pictureIds(content))
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const timer = useRef<number | undefined>(undefined)
  const paused = useRef(false)
  const reported = useRef(onSaved)
  reported.current = onSaved

  // The opened draft as the editor normalised it is the starting point, not a change.
  if (ready && savedKey.current === null)
    savedKey.current = keyOf(accountId, content)

  // Graph keeps files apart from the message, so it only re-uploads them when told.
  const filesChanged = () =>
    latest.current.content.attachments !== savedFiles.current ||
    pictureIds(latest.current.content) !== savedPictures.current

  const isDirty = () =>
    savedKey.current !== null &&
    (keyOf(latest.current.accountId, latest.current.content) !==
      savedKey.current ||
      filesChanged())

  const run = useCallback(async () => {
    if (paused.current || !isDirty()) return
    const { accountId: account, content: current, written: hasText } = latest.current
    const key = keyOf(account, current)
    const files = current.attachments
    const previous = saved.current
    setStatus("saving")
    try {
      // A signature alone doesn't make a message worth keeping.
      if (!isDraftWorthKeeping({ subject: current.subject, text: hasText ? current.text : "" })) {
        if (previous) await deleteDraft(previous)
        saved.current = null
        setStatus("idle")
      } else {
        // A draft lives in one mailbox, so switching the sender moves it.
        const target = previous?.accountId === account ? previous : null
        const { draftId } = await api<{ draftId: string }>(
          `/api/mail/accounts/${encodeURIComponent(account)}/drafts`,
          json({
            ...current,
            draftId: target?.id ?? null,
            attachmentsChanged: !target || filesChanged(),
          })
        )
        saved.current = { accountId: account, id: draftId }
        if (previous && !target)
          await deleteDraft(previous).catch(() => undefined)
        setStatus("saved")
      }
      savedKey.current = key
      savedFiles.current = files
      savedPictures.current = pictureIds(current)
      reported.current(saved.current)
      void queryClient.invalidateQueries({ queryKey: DRAFTS_KEY })
    } catch {
      // Tried again on the next change, or when the message is sent or closed.
      setStatus("failed")
    }
  }, [queryClient])

  const enqueue = useCallback(() => {
    window.clearTimeout(timer.current)
    const next = queue.current.then(run)
    queue.current = next
    return next
  }, [run])

  const key = keyOf(accountId, content)
  useEffect(() => {
    if (!ready || paused.current) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void enqueue(), SAVE_DELAY_MS)
  }, [key, content.attachments, ready, enqueue])

  // Closing the composer or opening another draft keeps what was written.
  useEffect(() => () => void enqueue(), [enqueue])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (paused.current || !isDirty()) return
      void enqueue()
      event.preventDefault()
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [enqueue])

  return {
    status,
    /** Stops saving and waits for a running save, before sending or discarding. */
    pause: async () => {
      paused.current = true
      window.clearTimeout(timer.current)
      await queue.current
      return {
        ref: saved.current,
        attachmentsChanged: filesChanged(),
      }
    },
    resume: () => {
      paused.current = false
      void enqueue()
    },
  }
}
