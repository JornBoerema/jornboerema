import { useEffect, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@evido/ui/components/select"
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
        <div className="flex min-h-full flex-col pt-2">
          <h2 className="mb-2 px-4 text-lg font-semibold tracking-tight md:px-8">{t.title}</h2>
          <form
            className="flex flex-1 flex-col md:px-4"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !hasDraft) onClose()
              sendOnModEnter(event)
            }}
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <div className="shrink-0">
              {usable.length > 1 && (
                <MessageRow label={t.from}>
                  <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger className="-ml-3 h-8! min-w-0 max-w-fit flex-1 bg-transparent">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectGroup>
                        {usable.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            <span className="flex items-center gap-2">
                              <AccountDot color={account.color} />
                              {account.email}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
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
            <MessageText
              aria-label={t.body}
              placeholder={t.body}
              className="min-h-40"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <div className="sticky bottom-4 z-10 mx-4 mb-4 flex min-h-14 shrink-0 items-center justify-between gap-3 rounded-2xl border bg-background/90 px-2.5 py-2 shadow-sm backdrop-blur-md">
              <AttachmentPicker files={files} onChange={setFiles} />
              <Button type="submit" disabled={send.isPending || !accountId} title={`${t.send} (⌘↵)`}>
                {t.send}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
