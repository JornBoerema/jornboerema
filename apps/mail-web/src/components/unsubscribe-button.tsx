import { useState } from "react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@evido/ui/components/alert-dialog"
import type { MailAccountView } from "@evido/mail-core/types"
import type { MailUnsubscribe } from "@evido/mail-core/unsubscribe"
import { useI18n } from "@/i18n"
import { api } from "@/lib/api"
import { useUnsubscribe } from "@/lib/preferences"

/** Lists left during this visit, so their button says so on every message. */
const left = new Set<string>()

const siteOf = (url: string) => new URL(url).hostname.replace(/^www\./, "")

/**
 * Leaves the list as its headers ask: one POST when it supports one-click
 * (sent from the browser, as a click on the link would be, so our server never
 * fetches an address out of someone's mail), else a message to its unsubscribe
 * mailbox from the account it came to, else its page opened for the reader.
 */
async function leave(unsubscribe: MailUnsubscribe, account: MailAccountView | undefined) {
  if (unsubscribe.oneClick && unsubscribe.url) {
    await fetch(unsubscribe.url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    })
    return "left" as const
  }
  if (unsubscribe.mailto && account) {
    await api(`/api/mail/accounts/${encodeURIComponent(account.id)}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: [{ name: null, email: unsubscribe.mailto.address }],
        cc: [],
        bcc: [],
        subject: unsubscribe.mailto.subject,
        text: unsubscribe.mailto.body,
        attachments: [],
      }),
    })
    return "left" as const
  }
  if (unsubscribe.url) {
    window.open(unsubscribe.url, "_blank", "noopener,noreferrer")
    return "opened" as const
  }
  throw new Error("Nothing to unsubscribe with")
}

/** "Unsubscribe" beside mail from a mailing list, asking first what will happen. */
export function UnsubscribeButton({
  unsubscribe,
  sender,
  account,
}: {
  unsubscribe: MailUnsubscribe
  sender: string
  account: MailAccountView | undefined
}) {
  const t = useI18n().t.unsubscribe
  const enabled = useUnsubscribe()
  const key = unsubscribe.url ?? unsubscribe.mailto?.address ?? ""
  const [done, setDone] = useState(() => left.has(key))
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  // A mailbox only works from a connected account; without one, only a link can.
  const usable = (unsubscribe.oneClick && unsubscribe.url) || (unsubscribe.mailto && account) || unsubscribe.url
  if (!enabled || !usable) return null

  const description =
    unsubscribe.oneClick && unsubscribe.url
      ? t.oneClick(siteOf(unsubscribe.url))
      : unsubscribe.mailto && account
        ? t.byMail(unsubscribe.mailto.address, account.email)
        : t.link(siteOf(unsubscribe.url!))

  return (
    <>
      <button
        type="button"
        disabled={done}
        onClick={() => setAsking(true)}
        className="shrink-0 rounded-sm text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:no-underline disabled:opacity-70"
      >
        {done ? t.done : t.button}
      </button>
      <AlertDialog open={asking} onOpenChange={(open) => !busy && setAsking(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.title(sender)}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (event) => {
                event.preventDefault()
                setBusy(true)
                try {
                  const result = await leave(unsubscribe, account)
                  // An opened page still needs the reader; only a request sent is done.
                  if (result === "left") {
                    left.add(key)
                    setDone(true)
                  }
                  toast.success(result === "left" ? t.succeeded(sender) : t.opened)
                  setAsking(false)
                } catch {
                  toast.error(t.failed)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {t.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
