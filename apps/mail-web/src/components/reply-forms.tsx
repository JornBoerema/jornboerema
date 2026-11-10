import { lazy, Suspense, useState } from "react"
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
import { AddressRow } from "@/components/address-row"
import { useI18n } from "@/i18n"
import { parseAddresses } from "@/lib/addresses"
import { api, errorText } from "@/lib/api"
import { sendOnModEnter } from "@/lib/hotkeys"
import type { RichTextValue } from "@/components/rich-text-editor"

const RichTextEditor = lazy(() => import("@/components/rich-text-editor"))

const JSON_HEADERS = { "Content-Type": "application/json" }
const FORM = "flex max-h-[60dvh] flex-col overflow-hidden rounded-2xl border bg-background shadow-sm"
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
  signature,
  all,
  onClose,
}: {
  threadId: string
  message: MailThreadMessage
  selfEmail: string
  /** Empty for none. */
  signature: string
  all: boolean
  onClose: () => void
}) {
  const t = useI18n().t.conversation
  const queryClient = useQueryClient()
  const [body, setBody] = useState<RichTextValue>({ text: "", html: "", inline: [], written: false })
  const [files, setFiles] = useState<MailAttachmentUpload[]>([])
  const { to, cc } = replyRecipients(message, selfEmail, all)
  const send = useMutation({
    mutationFn: () =>
      api(`/api/mail/threads/${encodeURIComponent(threadId)}/reply`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          messageId: message.id,
          to,
          cc,
          text: body.text,
          ...(body.html && { html: body.html }),
          attachments: files,
          ...(body.inline.length > 0 && { inline: body.inline }),
        }),
      }),
    onSuccess: () => {
      toast.success(t.sent)
      onClose()
      void queryClient.invalidateQueries({ queryKey: ["mail-thread", threadId] })
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const canSend = !send.isPending && body.written && to.length > 0

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
      <Suspense fallback={<div className="min-h-32" />}>
        <RichTextEditor
          autoFocus
          label={t.replyPlaceholder}
          placeholder={t.replyPlaceholder}
          className="min-h-32 flex-1"
          signature={signature}
          onChange={setBody}
        />
      </Suspense>
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
  signature,
  onClose,
}: {
  threadId: string
  message: MailThreadMessage
  signature: string
  onClose: () => void
}) {
  const { t: strings } = useI18n()
  const t = strings.conversation
  const [to, setTo] = useState("")
  const [body, setBody] = useState<RichTextValue>({ text: "", html: "", inline: [], written: false })
  const send = useMutation({
    mutationFn: (recipients: MailAddress[]) =>
      api(`/api/mail/threads/${encodeURIComponent(threadId)}/forward`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          messageId: message.id,
          to: recipients,
          cc: [],
          text: body.text,
          ...(body.html && { html: body.html }),
          ...(body.inline.length > 0 && { inline: body.inline }),
        }),
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
      <AddressRow label={t.to} autoFocus value={to} onChange={setTo} />
      <Suspense fallback={<div className="min-h-24" />}>
        <RichTextEditor
          label={t.forwardPlaceholder}
          placeholder={t.forwardPlaceholder}
          className="min-h-24 flex-1"
          signature={signature}
          onChange={setBody}
        />
      </Suspense>
      <div className="flex items-center justify-between gap-3 p-2">
        <p className="px-2 text-xs text-muted-foreground">
          {message.attachments.length > 0 && t.forwardAttachments(message.attachments.length)}
        </p>
        <Actions canSend={!send.isPending} onClose={onClose} />
      </div>
    </form>
  )
}
