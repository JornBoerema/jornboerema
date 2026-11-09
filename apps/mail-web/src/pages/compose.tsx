import { useEffect, useRef, useState } from "react"
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
import { AddressRow } from "@/components/address-row"
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
  onHide,
  onClose,
}: {
  accounts: MailAccountView[]
  /** The mailbox being viewed, if one is. */
  defaultAccountId: string
  /** Out of view for now; a draft stays until the composer comes back. */
  hidden: boolean
  onHide: () => void
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

  // Only something worth coming back to stays around while out of view.
  useEffect(() => {
    if (hidden && !hasDraft) onClose()
  }, [hidden, hasDraft, onClose])

  // On the document, so Escape works wherever focus is. Open dropdowns claim it first.
  useEffect(() => {
    if (hidden) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onHide()
    }
    document.addEventListener("keydown", keydown)
    return () => document.removeEventListener("keydown", keydown)
  }, [hidden, onHide])

  const body = useRef<HTMLTextAreaElement>(null)
  const wasHidden = useRef(hidden)
  useEffect(() => {
    if (wasHidden.current && !hidden) body.current?.focus()
    wasHidden.current = hidden
  }, [hidden])

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
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col pt-2">
          <h2 className="mb-2 px-4 text-lg font-semibold tracking-tight md:px-8">{t.title}</h2>
          <form
            className="flex flex-1 flex-col md:px-4"
            onKeyDown={sendOnModEnter}
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
              <AddressRow
                label={t.to}
                autoFocus
                placeholder={t.hint}
                value={to}
                onChange={setTo}
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
              />
              {copies && (
                <>
                  <AddressRow label={t.cc} value={cc} onChange={setCc} />
                  <AddressRow label={t.bcc} value={bcc} onChange={setBcc} />
                </>
              )}
              <MessageRow label={t.subject}>
                <MessageInput value={subject} onChange={(event) => setSubject(event.target.value)} />
              </MessageRow>
            </div>
            <MessageText
              ref={body}
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
