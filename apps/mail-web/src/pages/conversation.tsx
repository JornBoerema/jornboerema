import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ArchiveIcon,
  SpamIcon,
  StarIcon,
  ArrowLeft02Icon,
  Attachment01Icon,
  MailOpen01Icon,
  MailReply01Icon,
  MailReplyAll01Icon,
  MailSend01Icon,
  AlarmClockIcon,
  AlarmClockOffIcon,
  TaskAdd01Icon,
  PinIcon,
  PinOffIcon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { Spinner } from "@evido/ui/components/spinner"
import { cn } from "@evido/ui/lib/utils"
import { readingColumn } from "@/lib/layout"
import {
  canDeleteForever,
  type MailAccountView,
  type MailAddress,
  type MailFolder,
  type MailAttachmentInfo,
  type MailThreadAction,
  type MailThreadMessage,
  type MailThreadView,
} from "@evido/mail-core/types"
import { AccountDot } from "@/components/account-dot"
import { MailSummaryCard } from "@/components/mail-summary"
import { ShipmentCard } from "@/components/parcels"
import { InvoiceCard } from "@/components/invoices"
import { LinkedTodos, TodoDialog } from "@/components/todo-from-mail"
import { usePins, useTodos } from "@/lib/preferences"
import { canPin, usePin, usePinned } from "@/lib/pins"
import { UnsubscribeButton } from "@/components/unsubscribe-button"
import { WhenPicker } from "@/components/when-picker"
import { ForwardForm, ReplyForm } from "@/components/reply-forms"
import { ReplySuggestions } from "@/components/reply-suggestions"
import { MessageTranslation, TranslateButton } from "@/components/message-translation"
import { readReplyDraft, type ReplyMode } from "@/lib/reply-drafts"
import { useI18n } from "@/i18n"
import { apiBlob } from "@/lib/api"
import { buildEmailDocument, hasOwnBackground, hasRemoteImages, sanitizeEmail, withoutQuote } from "@/lib/email-html"
import { useTheme } from "@evido/ui/lib/theme"
import { useScrollFade } from "@evido/ui/hooks/use-scroll-fade"
import { useHotkeys } from "@/lib/hotkeys"
import { canReportSpam, conversationUrl, moveActions, STARRED, threadQuery, useStoredThread, useThreadAction } from "@/lib/mail"
import { DANGER, isDestructive, MOVE_ICONS, MOVE_KEYS, moveLabel } from "@/lib/thread-actions"
import { useAlwaysShowImages } from "@/lib/preferences"
import { IconTip } from "@/components/icon-tip"

/** Long enough that walking past a mail with j/k leaves it unread. */
const MARK_READ_DELAY_MS = 1200

const label = (address: MailAddress) => address.name ?? address.email

/** From this many messages a thread folds away the ones in the middle. */
const LONG_THREAD = 5

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
  // In the dark theme plain mail goes dark too; designed mail keeps its white paper.
  const plain = !hasOwnBackground(html)
  const dark = useTheme().resolvedTheme === "dark" && plain
  const source = useMemo(() => buildEmailDocument(html, allowImages, dark, plain), [html, allowImages, dark, plain])
  useEffect(() => () => observer.current?.disconnect(), [])

  function onLoad() {
    const inner = frame.current?.contentDocument
    if (!inner?.body) return
    const content = inner.getElementById("evido-mail") ?? inner.body
    // The content's own height plus the body's padding; the frame then never scrolls.
    const update = () => {
      const padding = inner.body.offsetHeight - inner.body.clientHeight + 24
      setHeight(Math.ceil(content.getBoundingClientRect().height + padding))
    }
    update()
    observer.current?.disconnect()
    observer.current = new ResizeObserver(update)
    observer.current.observe(content)
    // Shortcuts keep working after a click inside the message.
    inner.addEventListener("keydown", (event) => {
      document.dispatchEvent(new KeyboardEvent("keydown", event))
    })
  }

  return (
    <iframe
      ref={frame}
      title={title}
      srcDoc={source}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      scrolling="no"
      onLoad={onLoad}
      style={{ height }}
      className={cn("w-full rounded-md border-0", plain ? "bg-transparent" : "bg-white")}
    />
  )
}

