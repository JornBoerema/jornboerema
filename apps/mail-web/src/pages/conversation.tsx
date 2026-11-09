import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@evido/ui/components/button"
import {
  replyRecipients,
  type MailAddress,
  type MailThreadAction,
  type MailThreadDetail,
  type MailThreadMessage,
  type MailThreadView,
} from "@evido/mail-core/types"
import { useI18n } from "@/i18n"
import { api } from "@/lib/api"
import { buildEmailDocument, hasRemoteImages, sanitizeEmail } from "@/lib/email-html"
import { MESSAGES_KEY } from "@/lib/mail"

const label = (address: MailAddress) => address.name ?? address.email

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Scripts cannot run here: the sandbox omits allow-scripts. allow-same-origin is
 * only what lets this page measure the content, and is safe without scripts.
 */
function EmailFrame({ html, allowImages, title }: { html: string; allowImages: boolean; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const observer = useRef<ResizeObserver | null>(null)
  const [height, setHeight] = useState(120)
  const document = useMemo(() => buildEmailDocument(html, allowImages), [html, allowImages])
  useEffect(() => () => observer.current?.disconnect(), [])

  function measure() {
    const body = frame.current?.contentDocument?.body
    if (!body) return
    const update = () => setHeight(body.ownerDocument.documentElement.scrollHeight)
    update()
    observer.current?.disconnect()
    observer.current = new ResizeObserver(update)
    observer.current.observe(body)
  }

  return (
    <iframe
      ref={frame}
      title={title}
      srcDoc={document}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      onLoad={measure}
      style={{ height }}
      className="w-full rounded-md border-0 bg-white"
    />
  )
}

type SanitizedMessage = MailThreadMessage & { cleanHtml: string | null }

function Message({ message, allowImages }: { message: SanitizedMessage; allowImages: boolean }) {
  const { t: strings, locale } = useI18n()
  const t = strings.conversation
  const sender = message.from ? label(message.from) : strings.inbox.unknownSender
  const received = new Date(message.receivedAt).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  })

  return (
    <article className="flex flex-col gap-2 border-b pb-6 text-sm">
      <header>
        <div className="flex items-baseline justify-between gap-4">
          <p className="truncate font-semibold">
            {sender}
            {message.from && message.from.name && (
              <span className="font-normal text-muted-foreground"> &lt;{message.from.email}&gt;</span>
            )}
          </p>
          <time className="shrink-0 text-xs text-muted-foreground" dateTime={message.receivedAt}>
            {received}
          </time>
        </div>
        {message.to.length > 0 && (
          <p className="truncate text-xs text-muted-foreground">
            {t.to}: {message.to.map(label).join(", ")}
          </p>
        )}
        {message.cc.length > 0 && (
          <p className="truncate text-xs text-muted-foreground">
            {t.cc}: {message.cc.map(label).join(", ")}
          </p>
        )}
      </header>

      {message.cleanHtml ? (
        <EmailFrame html={message.cleanHtml} allowImages={allowImages} title={t.frameTitle(sender)} />
      ) : message.text ? (
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
      ) : (
        <p className="text-muted-foreground">{t.noBody}</p>
      )}

      {message.attachments.length > 0 && (
        <div>
          <p className="text-xs font-medium">{t.attachments}</p>
          <ul className="text-xs text-muted-foreground">
            {message.attachments.map((attachment, index) => (
              <li key={`${attachment.name}-${index}`}>
                {attachment.name} ({formatSize(attachment.size)})
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  )
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

function ReplyBox({
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
  const { to, cc } = replyRecipients(message, selfEmail, all)
  const send = useMutation({
    mutationFn: () =>
      api(`/api/mail/threads/${encodeURIComponent(threadId)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id, to, cc, text }),
      }),
    onSuccess: () => {
      toast.success(t.sent)
      onClose()
      void queryClient.invalidateQueries({ queryKey: ["mail-thread", threadId] })
    },
    onError: (error) => toast.error(errorText(error)),
  })

  return (
    <form
      className="flex flex-col gap-2 text-sm"
      onSubmit={(event) => {
        event.preventDefault()
        send.mutate()
      }}
    >
      <p className="text-xs text-muted-foreground">
        {t.to}: {to.map(label).join(", ")}
      </p>
      {cc.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t.cc}: {cc.map(label).join(", ")}
        </p>
      )}
      <textarea
        aria-label={t.replyPlaceholder}
        placeholder={t.replyPlaceholder}
        className="min-h-32 rounded-md border bg-background p-2"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={send.isPending || !text.trim() || to.length === 0}>
          {t.send}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          {t.cancel}
        </Button>
      </div>
    </form>
  )
}

export function ConversationPage({
  thread: summary,
  accountEmail,
  onBack,
}: {
  thread: MailThreadView
  accountEmail: string
  onBack: () => void
}) {
  const t = useI18n().t.conversation
  const queryClient = useQueryClient()
  const id = summary.id
  const [allowImages, setAllowImages] = useState(false)
  const [replyMode, setReplyMode] = useState<"reply" | "all" | null>(null)
  const thread = useQuery({
    queryKey: ["mail-thread", id],
    queryFn: () => api<MailThreadDetail>(`/api/mail/threads/${encodeURIComponent(id)}`),
    // Mail bodies stay out of the client cache once the conversation is closed.
    gcTime: 0,
    staleTime: 0,
  })
  const act = useMutation({
    mutationFn: (action: MailThreadAction) =>
      api(`/api/mail/threads/${encodeURIComponent(id)}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MESSAGES_KEY }),
  })

  const opened = thread.isSuccess
  const markedRead = useRef(summary.isRead)
  const { mutate: applyAction } = act
  useEffect(() => {
    if (!opened || markedRead.current) return
    markedRead.current = true
    applyAction("read")
  }, [opened, applyAction])

  function actAndLeave(action: MailThreadAction) {
    act.mutate(action, { onSuccess: onBack, onError: (error) => toast.error(errorText(error)) })
  }

  const messages = useMemo<SanitizedMessage[]>(
    () =>
      (thread.data?.messages ?? []).map((message) => ({
        ...message,
        cleanHtml: message.html ? sanitizeEmail(message.html) : null,
      })),
    [thread.data]
  )
  const last = messages.at(-1)
  const blockedImages =
    !allowImages && messages.some((message) => message.cleanHtml && hasRemoteImages(message.cleanHtml))

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← {t.back}
        </Button>
        <div className="ml-auto flex flex-wrap gap-1">
          <Button variant="outline" size="sm" disabled={act.isPending} onClick={() => actAndLeave("archive")}>
            {t.archive}
          </Button>
          <Button variant="outline" size="sm" disabled={act.isPending} onClick={() => actAndLeave("trash")}>
            {t.trash}
          </Button>
          <Button variant="outline" size="sm" disabled={act.isPending} onClick={() => actAndLeave("unread")}>
            {t.markUnread}
          </Button>
        </div>
      </div>
      {thread.isPending && <p className="text-sm text-muted-foreground">{t.loading}</p>}
      {thread.isError && <p className="text-sm text-destructive">{t.loadFailed}</p>}
      {messages[0] && <h2 className="text-lg font-semibold break-words">{messages[0].subject}</h2>}
      {blockedImages && (
        <div className="flex items-center justify-between gap-4 rounded-md border p-3 text-sm">
          <p className="text-muted-foreground">{t.imagesBlocked}</p>
          <Button size="sm" variant="outline" onClick={() => setAllowImages(true)}>
            {t.showImages}
          </Button>
        </div>
      )}
      {messages.map((message) => (
        <Message key={message.id} message={message} allowImages={allowImages} />
      ))}
      {last &&
        (replyMode ? (
          <ReplyBox
            key={replyMode}
            threadId={id}
            message={last}
            selfEmail={accountEmail}
            all={replyMode === "all"}
            onClose={() => setReplyMode(null)}
          />
        ) : (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setReplyMode("reply")}>
              {t.reply}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setReplyMode("all")}>
              {t.replyAll}
            </Button>
          </div>
        ))}
    </section>
  )
}
