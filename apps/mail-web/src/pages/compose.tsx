import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeft02Icon, Delete02Icon } from "@hugeicons/core-free-icons"
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
import { Spinner } from "@evido/ui/components/spinner"
import { cn } from "@evido/ui/lib/utils"
import { readingColumn } from "@/lib/layout"
import {
  MAX_UPLOAD_BYTES,
  type MailAccountView,
  type MailAddress,
  type MailDraftOpened,
  type MailDraftRequest,
  type MailOutgoing,
  type WithAttachmentRefs,
} from "@evido/mail-core/types"
import { AccountDot } from "@/components/account-dot"
import { AddressRow } from "@/components/address-row"
import { AttachmentPicker } from "@/components/attachment-picker"
import { MessageInput, MessageRow } from "@/components/message-field"
import type { RichTextHandle } from "@/components/rich-text-editor"
import { useI18n } from "@/i18n"
import { isEmail, joinRecipients, parseAddresses } from "@/lib/addresses"
import { api, errorText } from "@/lib/api"
import {
  deleteDraft,
  DRAFTS_KEY,
  sendDraft,
  useDraft,
  useDraftAutosave,
  type DraftRef,
} from "@/lib/drafts"
import { textToEditorHtml } from "@/lib/email-compose"
import { fromInlineImages, uploadBytes } from "@/lib/inline-images"
import {
  fromRefs,
  isUploading,
  useAttachmentRefs,
  type ComposerFile,
} from "@/lib/uploads"
import { isAiWriteKey, sendOnModEnter } from "@/lib/hotkeys"
import { AiPrompt, AiWriteButton, useAiWriter } from "@/components/ai-writer"
import { SendButton } from "@/components/send-button"
import { syncSoon } from "@/lib/mail"
import { UndoneError, waitForUndo } from "@/lib/undo"
import { useSignatureChoice } from "@/lib/signatures"
import { SignaturePicker } from "@/components/signature-picker"

const RichTextEditor = lazy(() => import("@/components/rich-text-editor"))

type ComposeProps = {
  accounts: MailAccountView[]
  /** The mailbox being viewed, if one is. */
  defaultAccountId: string
  /** The saved draft to continue, or null for a new message. */
  draft: DraftRef | null
  /** Out of view for now; a draft stays until the composer comes back. */
  hidden: boolean
  onHide: () => void
  /** Brings it back into view, after undoing a send. */
  onShow: () => void
  onClose: () => void
  /** The draft this message is saved as, once it is. */
  onDraftChange: (id: string | null) => void
  /** Goes up when the draft is deleted from the list while open here. */
  discardRequest: number
}

/** Escape hides the composer wherever focus is. Open dropdowns claim it first. */
function useEscapeToHide(hidden: boolean, onHide: () => void) {
  useEffect(() => {
    if (hidden) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      // ProseMirror marks every Escape as handled without doing anything with it.
      const inEditor =
        event.target instanceof HTMLElement &&
        event.target.closest(".ProseMirror")
      if (inEditor || !event.defaultPrevented) onHide()
    }
    document.addEventListener("keydown", keydown)
    return () => document.removeEventListener("keydown", keydown)
  }, [hidden, onHide])
}

function ComposeHeader({ onHide }: { onHide: () => void }) {
  const t = useI18n().t.compose
  return (
    <header className="flex h-10 shrink-0 items-center px-2">
      {/* Phones have no Escape key. */}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        aria-label={t.close}
        onClick={onHide}
      >
        <HugeiconsIcon
          icon={ArrowLeft02Icon}
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </Button>
    </header>
  )
}

export function ComposePage(props: ComposeProps) {
  const t = useI18n().t.drafts
  const loaded = useDraft(props.draft)
  useEscapeToHide(
    props.hidden || !props.draft || Boolean(loaded.data),
    props.onHide
  )
  if (props.draft && !loaded.data)
    return (
      <div
        className={cn("flex min-h-0 flex-1 flex-col", props.hidden && "hidden")}
      >
        <ComposeHeader onHide={props.onHide} />
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {loaded.isError ? t.openFailed : <Spinner />}
        </div>
      </div>
    )
  return <ComposeForm {...props} initial={loaded.data ?? null} />
}

const recipientList = (value: string) =>
  parseAddresses(value).addresses.filter((item) => isEmail(item.email))