type SanitizedMessage = MailThreadMessage & { cleanHtml: string | null }

/** Types a browser only ever draws. SVG can carry scripts, so it stays out. */
const SAFE_INLINE = /^image\/(png|jpe?g|gif|webp)$/i
const MAX_INLINE_BYTES = 2 * 1024 * 1024
const MAX_INLINE_IMAGES = 20

const fetchAttachment = (threadId: string, messageId: string, attachmentId: string) =>
  apiBlob(conversationUrl(threadId, "/attachment"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId, attachmentId }),
  })

function toDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** Swaps `cid:` references for the images inside the message. Nothing external loads. */
function useBodyWithInlineImages(threadId: string, message: SanitizedMessage) {
  const html = message.cleanHtml
  const wanted = useMemo(
    () =>
      html
        ? message.inline
            .filter(
              (image) =>
                SAFE_INLINE.test(image.contentType) &&
                image.size <= MAX_INLINE_BYTES &&
                html.includes(`cid:${image.contentId}`)
            )
            .slice(0, MAX_INLINE_IMAGES)
        : [],
    [html, message.inline]
  )
  const images = useQuery({
    queryKey: ["mail-inline", threadId, message.id],
    enabled: wanted.length > 0,
    // Like the bodies: a few minutes in memory, so reopening shows them at once.
    gcTime: 5 * 60 * 1000,
    staleTime: Infinity,
    queryFn: () =>
      Promise.all(
        wanted.map(async (image) => {
          const blob = await fetchAttachment(threadId, message.id, image.id)
          const url = await toDataUrl(new Blob([blob], { type: image.contentType }))
          return { contentId: image.contentId, url }
        })
      ),
  })
  return useMemo(
    () =>
      (images.data ?? []).reduce(
        (body, image) => body?.replaceAll(`cid:${image.contentId}`, () => image.url) ?? null,
        html
      ),
    [images.data, html]
  )
}

function AttachmentChip({
  threadId,
  messageId,
  attachment,
}: {
  threadId: string
  messageId: string
  attachment: MailAttachmentInfo
}) {
  const t = useI18n().t.conversation
  const download = useMutation({
    mutationFn: () => fetchAttachment(threadId, messageId, attachment.id),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = attachment.name
      link.click()
      URL.revokeObjectURL(url)
    },
    onError: () => toast.error(t.downloadFailed),
  })
  const content = (
    <>
      {download.isPending ? (
        <Spinner className="size-3.5" />
      ) : (
        <HugeiconsIcon icon={Attachment01Icon} strokeWidth={1.75} aria-hidden="true" className="size-3.5 shrink-0" />
      )}
      <span className="truncate">{attachment.name}</span>
      <span className="shrink-0">{formatSize(attachment.size)}</span>
    </>
  )
  const chip = "flex h-7 max-w-64 items-center gap-1.5 rounded-md border px-2 text-xs text-muted-foreground"
  if (!attachment.id) return <span className={chip}>{content}</span>
  return (
    <button
      type="button"
      className={cn(chip, "transition-colors hover:bg-accent hover:text-foreground")}
      aria-label={t.download(attachment.name)}
      title={t.download(attachment.name)}
      disabled={download.isPending}
      onClick={() => download.mutate()}
    >
      {content}
    </button>
  )
}

