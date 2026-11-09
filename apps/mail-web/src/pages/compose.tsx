import { useEffect, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { cn } from "@evido/ui/lib/utils"
import type {
  MailAccountView,
  MailAddress,
  MailAttachmentUpload,
  MailOutgoing,
} from "@evido/mail-core/types"
import { AccountDot } from "@/components/account-dot"
import { AttachmentPicker } from "@/components/attachment-picker"
import { MessageInput, MessageRow, MessageText } from "@/components/message-field"
import { useI18n } from "@/i18n"
import { parseAddresses } from "@/lib/addresses"
import { api, errorText } from "@/lib/api"
import { sendOnModEnter } from "@/lib/hotkeys"

export function ComposePage({
  accounts,
  defaultAccountId,
  hidden,
  onClose,
}: {
  accounts: MailAccountView[]
  /** The mailbox being viewed, if one is. */
  defaultAccountId: string
  /** A conversation is open on top; the draft stays until it closes. */
  hidden: boolean
  onClose: () => void
}) {
  const t = useI18n().t.compose
  const usable = accounts.filter((account) => account.status === "active")
  const [accountId, setAccountId] = useState(
    usable.find((account) => account.id === defaultAccountId)?.id ?? usable[0]?.id ?? ""
  )
  const [to, setTo] = useState("")
  const [cc, setCc] = useState("")
  const [bcc, setBcc] = useState("")
  const [copies, setCopies] = useState(false)
  const [subject, setSubject] = useState("")
  const [text, setText] = useState("")
  const [files, setFiles] = useState<MailAttachmentUpload[]>([])
  const hasDraft = Boolean(to || cc || bcc || subject || text || files.length)

  // Opening a conversation only needs to keep something worth coming back to.
  useEffect(() => {
    if (hidden && !hasDraft) onClose()
  }, [hidden, hasDraft, onClose])

  const send = useMutation({
    mutationFn: (message: MailOutgoing) =>
      api(`/api/mail/accounts/${accountId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      }),
    onSuccess: () => {
      toast.success(t.sent)
      onClose()
    },
    onError: (error) => toast.error(errorText(error)),
  })

  function submit() {
    if (send.isPending || !accountId) return
    const parsed = [to, cc, bcc].map(parseAddresses)
    const invalid = parsed.find((item) => item.invalid)?.invalid
    if (invalid) return toast.error(t.invalid(invalid))
    const [toList, ccList, bccList] = parsed.map((item) => item.addresses) as [
      MailAddress[],
      MailAddress[],
      MailAddress[],
    ]
    if (toList.length + ccList.length + bccList.length === 0) return toast.error(t.noRecipients)
    send.mutate({ to: toList, cc: ccList, bcc: bccList, subject, text, attachments: files })
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", hidden && "hidden")}>
      <header className="flex h-10 shrink-0 items-center justify-end px-2">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t.close} title={t.close} onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} aria-hidden="true" />
        </Button>
      </header>
      {/* Relative keeps the file input, which is absolute, inside this scroller. */}
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col px-4 pt-2 pb-4 md:px-8">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">{t.title}</h2>
          <form
            className="flex min-h-96 flex-1 flex-col overflow-hidden rounded-2xl border bg-background shadow-sm"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !hasDraft) onClose()
              sendOnModEnter(event)
            }}
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <div className="pt-1">
              {usable.length > 1 && (
                <MessageRow label={t.from}>
                  <AccountDot color={usable.find((account) => account.id === accountId)?.color ?? 0} />
                  <select
                    className="-ml-2 h-10 min-w-0 flex-1 bg-transparent outline-none"
                    value={accountId}
                    onChange={(event) => setAccountId(event.target.value)}
                  >
                    {usable.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.email}
                      </option>
                    ))}
                  </select>
                </MessageRow>
              )}
              <MessageRow
                label={t.to}
                action={
                  !copies && (
                    <button
                      type="button"
                      className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => setCopies(true)}
                    >
                      {t.cc} / {t.bcc}
                    </button>
                  )
                }
              >
                <MessageInput
                  autoFocus
                  placeholder={t.hint}
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </MessageRow>
              {copies && (
                <>
                  <MessageRow label={t.cc}>
                    <MessageInput value={cc} onChange={(event) => setCc(event.target.value)} />
                  </MessageRow>
                  <MessageRow label={t.bcc}>
                    <MessageInput value={bcc} onChange={(event) => setBcc(event.target.value)} />
                  </MessageRow>
                </>
              )}
              <MessageRow label={t.subject}>
                <MessageInput value={subject} onChange={(event) => setSubject(event.target.value)} />
              </MessageRow>
            </div>
            <MessageText aria-label={t.body} value={text} onChange={(event) => setText(event.target.value)} />
            <footer className="flex shrink-0 items-center justify-between gap-3 p-2">
              <AttachmentPicker files={files} onChange={setFiles} />
              <Button type="submit" disabled={send.isPending || !accountId} title={`${t.send} (⌘↵)`}>
                {t.send}
              </Button>
            </footer>
          </form>
        </div>
      </div>
    </div>
  )
}