const recipientText = (addresses: MailAddress[] = []) =>
  joinRecipients(addresses.map((item) => item.email))

function ComposeForm({
  accounts,
  defaultAccountId,
  draft,
  initial,
  hidden,
  onHide,
  onShow,
  onClose,
  onDraftChange,
  discardRequest,
}: ComposeProps & { initial: MailDraftOpened | null }) {
  const t = useI18n().t.compose
  const queryClient = useQueryClient()
  const usable = accounts.filter((account) => account.status === "active")
  const [accountId, setAccountId] = useState(
    draft?.accountId ??
      usable.find((account) => account.id === defaultAccountId)?.id ??
      usable[0]?.id ??
      ""
  )
  const [to, setTo] = useState(() => recipientText(initial?.to))
  const [cc, setCc] = useState(() => recipientText(initial?.cc))
  const [bcc, setBcc] = useState(() => recipientText(initial?.bcc))
  const [copies, setCopies] = useState(
    Boolean(initial?.cc.length || initial?.bcc.length)
  )
  const [subject, setSubject] = useState(initial?.subject ?? "")
  const [body, setBody] = useState({
    text: initial?.text ?? "",
    html: initial?.html ?? "",
    inline: initial?.inline ?? [],
    written: Boolean(initial?.text.trim() || initial?.html),
  })
  const [files, setFiles] = useState<ComposerFile[]>(() =>
    fromRefs(initial?.attachments ?? [])
  )
  const attachments = useAttachmentRefs(files)
  const [editorReady, setEditorReady] = useState(false)
  const [initialHtml] = useState(
    () =>
      initial &&
      (initial.html
        ? fromInlineImages(initial.html, initial.inline)
        : textToEditorHtml(initial.text))
  )
  const reply = initial?.reply
  const signatureChoice = useSignatureChoice(
    usable.find((account) => account.id === accountId),
    reply ? "reply" : "new"
  )
  const signature = signatureChoice.html
  const editor = useRef<RichTextHandle>(null)
  const writer = useAiWriter({
    // A saved reply opened here still answers its conversation.
    url: reply
      ? `/api/mail/accounts/${encodeURIComponent(accountId)}/conversation/write?thread=${encodeURIComponent(reply.threadId)}`
      : "/api/mail/write",
    editor,
    hasSignature: Boolean(signature),
    subject,
    onSubject: setSubject,
  })
  const hasDraft = Boolean(
    to || cc || bcc || subject || body.written || files.length
  )

  const content: MailDraftRequest = {
    to: recipientList(to),
    cc: recipientList(cc),
    bcc: recipientList(bcc),
    subject,
    text: body.text,
    ...(body.html && { html: body.html }),
    attachments,
    ...(body.inline.length > 0 && { inline: body.inline }),
    ...(reply && { reply }),
  }
  const autosave = useDraftAutosave({
    accountId,
    content,
    initial: draft,
    ready: !draft || editorReady,
    written: body.written,
    onSaved: (ref) => onDraftChange(ref?.id ?? null),
  })

  // Only something worth coming back to stays around while out of view.
  useEffect(() => {
    if (hidden && !hasDraft) onClose()
  }, [hidden, hasDraft, onClose])

  useEscapeToHide(hidden, onHide)

  const wasHidden = useRef(hidden)
  useEffect(() => {
    if (wasHidden.current && !hidden) editor.current?.focus()
    wasHidden.current = hidden
  }, [hidden])

  const finished = () => {
    void queryClient.invalidateQueries({ queryKey: DRAFTS_KEY })
    onClose()
  }

  const send = useMutation({
    mutationFn: async (message: WithAttachmentRefs<MailOutgoing>) => {
      const { ref, attachmentsChanged } = await autosave.pause()
      // Out of the way while it can still be taken back, like Gmail's undo send.
      onHide()
      try {
        await waitForUndo(t.sending, t.undo)
        // A saved draft is sent as itself, so it leaves the drafts folder at the provider too.
        if (ref?.accountId === accountId)
          await sendDraft(
            ref,
            { ...message, ...(reply && { reply }) },
            attachmentsChanged
          )
        else {
          await api(`/api/mail/accounts/${accountId}/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(message),
          })
          if (ref) await deleteDraft(ref).catch(() => undefined)
        }
      } catch (error) {
        // Undone, or failed: the message comes back as it was, to change or try again.
        autosave.resume()
        onShow()
        throw error
      }
    },
    onSuccess: (_result, message) => {
      toast.success(t.sent)
      const recipients = new Set(
        [...message.to, ...message.cc, ...message.bcc].map((address) =>
          address.email.toLowerCase()
        )
      )
      syncSoon(queryClient, [
        accountId,
        ...usable
          .filter((account) => recipients.has(account.email.toLowerCase()))
          .map((account) => account.id),
      ])
      finished()
    },
    onError: (error) => {
      if (!(error instanceof UndoneError)) toast.error(errorText(error))
    },
  })

  const discard = useMutation({
    mutationFn: async () => {
      const { ref } = await autosave.pause()
      if (ref) await deleteDraft(ref)
    },
    onSuccess: finished,
    onError: (error) => {
      autosave.resume()
      toast.error(errorText(error))
    },
  })

  // Deleting from the list goes through here, so autosave can't bring the draft back.
  const discardedFor = useRef(discardRequest)
  useEffect(() => {
    if (discardRequest === discardedFor.current) return
    discardedFor.current = discardRequest
    discard.mutate()
  }, [discardRequest, discard])

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
    if (toList.length + ccList.length + bccList.length === 0)
      return toast.error(t.noRecipients)
    if (isUploading(files)) return toast.error(t.stillUploading)
    if (uploadBytes(body.inline) > MAX_UPLOAD_BYTES)
      return toast.error(t.tooLarge(`${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`))
    send.mutate({
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject,
      text: body.text,
      ...(body.html && { html: body.html }),
      attachments,
      ...(body.inline.length > 0 && { inline: body.inline }),
    })
  }

  const status = {
    idle: "",
    saving: t.saving,
    saved: t.saved,
    failed: t.saveFailed,
  }[autosave.status]

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", hidden && "hidden")}>
      <ComposeHeader onHide={onHide} />
      {/* Relative keeps the file input, which is absolute, inside this scroller. */}
      <div className="@container relative min-h-0 flex-1 overflow-y-auto">
        <div className={cn(readingColumn, "flex min-h-full flex-col pt-2")}>
          <h2 className="mb-2 px-4 text-lg font-semibold tracking-tight md:px-8">
            {draft ? t.editTitle : t.title}
          </h2>
          <form
            className="flex flex-1 flex-col md:px-4"
            onKeyDown={(event) => {
              if (isAiWriteKey(event) && writer.enabled) {
                event.preventDefault()
                writer.toggle()
              } else sendOnModEnter(event)
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
                    <SelectTrigger className="-ml-3 h-8! max-w-fit min-w-0 flex-1 bg-transparent">
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
                <MessageInput
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                />
              </MessageRow>
            </div>
            <Suspense fallback={<div className="min-h-40 flex-1" />}>
              <RichTextEditor
                ref={editor}
                label={t.body}
                placeholder={t.body}
                className="min-h-40 flex-1"
                initialHtml={initialHtml ?? undefined}
                signature={signature}
                onChange={(value) => {
                  setBody(value)
                  setEditorReady(true)
                }}
              />
            </Suspense>
            <div className="sticky bottom-4 z-10 mx-4 mb-4 shrink-0 rounded-2xl border bg-background/90 px-2.5 py-2 shadow-sm backdrop-blur-md">
              <AiPrompt writer={writer} className="mb-2 border-b px-1 pt-0.5 pb-2.5" />
              <div className="flex min-h-10 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1">
                <AttachmentPicker files={files} onChange={setFiles} />
                <AiWriteButton writer={writer} />
                <SignaturePicker choice={signatureChoice} />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span
                  role="status"
                  className={cn(
                    "mr-1 text-xs max-sm:sr-only",
                    autosave.status === "failed"
                      ? "text-destructive"
                      : "text-muted-foreground"
                  )}
                >
                  {status}
                </span>
                {(hasDraft || draft) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:bg-transparent! hover:text-destructive! dark:hover:bg-transparent!"
                    aria-label={t.discard}
                    title={t.discard}
                    disabled={discard.isPending || send.isPending}
                    onClick={() => discard.mutate()}
                  >
                    <HugeiconsIcon
                      icon={Delete02Icon}
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </Button>
                )}
                <SendButton label={t.send} disabled={send.isPending || !accountId} />
              </div>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
