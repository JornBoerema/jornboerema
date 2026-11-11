import {
  ArchiveIcon,
  ArrowLeft01Icon,
  Delete02Icon,
  FilterMailRemoveIcon,
  MailOpen01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { Skeleton } from "@evido/ui/components/skeleton"
import { cn } from "@evido/ui/lib/utils"
import type { MailSenderView, MailThreadView } from "@evido/mail-core/types"
import { ContactAvatar } from "@/components/contact-avatar"
import { useI18n } from "@/i18n"
import { shortDate } from "@/lib/dates"
import { readingColumn } from "@/lib/layout"
import { usePrefetchThreads } from "@/lib/mail"
import { useSenderConversations, type SenderAction } from "@/lib/senders"

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-lg font-semibold tracking-tight tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

function Action({
  icon,
  label,
  destructive,
  onClick,
}: {
  icon: IconSvgElement
  label: string
  destructive?: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn(destructive && "text-destructive hover:bg-destructive/10 hover:text-destructive")}
      onClick={onClick}
    >
      <HugeiconsIcon icon={icon} strokeWidth={1.75} data-icon="inline-start" aria-hidden="true" />
      {label}
    </Button>
  )
}

/**
 * The reading pane for Tidy up: one sender, not one mail. Who they are, how
 * much of the inbox is theirs, the ways to clear it, and their conversations,
 * each of which opens like any mail.
 */
export function SenderPane({
  sender,
  accountId,
  onBack,
  onOpenThread,
  onUnsubscribe,
  onAct,
}: {
  sender: MailSenderView
  accountId: string
  onBack: () => void
  onOpenThread: (thread: MailThreadView) => void
  onUnsubscribe: () => void
  /** Archive and trash ask first; read goes straight away. */
  onAct: (action: SenderAction) => void
}) {
  const { t: strings, locale } = useI18n()
  const t = strings.senders
  const conversations = useSenderConversations(sender.email, accountId)
  const prefetch = usePrefetchThreads()
  const number = (value: number) => value.toLocaleString(locale)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center px-2 md:hidden">
        <Button variant="ghost" size="icon-sm" aria-label={t.back} onClick={onBack}>
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </header>
      <div className="scroll-fade fade-top-only min-h-0 flex-1 overflow-y-auto">
        <div className={cn(readingColumn, "flex flex-col gap-7 px-4 pt-8 pb-10 md:px-8")}>
          <div className="flex items-center gap-4">
            <ContactAvatar name={sender.name} email={sender.email} className="size-12 text-base" />
            <div className="flex min-w-0 flex-col">
              <h2 className="truncate text-lg font-semibold tracking-tight">{sender.name ?? sender.email}</h2>
              {sender.name && <p className="truncate text-sm text-muted-foreground">{sender.email}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-y py-4 sm:grid-cols-4">
            <Stat value={number(sender.messages)} label={t.statMessages} />
            <Stat value={number(sender.unread)} label={t.statUnread} />
            <Stat value={number(sender.conversations)} label={t.statConversations} />
            <Stat value={shortDate(sender.latest, locale)} label={t.statLatest} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Action icon={FilterMailRemoveIcon} label={t.unsubscribe} onClick={onUnsubscribe} />
            {sender.unread > 0 && <Action icon={MailOpen01Icon} label={t.readAll} onClick={() => onAct("read")} />}
            <Action icon={ArchiveIcon} label={t.archiveAll} onClick={() => onAct("archive")} />
            <Action icon={Delete02Icon} label={t.trashAll} destructive onClick={() => onAct("trash")} />
          </div>

          <section aria-labelledby="sender-conversations" className="flex flex-col gap-1">
            <h3 id="sender-conversations" className="mb-1 text-xs font-medium text-muted-foreground">
              {t.recent}
            </h3>
            {conversations.isPending &&
              Array.from({ length: 5 }, (_, index) => (
                <div key={index} className="flex flex-col gap-2 py-2.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-5/6" />
                </div>
              ))}
            {conversations.isSuccess && conversations.data.threads.length === 0 && (
              <p className="text-sm text-muted-foreground">{t.noConversations}</p>
            )}
            <ul className="-mx-2.5 flex flex-col gap-0.5">
              {conversations.data?.threads.map((thread) => (
                <li key={thread.id}>
                  <button
                    type="button"
                    onClick={() => onOpenThread(thread)}
                    onMouseEnter={() => prefetch.onHover(thread.id)}
                    onMouseLeave={() => prefetch.onHover(null)}
                    className="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors outline-none hover:bg-accent/60 focus-visible:bg-accent"
                  >
                    <span className="flex items-center gap-2">
                      <span className={cn("min-w-0 flex-1 truncate", thread.isRead ? "text-muted-foreground" : "font-medium")}>
                        {thread.subject || strings.inbox.noSubject}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {shortDate(thread.receivedAt, locale)}
                      </span>
                    </span>
                    {thread.snippet && <span className="truncate text-muted-foreground">{thread.snippet}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