/** Mounted only while expanded, so collapsed messages fetch no inline images. */
function MessageBody({
  threadId,
  message,
  sender,
  allowImages,
  quoted,
  translated,
  onOriginal,
}: {
  threadId: string
  message: SanitizedMessage
  sender: string
  allowImages: boolean
  /** Earlier messages are in the thread, so a quote of them can be tucked away. */
  quoted: boolean
  /** Shown in the reader's language instead. */
  translated: boolean
  onOriginal: () => void
}) {
  const t = useI18n().t.conversation
  const body = useBodyWithInlineImages(threadId, message)
  const trimmed = useMemo(() => (quoted && body ? withoutQuote(body) : null), [quoted, body])
  const [showQuote, setShowQuote] = useState(false)
  return (
    <>
      {translated ? (
        <MessageTranslation threadId={threadId} messageId={message.id} onDone={onOriginal} />
      ) : body ? (
        <div className="flex flex-col items-start gap-1">
          <EmailFrame
            html={trimmed && !showQuote ? trimmed : body}
            allowImages={allowImages}
            title={t.frameTitle(sender)}
          />
          {trimmed && (
            <IconTip label={showQuote ? t.hideQuote : t.showQuote}>
              <Button
                type="button"
                variant="secondary"
                size="xs"
                className="h-4 rounded-sm px-1.5"
                aria-label={showQuote ? t.hideQuote : t.showQuote}
                aria-expanded={showQuote}
                onClick={() => setShowQuote(!showQuote)}
              >
                <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} aria-hidden="true" className="size-3.5" />
              </Button>
            </IconTip>
          )}
        </div>
      ) : message.text ? (
        <p className="leading-relaxed break-words whitespace-pre-wrap">{message.text}</p>
      ) : (
        <p className="text-muted-foreground">{t.noBody}</p>
      )}
      {message.attachments.length > 0 && (
        <ul aria-label={t.attachments} className="flex flex-wrap gap-1.5">
          {message.attachments.map((attachment, index) => (
            <li key={`${attachment.name}-${index}`}>
              <AttachmentChip threadId={threadId} messageId={message.id} attachment={attachment} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function Message({
  threadId,
  message,
  allowImages,
  latest,
  quoted,
  account,
}: {
  threadId: string
  message: SanitizedMessage
  allowImages: boolean
  latest: boolean
  quoted: boolean
  /** The mailbox it came to: an unsubscribe message goes out from there. */
  account: MailAccountView | undefined
}) {
  const { t: strings, locale } = useI18n()
  const t = strings.conversation
  const [expanded, setExpanded] = useState(latest)
  const [translated, setTranslated] = useState(false)
  const showOriginal = useCallback(() => setTranslated(false), [])
  const translatable = Boolean(message.text?.trim() || message.html)
  const sender = message.from ? label(message.from) : strings.inbox.unknownSender
  const received = new Date(message.receivedAt).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  })

  return (
    <article className="flex flex-col gap-3 py-2.5 text-sm">
      <button
        type="button"
        aria-expanded={expanded}
        disabled={latest}
        className="-mx-2.5 flex items-baseline justify-between gap-4 rounded-lg px-2.5 py-1.5 text-left transition-colors enabled:hover:bg-accent/60"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="min-w-0 truncate">
          <span className="font-medium">{sender}</span>
          {expanded && message.from?.name && (
            <span className="text-xs text-muted-foreground"> {message.from.email}</span>
          )}
          {!expanded && message.text && (
            <span className="text-muted-foreground"> · {message.text.slice(0, 160)}</span>
          )}
        </span>
        <time className="shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={message.receivedAt}>
          {received}
        </time>
      </button>
      {expanded && (
        <>
          {(message.to.length + message.cc.length > 0 || message.unsubscribe || translatable) && (
            <div className="-mt-3 flex items-baseline gap-3">
              <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {message.to.length > 0 && `${t.to}: ${message.to.map(label).join(", ")}`}
                {message.cc.length > 0 && ` · ${t.cc}: ${message.cc.map(label).join(", ")}`}
              </p>
              {translatable && <TranslateButton on={translated} onChange={setTranslated} />}
              {message.unsubscribe && (
                <UnsubscribeButton
                  threadId={threadId}
                  messageId={message.id}
                  unsubscribe={message.unsubscribe}
                  sender={sender}
                  account={account}
                />
              )}
            </div>
          )}
          <MessageBody
            threadId={threadId}
            message={message}
            sender={sender}
            allowImages={allowImages}
            quoted={quoted}
            translated={translated}
            onOriginal={showOriginal}
          />
        </>
      )}
    </article>
  )
}

function ToolbarAction({
  icon,
  label: text,
  shortcut,
  pressed,
  className,
  onClick,
}: {
  icon: IconSvgElement
  label: string
  shortcut?: string
  pressed?: boolean
  className?: string
  onClick: () => void
}) {
  return (
    <IconTip label={text} shortcut={shortcut}>
      <Button variant="ghost" size="icon-sm" aria-label={text} aria-pressed={pressed} className={className} onClick={onClick}>
        <HugeiconsIcon icon={icon} strokeWidth={1.75} aria-hidden="true" />
      </Button>
    </IconTip>
  )
}

export function ConversationPage({
  thread: summary,
  account,
  folder,
  onBack,
  onLeave,
  onSnooze,
  snoozed,
  onUnsnooze,
}: {
  thread: MailThreadView
  /** Missing only for the moment a mailbox is being disconnected. */
  account: MailAccountView | undefined
  /** The folder it was opened from; null for the inbox and search. */
  folder: MailFolder | null
  onBack: () => void
  /** Runs an action; the list decides whether that takes the conversation out of view. */
  onLeave: (action: MailThreadAction) => void
  /** Snoozes it until then; it leaves the list as if archived. */
  onSnooze: (until: Date) => void
  /** Opened from Snoozed: the toolbar offers to have it back now instead. */
  snoozed?: boolean
  onUnsnooze?: () => void
}) {
  const strings = useI18n().t
  const t = strings.conversation
  const later = strings.later
  const scroller = useScrollFade<HTMLDivElement>()
  const moves = moveActions(folder, account ? canDeleteForever(account.provider) : false)
  const spam = canReportSpam(folder)
  const [starred, setStarred] = useState(summary.isStarred)
  const toggleStar = () => {
    setStarred(!starred)
    onLeave(starred ? "unstar" : "star")
  }
  const id = summary.id
  const alwaysShowImages = useAlwaysShowImages()
  const [showImagesOnce, setShowImagesOnce] = useState(false)
  const allowImages = alwaysShowImages || showImagesOnce
  // A reply left half written here comes back open, as it was.
  const [savedReply] = useState(() => readReplyDraft(summary.id))
  const [picking, setPicking] = useState(false)
  const todos = useTodos()
  const [makingTodo, setMakingTodo] = useState(false)
  // Pinning is for the inbox: opened from there, or from a list of what is in it.
  const pinsOn = usePins()
  const pinnable = pinsOn && folder === null && !snoozed && canPin(summary)
  const isPinned = usePinned("", pinnable).some((thread) => thread.id === summary.id)
  const { mutate: setPinned } = usePin()
  const togglePin = () => setPinned({ thread: summary, pinned: !isPinned })
  const [replyMode, setReplyMode] = useState<ReplyMode | null>(savedReply?.mode ?? null)
  // A picked suggestion, the reply starts from it.
  const [prefill, setPrefill] = useState<string | null>(null)
  const replyDraft = savedReply?.mode === replyMode ? savedReply : null
  const { mutate: runAction } = useThreadAction()
  // Often already here: rows load their conversation when hovered. On the web
  // bodies stay in memory for a few minutes and never reach the disk; the
  // desktop app keeps opened ones on the computer (see lib/cache).
  const thread = useQuery(threadQuery(id))
  useStoredThread(id)

  const opened = thread.isSuccess
  const needsRead = !summary.isRead
  useEffect(() => {
    if (!opened || !needsRead) return
    const timer = window.setTimeout(() => runAction({ id, action: "read" }), MARK_READ_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [opened, needsRead, id, runAction])

  useHotkeys({
    ...(moves.includes("archive") && { e: () => onLeave("archive") }),
    ...(moves.includes("trash") && { "#": () => onLeave("trash") }),
    ...(moves.includes("inbox") && { i: () => onLeave("inbox") }),
    ...(spam && { "!": () => onLeave("spam") }),
    s: toggleStar,
    b: () => (snoozed ? onUnsnooze?.() : setPicking(true)),
    u: () => onLeave("unread"),
    r: () => setReplyMode("reply"),
    a: () => setReplyMode("all"),
    f: () => setReplyMode("forward"),
    ...(todos && { t: () => setMakingTodo(true) }),
    ...(pinnable && { p: togglePin }),
  })

  const messages = useMemo<SanitizedMessage[]>(
    () =>
      (thread.data?.messages ?? []).map((message) => ({
        ...message,
        cleanHtml: message.html ? sanitizeEmail(message.html) : null,
      })),
    [thread.data]
  )
  const last = messages.at(-1)
  const newestFirst = useMemo(() => [...messages].reverse(), [messages])
  const [expandAll, setShowAll] = useState(false)
  const showAll = expandAll || newestFirst.length < LONG_THREAD
  const renderMessage = (message: SanitizedMessage) => (
    <Message
      key={message.id}
      threadId={id}
      message={message}
      allowImages={allowImages}
      latest={message === last}
      quoted={message !== messages[0]}
      account={account}
    />
  )
  const blockedImages =
    !allowImages && messages.some((message) => message.cleanHtml && hasRemoteImages(message.cleanHtml))
  const replyActions = [
    { mode: "all", text: t.replyAll, icon: MailReplyAll01Icon, shortcut: "A" },
    { mode: "forward", text: t.forward, icon: MailSend01Icon, shortcut: "F" },
    { mode: "reply", text: t.reply, icon: MailReply01Icon, shortcut: "R" },
  ] as const

  return (
    <>
      <header className="flex h-10 shrink-0 items-center gap-0.5 px-2">
        <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label={t.back} onClick={onBack}>
          <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={1.75} aria-hidden="true" />
        </Button>
        <div className="ml-auto flex items-center gap-0.5">
          <ToolbarAction
            icon={StarIcon}
            label={starred ? t.unstar : t.star}
            shortcut="S"
            pressed={starred}
            className={cn(starred && STARRED)}
            onClick={toggleStar}
          />
          {spam && (
            <ToolbarAction icon={SpamIcon} label={t.reportSpam} shortcut="!" onClick={() => onLeave("spam")} />
          )}
          {moves.map((action) => (
            <ToolbarAction
              key={action}
              icon={MOVE_ICONS[action] ?? ArchiveIcon}
              label={moveLabel(action, folder, t)}
              shortcut={MOVE_KEYS[action]}
              className={isDestructive(action) ? DANGER : undefined}
              onClick={() => onLeave(action)}
            />
          ))}
          {snoozed ? (
            <ToolbarAction icon={AlarmClockOffIcon} label={later.unsnooze} shortcut="B" onClick={() => onUnsnooze?.()} />
          ) : (
            <ToolbarAction icon={AlarmClockIcon} label={later.snooze} shortcut="B" onClick={() => setPicking(true)} />
          )}
          <ToolbarAction icon={MailOpen01Icon} label={t.markUnread} shortcut="U" onClick={() => onLeave("unread")} />
          {pinnable && (
            <ToolbarAction
              icon={isPinned ? PinOffIcon : PinIcon}
              label={isPinned ? strings.pins.unpin : strings.pins.pin}
              shortcut="P"
              pressed={isPinned}
              onClick={togglePin}
            />
          )}
          {todos && (
            <ToolbarAction icon={TaskAdd01Icon} label={strings.todos.make} shortcut="T" onClick={() => setMakingTodo(true)} />
          )}
        </div>
        <WhenPicker open={picking} onOpenChange={setPicking} purpose="snooze" onPick={onSnooze} />
        {todos && (
          <TodoDialog
            threadId={id}
            subject={messages[0]?.subject || summary.subject}
            from={last?.from?.name ?? last?.from?.email ?? summary.fromName ?? summary.fromEmail}
            open={makingTodo}
            onOpenChange={setMakingTodo}
          />
        )}
      </header>

      {/* Relative keeps absolute children, like screen-reader text, inside this scroller. */}
      {/* Fades only at the top: the reply bar sticks to the bottom inside this scroller. */}
      <div ref={scroller} className="scroll-fade fade-top-only @container relative min-h-0 flex-1 overflow-y-auto">
        <div className={cn(readingColumn, "flex min-h-full flex-col px-4 pt-2 md:px-8")}>
          <h2 className="mb-2 text-lg font-semibold tracking-tight break-words">
            {messages[0]?.subject || summary.subject}
          </h2>
          <ShipmentCard threadId={id} thread={summary} />
          <InvoiceCard threadId={id} thread={summary} messages={messages} />
          <LinkedTodos threadId={id} />
          <MailSummaryCard threadId={id} />
          {thread.isPending && (
            // What the list already knows, while the message itself comes in.
            <div className="flex flex-col gap-3 py-2" aria-busy="true">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{summary.fromName ?? summary.fromEmail}</span>
                <Spinner className="size-3.5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">{summary.snippet}</p>
              <span className="sr-only">{t.loading}</span>
            </div>
          )}
          {thread.isError && <p className="py-4 text-sm text-destructive">{t.loadFailed}</p>}
          {blockedImages && (
            <div className="mt-3 flex items-center justify-between gap-4 rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground">
              <p>{t.imagesBlocked}</p>
              <Button size="xs" variant="ghost" className="text-foreground" onClick={() => setShowImagesOnce(true)}>
                {t.showImages}
              </Button>
            </div>
          )}
          {/* Newest first, each apart from the next. A long thread shows the two
              newest and the one that started it; those between wait behind a
              count, as in Gmail. */}
          <div className="mt-1 flex flex-col divide-y divide-border/60">
            {(showAll ? newestFirst : newestFirst.slice(0, 2)).map(renderMessage)}
            {!showAll && (
              <div className="py-2.5">
                <button
                  type="button"
                  className="-mx-2.5 w-[calc(100%+1.25rem)] rounded-lg px-2.5 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                  onClick={() => setShowAll(true)}
                >
                  {t.hiddenMessages(newestFirst.length - 3)}
                </button>
              </div>
            )}
            {!showAll && renderMessage(newestFirst[newestFirst.length - 1])}
          </div>
          {last && (
            <div className="@container sticky bottom-4 z-10 mt-auto mb-4 pt-4">
              {replyMode === "forward" ? (
                <ForwardForm
                  threadId={id}
                  message={last}
                  account={account}
                  initial={replyDraft}
                  onClose={() => setReplyMode(null)}
                />
              ) : replyMode ? (
                <ReplyForm
                  key={replyMode}
                  threadId={id}
                  message={last}
                  selfEmail={account?.email ?? ""}
                  account={account}
                  all={replyMode === "all"}
                  initial={replyDraft}
                  prefill={prefill ?? undefined}
                  onClose={() => {
                    setReplyMode(null)
                    setPrefill(null)
                  }}
                />
              ) : (
                <>
                  <ReplySuggestions
                    threadId={id}
                    newestId={last.id}
                    onPick={(text) => {
                      setPrefill(text)
                      setReplyMode("reply")
                    }}
                  />
                  <div className="flex h-14 items-center justify-between gap-3 rounded-2xl border bg-background/90 pr-2.5 pl-4 text-sm shadow-sm backdrop-blur-md">
                    <p className="hidden min-w-0 items-center gap-1.5 @2xl:flex">
                      <span className="shrink-0 text-muted-foreground">{t.messageCount(messages.length)} ·</span>
                      {account && <AccountDot color={account.color} />}
                      <span className="truncate font-medium">{account?.email}</span>
                    </p>
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      {replyActions.map(({ mode, text, icon, shortcut }) => (
                        <IconTip key={mode} label={text} shortcut={shortcut}>
                          <Button variant={mode === "reply" ? "outline" : "ghost"} onClick={() => setReplyMode(mode)}>
                            <HugeiconsIcon icon={icon} strokeWidth={1.75} data-icon="inline-start" aria-hidden="true" />
                            <span className={cn(mode !== "reply" && "sr-only @lg:not-sr-only")}>{text}</span>
                          </Button>
                        </IconTip>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
