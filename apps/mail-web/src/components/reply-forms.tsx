import { lazy, Suspense, useRef, useState, type KeyboardEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@evido/ui/components/button"
import {
  replyRecipients,
  type MailAddress,
  type MailThreadMessage,
  type MailAccountView,
} from "@evido/mail-core/types"
import { AttachButton, AttachmentList, useAttachments } from "@/components/attachment-picker"
import { SendButton } from "@/components/send-button"
import { SignaturePicker } from "@/components/signature-picker"
import { useSignatureChoice } from "@/lib/signatures"
import { isUploading, useAttachmentRefs, type ComposerFile } from "@/lib/uploads"
import { AddressRow } from "@/components/address-row"
import { useI18n } from "@/i18n"
import { textToEditorHtml } from "@/lib/email-compose"
import { parseAddresses } from "@/lib/addresses"
import { api, errorText } from "@/lib/api"
import { conversationUrl, syncSoon } from "@/lib/mail"
import { isAiWriteKey, sendOnModEnter } from "@/lib/hotkeys"
import { AiPrompt, AiWriteButton, useAiWriter, type AiWriter } from "@/components/ai-writer"
import type { RichTextHandle } from "@/components/rich-text-editor"
import type { RichTextValue } from "@/components/rich-text-editor"
import { fromInlineImages } from "@/lib/inline-images"
import { clearReplyDraft, saveReplyDraft, type ReplyDraft } from "@/lib/reply-drafts"

const RichTextEditor = lazy(() => import("@/components/rich-text-editor"))

const JSON_HEADERS = { "Content-Type": "application/json" }
const FORM = "flex max-h-[60dvh] flex-col overflow-hidden rounded-xl border bg-background shadow-sm"
const addressLabel = (address: MailAddress) => address.name ?? address.email

function Actions({ canSend, onClose }: { canSend: boolean; onClose: () => void }) {
  const t = useI18n().t.conversation
  return (
    <div className="flex items-center gap-1">
      <Button type="button" size="sm" variant="ghost" onClick={onClose}>
        {t.cancel}
      </Button>
      <SendButton label={t.send} disabled={!canSend} />
    </div>
  )
}

function keyDown(event: KeyboardEvent<HTMLFormElement>, writer: AiWriter) {
  if (isAiWriteKey(event) && writer.enabled) {
    event.preventDefault()
    writer.toggle()
  } else sendOnModEnter(event)
}

export function ReplyForm({
  threadId,
  message,
  selfEmail,
  account,
  all,
  initial,
  prefill,
  onClose,
}: {
  threadId: string
  message: MailThreadMessage
  selfEmail: string
  /** The mailbox replying, synced right after so the reply shows. */
  account: MailAccountView | undefined
  all: boolean
  /** A reply started earlier on this conversation, kept in the browser. */
  initial: ReplyDraft | null
  /** A suggested reply to start from, as plain text. */
  prefill?: string
  onClose: () => void
}) {
  const t = useI18n().t.conversation
  const queryClient = useQueryClient()
  const accountId = account?.id
  const signatureChoice = useSignatureChoice(account, "reply")
  const signature = signatureChoice.html
  const editor = useRef<RichTextHandle>(null)
  const writer = useAiWriter({ url: conversationUrl(threadId, "/write"), editor, hasSignature: Boolean(signature) })
  const [body, setBody] = useState<RichTextValue>({ text: "", html: "", inline: [], written: false })
  const [initialHtml] = useState(() => (initial ? fromInlineImages(initial.html, initial.inline) : undefined))
  const keep = (value: RichTextValue) => {
    setBody(value)
    if (value.written) saveReplyDraft(threadId, { mode: all ? "all" : "reply", html: value.html, inline: value.inline })
    else clearReplyDraft(threadId)
  }
  const [files, setFiles] = useState<ComposerFile[]>([])
  const attachments = useAttachmentRefs(files)
  const attach = useAttachments(files, setFiles)
  const { to, cc } = replyRecipients(message, selfEmail, all)
  const send = useMutation({
    mutationFn: () =>
      api(conversationUrl(threadId, "/reply"), {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          messageId: message.id,
          to,
          cc,
          text: body.text,
          ...(body.html && { html: body.html }),
          attachments,
          ...(body.inline.length > 0 && { inline: body.inline }),
        }),
      }),
    onSuccess: () => {
      toast.success(t.sent)
      clearReplyDraft(threadId)
      onClose()
      void queryClient.invalidateQueries({ queryKey: ["mail-thread", threadId] })
      if (accountId) syncSoon(queryClient, [accountId])
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const canSend = !send.isPending && body.written && to.length > 0 && !isUploading(files)

  return (
    <form
      className={FORM}
      onKeyDown={(event) => keyDown(event, writer)}
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
          ref={editor}
          autoFocus
          label={t.replyPlaceholder}
          placeholder={t.replyPlaceholder}
          className="min-h-32 flex-1"
          signature={signature}
          initialHtml={initialHtml}
          initialBody={prefill && textToEditorHtml(prefill)}
          onChange={keep}
        />
      </Suspense>
      <AttachmentList files={files} onRemove={attach.remove} className="mx-2 border-t px-1 pt-2.5 pb-1" />
      <AiPrompt writer={writer} className="mx-2 border-t px-2 pt-2.5 pb-1" />
      <div className="flex items-center justify-between gap-3 p-2">
        <div className="flex min-w-0 items-center gap-1">
          <AttachButton onAdd={attach.add} />
          <AiWriteButton writer={writer} />
          <SignaturePicker choice={signatureChoice} />
        </div>
        <Actions
          canSend={canSend}
          onClose={() => {
            // Cancelling throws the reply away; leaving the conversation keeps it.
            clearReplyDraft(threadId)
            onClose()
          }}
        />
      </div>
    </form>
  )
}

export function ForwardForm({
  threadId,
  message,
  account,
  initial,
  onClose,
}: {
  threadId: string
  message: MailThreadMessage
  account: MailAccountView | undefined
  initial: ReplyDraft | null
  onClose: () => void
}) {
  const { t: strings } = useI18n()
  const t = strings.conversation
  const signatureChoice = useSignatureChoice(account, "reply")
  const signature = signatureChoice.html
  const editor = useRef<RichTextHandle>(null)
  const writer = useAiWriter({
    url: conversationUrl(threadId, "/write"),
    editor,
    hasSignature: Boolean(signature),
    forward: true,
  })
  const [to, setTo] = useState(initial?.to ?? "")
  const [body, setBody] = useState<RichTextValue>({ text: "", html: "", inline: [], written: false })
  const [initialHtml] = useState(() => (initial ? fromInlineImages(initial.html, initial.inline) : undefined))
  const keep = (next: { to?: string; value?: RichTextValue }) => {
    const recipients = next.to ?? to
    const value = next.value ?? body
    if (next.to !== undefined) setTo(next.to)
    if (next.value) setBody(next.value)
    if (value.written || recipients.trim())
      saveReplyDraft(threadId, { mode: "forward", html: value.html, inline: value.inline, to: recipients })
    else clearReplyDraft(threadId)
  }
  const send = useMutation({
    mutationFn: (recipients: MailAddress[]) =>
      api(conversationUrl(threadId, "/forward"), {
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
      clearReplyDraft(threadId)
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
      onKeyDown={(event) => keyDown(event, writer)}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <AddressRow label={t.to} autoFocus value={to} onChange={(value) => keep({ to: value })} />
      <Suspense fallback={<div className="min-h-24" />}>
        <RichTextEditor
          ref={editor}
          label={t.forwardPlaceholder}
          placeholder={t.forwardPlaceholder}
          className="min-h-24 flex-1"
          signature={signature}
          initialHtml={initialHtml}
          onChange={(value) => keep({ value })}
        />
      </Suspense>
      <AiPrompt writer={writer} className="mx-2 border-t px-2 pt-2.5 pb-1" />
      <div className="flex items-center justify-between gap-3 p-2">
        <div className="flex min-w-0 items-center gap-1">
          <AiWriteButton writer={writer} />
          <SignaturePicker choice={signatureChoice} />
          <p className="truncate px-2 text-xs text-muted-foreground">
            {message.attachments.length > 0 && t.forwardAttachments(message.attachments.length)}
          </p>
        </div>
        <Actions
          canSend={!send.isPending}
          onClose={() => {
            clearReplyDraft(threadId)
            onClose()
          }}
        />
      </div>
    </form>
  )
}
