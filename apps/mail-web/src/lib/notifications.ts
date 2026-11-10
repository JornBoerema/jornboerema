import { useEffect, useRef } from "react"
import type { MailThreadView } from "@evido/mail-core/types"
import { useNotifyNewMail } from "@/lib/preferences"

/** More new mail than this at once is one summary notification instead. */
const MAX_SEPARATE = 3

export const notificationsSupported = () => typeof window !== "undefined" && "Notification" in window

/**
 * A system notification for each conversation that newly turns up unread, while
 * the tab isn't being looked at. What was unread when the page opened is known.
 */
export function useNewMailNotifications(
  latest: MailThreadView[] | undefined,
  texts: { newMail: (count: number) => string; unknownSender: string; noSubject: string },
  onOpen: (thread: MailThreadView) => void
) {
  const enabled = useNotifyNewMail()
  const known = useRef<Set<string> | null>(null)
  const open = useRef(onOpen)
  open.current = onOpen

  useEffect(() => {
    if (!latest) return
    if (known.current === null) {
      known.current = new Set(latest.map((thread) => thread.id))
      return
    }
    const seen = known.current
    const fresh = latest.filter((thread) => !seen.has(thread.id))
    for (const thread of latest) seen.add(thread.id)
    const watching = document.visibilityState === "visible" && document.hasFocus()
    if (!enabled || watching || fresh.length === 0 || !notificationsSupported()) return
    if (Notification.permission !== "granted") return

    const show = (title: string, body: string, thread?: MailThreadView) => {
      const notification = new Notification(title, {
        body,
        tag: thread?.id ?? "evido-mail",
        // A bitmap, since not every system shows SVG in notifications.
        icon: "/apple-touch-icon.png",
      })
      notification.onclick = () => {
        window.focus()
        if (thread) open.current(thread)
        notification.close()
      }
    }
    if (fresh.length > MAX_SEPARATE) show(texts.newMail(fresh.length), "")
    else
      for (const thread of fresh)
        show(thread.fromName ?? thread.fromEmail ?? texts.unknownSender, thread.subject || texts.noSubject, thread)
  }, [latest, enabled, texts])
}

/** The unread count in the tab, like "(3) Even mailen". */
export function useUnreadTitle(count: number | undefined, base: string) {
  useEffect(() => {
    document.title = count ? `(${count > 99 ? "99+" : count}) ${base}` : base
  }, [count, base])
}
