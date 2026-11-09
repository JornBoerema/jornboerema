import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@evido/ui/components/button"
import {
  replyRecipients,
  type MailAddress,
  type MailAttachmentUpload,
  type MailThreadMessage,
} from "@evido/mail-core/types"
import { AttachmentPicker } from "@/components/attachment-picker"
import { MessageInput, MessageRow, MessageText } from "@/components/message-field"
import { useI18n } from "@/i18n"
import { parseAddresses } from "@/lib/addresses"
import { api, errorText } from "@/lib/api"
import { sendOnModEnter } from "@/lib/hotkeys"

const JSON_HEADERS = { "Content-Type": "application/json" }
const FORM = "flex max-h-[60dvh] flex-col overflow-hidden rounded-2xl border bg-card shadow-sm"
const addressLabel = (address: MailAddress) => address.name ?? address.email

function Actions({ canSend, onClose }: { canSend: boolean; onClose: () => void }) {
  const t = useI18n().t.conversation
  return (
    <div className="flex items-center gap-1">
      <Button type="button" size="sm" variant="ghost" onClick={onClose}>
        {t.cancel}
      </Button>
      <Button type="submit" size="sm" disabled={!canSend} title={`${t.send} (⌘↵)`}>
        {t.send}
      </Button>
    </div>
  )
}

export function ReplyForm({
  threadId,
  message,
  selfEmail,
  all,
  onClose,
}: {
  threadId: string
  message: MailThreadMessage
  selfEmail: string
  all: boolean
  onClose: () => void
}) {
  const t = useI18n().t.conversation
  const queryClient = useQueryClient()
  const [text, setText] = useState("")
  const [files, setFiles] = useState<MailAttachmentUpload[]>([])
  const { to, cc } = replyRecipients(message, selfEmail, all)
  const send = useMutation({
    mutationFn: () =>
      api(`/api/mail/threads/${encodeURIComponent(threadId)}/reply`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ messageId: message.id, to, cc, text, attachments: files }),
      }),
    onSuccess: () => {
      toast.success(t.sent)
      onClose()
      void queryClient.invalidateQueries({ queryKey: ["mail-thread", threadId] })
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const canSend = !send.isPending && Boolean(text.trim()) && to.length > 0

  return (
    <form
      className={FORM}
      onKeyDown={sendOnModEnter}
      onSubmit={(event) => {
        event.preventDefault()
        if (canSend) send.mutate()
      }}
    >
      <p className="truncate border-b px-4 py-2 text-xs text-muted-foreground">
        {t.to}: {to.map(addressLabel).join(", ")}
        {cc.length > 0 && ` · ${t.cc}: ${cc.map(addressLabel).join(", ")}`}
      </p>
      <MessageText
        autoFocus
        aria-label={t.replyPlaceholder}
        placeholder={t.replyPlaceholder}
        className="min-h-32"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex items-center justify-between gap-3 p-2">
        <AttachmentPicker files={files} onChange={setFiles} />
        <Actions canSend={canSend} onClose={onClose} />
      </div>
    </form>
  )
}

export function ForwardForm({
  threadId,
  message,
  onClose,
}: {
  threadId: string
  message: MailThreadMessage
  onClose: () => void
}) {
  const { t: strings } = useI18n()
  const t = strings.conversation
  const [to, setTo] = useState("")
  const [text, setText] = useState("")
  const send = useMutation({
    mutationFn: (recipients: MailAddress[]) =>
      api(`/api/mail/threads/${encodeURIComponent(threadId)}/forward`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ messageId: message.id, to: recipients, cc: [], text }),
      }),
    onSuccess: () => {
      toast.success(t.sent)
      onClose()
    },
    onError: (error) => toast.error(errorText(error)),
  })

  function submit() {
    if (send.isPending) return
    const { addresses, invalid } = parseAddresses(to)
    if (invalid) return toast.error(strings.compose.invalid(invalid))
    if (addresses.length === 0) return toast.error(strings.compose.noRecipients)
    send.mutate(addresses)
  }

  return (
    <form
      className={FORM}
      onKeyDown={sendOnModEnter}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <MessageRow label={t.to}>
        <MessageInput autoFocus value={to} onChange={(event) => setTo(event.target.value)} />
      </MessageRow>
      <MessageText
        aria-label={t.forwardPlaceholder}
        placeholder={t.forwardPlaceholder}
        className="min-h-24"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex items-center justify-between gap-3 p-2">
        <p className="px-2 text-xs text-muted-foreground">
          {message.attachments.length > 0 && t.forwardAttachments(message.attachments.length)}
        </p>
        <Actions canSend={!send.isPending} onClose={onClose} />
      </div>
    </form>
  )
}
