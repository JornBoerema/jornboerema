import { useEffect, useRef, useState } from "react"
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArchiveIcon,
  SpamIcon,
  Mail01Icon,
  MailOpen01Icon,
  ArrowUpRight01Icon,
  Attachment01Icon,
  Delete02Icon,
  CloudAlertIcon,
  MinusSignSquareIcon,
  MoreHorizontalIcon,
  PackageDeliveredIcon,
  PencilEdit02Icon,
  Search01Icon,
  StarIcon,
  InboxIcon,
  SentIcon,
  AlarmClockIcon,
  FilterMailRemoveIcon,
  Flag02Icon,
} from "@hugeicons/core-free-icons"
import { MailboxFilter } from "@/components/mailbox-filter"
import { canReport, ReportRecognitionDialog } from "@/components/report-recognition"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { Checkbox } from "@evido/ui/components/checkbox"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@evido/ui/components/empty"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@evido/ui/components/dropdown-menu"
import { Skeleton } from "@evido/ui/components/skeleton"
import { Spinner } from "@evido/ui/components/spinner"
import { cn } from "@evido/ui/lib/utils"
import {
  canDeleteForever,
  isMailFolder,
  type MailFolder,
  type MailAccountView,
  type MailDraftView,
  type MailInvoiceView,
  type MailSenderView,
  type MailShipmentView,
  type MailThreadAction,
  type MailThreadsPage,
  type MailThreadView,
} from "@evido/mail-core/types"
import { AccountDot } from "@/components/account-dot"
import {
  MailMenu,
  type MailNavigation,
} from "@/components/sidebar"
import { useI18n } from "@/i18n"
import { api } from "@/lib/api"
import type { DraftRef, useDrafts } from "@/lib/drafts"
import { shortDate } from "@/lib/dates"
import { useHotkeys } from "@/lib/hotkeys"
import { useScrollFade } from "@/lib/scroll-fade"
import { CARRIER_NAMES, useShipments } from "@/lib/shipments"
import { setShowDelivered, useShowDelivered } from "@/lib/preferences"
import { formatMoment, useScheduled, useScheduledActions, useSnoozes, useUnsnooze } from "@/lib/later"
import { toast } from "sonner"
import { WhenPicker } from "@/components/when-picker"
import { nameOf, useSenderList, useTidy, type SenderAction } from "@/lib/senders"
import { SenderPane } from "@/components/sender-pane"
import { InvoiceStatus } from "@/components/invoices"
import { formatMoney, isOpen, useInvoiceList } from "@/lib/invoices"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@evido/ui/components/alert-dialog"
import { carrierName, Status } from "@/components/parcels"
import {
  leavesList,
  listKey,
  canReportSpam,
  moveActions,
  STARRED,
  usePrefetchThreads,
  useThreadAction,
  type SyncStatus,
} from "@/lib/mail"
import { EmptyPane } from "@/components/empty-pane"
import { EmptyTrashButton } from "@/components/empty-trash"
import { isDestructive, MOVE_ICONS, moveLabel } from "@/lib/thread-actions"
import { ComposePage } from "@/pages/compose"
import { ConversationPage } from "@/pages/conversation"
import { IconTip } from "@/components/icon-tip"


/**
 * Quick actions over the row's right end. They show on hover or keyboard focus,
 * in place of the date, and sit beside the row's button rather than inside it.
 */
function RowActions({
  actions,
}: {
  actions: { icon: IconSvgElement; label: string; run: () => void; destructive?: boolean; className?: string }[]
}) {
  return (
    <span className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
      {actions.map((action) => (
        <IconTip key={action.label} label={action.label}>
          <Button
            variant="ghost"
            size="icon-xs"
            // Only the icon reacts; the row already shows what is hovered.
            className={cn(
              "text-muted-foreground hover:bg-transparent! dark:hover:bg-transparent!",
              action.destructive ? "hover:text-destructive" : "hover:text-foreground",
              action.className
            )}
            aria-label={action.label}
            onClick={action.run}
          >
            <HugeiconsIcon icon={action.icon} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </IconTip>
      ))}
    </span>
  )
}


/** What the quick actions cover: the date and the small icons beside it. */
const UNDER_ACTIONS = "group-focus-within:invisible group-hover:invisible"

function ThreadRow({
  thread,
  mailbox,
  selected,
  folder,
  canDelete,
  checked,
  selecting,
  onOpen,
  onToggle,
  onHover,
  onAction,
  returned,
}: {
  thread: MailThreadView
  /** Only set when several mailboxes share the list. */
  mailbox: MailAccountView | undefined
  selected: boolean
  /** The folder this list shows; null for the inbox. */
  folder: MailFolder | null
  /** Its mailbox can delete for good. */
  canDelete: boolean
  /** Part of the selection. */
  checked: boolean
  /** Something in the list is selected, so every checkbox shows. */
  selecting: boolean
  onOpen: () => void
  /** `range` extends the selection from the last one picked, as with Shift. */
  onToggle: (range: boolean) => void
  /** The pointer entered or left the row; Space then selects it. */
  onHover: (hovering: boolean) => void
  onAction: (action: MailThreadAction) => void
  /** Back from snooze, which is why it sits on top. */
  returned?: boolean
}) {
  const { t: strings, locale } = useI18n()
  const t = strings.inbox
  const row = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: "nearest" })
  }, [selected])
  const unread = !thread.isRead
  const icon = cn("size-3.5 shrink-0 text-muted-foreground", UNDER_ACTIONS)
  const actions = strings.conversation

  return (
    <li className="group relative" onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      <button
        ref={row}
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={(event) => {
          // Cmd or Ctrl adds to the selection and Shift takes a range, as in a file list.
          if (event.metaKey || event.ctrlKey || event.shiftKey) {
            event.preventDefault()
            onToggle(event.shiftKey)
          } else onOpen()
        }}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-lg py-2 pr-2.5 pl-8 text-left text-sm transition-colors outline-none select-none focus-visible:bg-accent",
          // On the whole row, so it stays while the pointer is on a quick action.
          checked ? "bg-primary/10" : selected ? "bg-accent" : "group-hover:bg-accent/60"
        )}
      >
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              unread ? "font-semibold" : "text-muted-foreground"
            )}
          >
            {unread && <span className="sr-only">{t.unread}: </span>}
            {thread.to
              ? strings.folders.to(thread.to.map((address) => address.name || address.email).join(", ") || "—")
              : (thread.fromName ?? thread.fromEmail ?? t.unknownSender)}
            {thread.messageCount > 1 && (
              <span className="font-normal text-muted-foreground">
                {" "}
                {thread.messageCount}
              </span>
            )}
          </span>
          {returned && (
            <HugeiconsIcon
              icon={AlarmClockIcon}
              strokeWidth={1.75}
              aria-label={strings.later.returned}
              className={cn(icon, "text-primary")}
            />
          )}
          {thread.isStarred && (
            <HugeiconsIcon
              icon={StarIcon}
              strokeWidth={1.75}
              aria-label={t.starred}
              className={cn(icon, STARRED)}
            />
          )}
          {thread.hasAttachments && (
            <HugeiconsIcon
              icon={Attachment01Icon}
              strokeWidth={1.75}
              aria-label={t.attachment}
              className={icon}
            />
          )}
          <time
            className={cn("shrink-0 text-xs text-muted-foreground tabular-nums", UNDER_ACTIONS)}
            dateTime={thread.receivedAt}
          >
            {shortDate(thread.receivedAt, locale)}
          </time>
        </span>
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            <span className={cn(unread && "font-medium text-foreground")}>
              {thread.subject || t.noSubject}
            </span>
            {thread.snippet && ` · ${thread.snippet}`}
          </span>
          {mailbox && (
            <AccountDot
              color={mailbox.color}
              label={mailbox.email}
              className="mr-0.5 self-center"
            />
          )}
        </span>
      </button>
      {/* The gutter shows unread mail, and a checkbox on hover or while selecting. */}
      <span className="absolute top-2.5 left-2.5 flex size-4 items-center justify-center">
        {unread && !checked && !selecting && (
          <span aria-hidden="true" className="size-1.5 rounded-full bg-primary group-focus-within:hidden group-hover:hidden" />
        )}
        <Checkbox
          checked={checked}
          aria-label={strings.selection.select(thread.subject || t.noSubject)}
          className={cn(!checked && !selecting && "hidden group-focus-within:flex group-hover:flex")}
          onClick={(event) => {
            event.preventDefault()
            onToggle(event.shiftKey)
          }}
        />
      </span>
      <RowActions
        actions={[
          thread.isStarred
            ? { icon: StarIcon, label: actions.unstar, run: () => onAction("unstar"), className: STARRED }
            : { icon: StarIcon, label: actions.star, run: () => onAction("star") },
          ...moveActions(folder, canDelete).map((action) => ({
            icon: MOVE_ICONS[action] ?? ArchiveIcon,
            label: moveLabel(action, folder, actions),
            run: () => onAction(action),
            destructive: isDestructive(action),
          })),
        ]}
      />
    </li>
  )
}

/** An invoice, receipt or payment request, laid out as a mail line: vendor and amount, then where it stands. */
function InvoiceRow({
  invoice,
  selected,
  onOpen,
  onHover,
}: {
  invoice: MailInvoiceView
  selected: boolean
  onOpen: (thread: MailThreadView) => void
  onHover: (hovering: boolean) => void
}) {
  const { t, locale } = useI18n()
  const payUrl = invoice.payUrl
  const threadId = canReport(invoice.thread?.id) ? invoice.thread?.id : undefined
  const [reporting, setReporting] = useState(false)
  return (
    <li className="group relative" onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        disabled={!invoice.thread}
        onClick={() => invoice.thread && onOpen(invoice.thread)}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-lg py-2 pr-2.5 pl-8 text-left text-sm transition-colors outline-none select-none focus-visible:bg-accent",
          selected ? "bg-accent" : "group-hover:bg-accent/60"
        )}
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{invoice.vendor ?? invoice.subject}</span>
          <span className={cn("shrink-0 text-sm tabular-nums", (payUrl || threadId) && UNDER_ACTIONS)}>
            {invoice.amountCents !== null ? formatMoney(invoice.amountCents, invoice.currency, locale) : "—"}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <InvoiceStatus invoice={invoice} />
          <span className="ml-auto shrink-0 text-xs tabular-nums">{shortDate(invoice.receivedAt, locale)}</span>
        </span>
      </button>
      <RowActions
        actions={[
          ...(payUrl
            ? [{ icon: ArrowUpRight01Icon, label: t.invoices.pay, run: () => window.open(payUrl, "_blank", "noopener,noreferrer") }]
            : []),
          ...(threadId ? [{ icon: Flag02Icon, label: t.recognition.report, run: () => setReporting(true) }] : []),
        ]}
      />
      {threadId && (
        <ReportRecognitionDialog kind="invoice" threadId={threadId} open={reporting} onOpenChange={setReporting} />
      )}
    </li>
  )
}

/** Someone who fills the inbox: who, how much and how much unread, with tidying actions on hover. */
function SenderRow({
  sender,
  selected,
  onOpen,
  onHover,
  actions,
}: {
  sender: MailSenderView
  selected: boolean
  onOpen: () => void
  onHover?: (hovering: boolean) => void
  actions: { icon: IconSvgElement; label: string; run: () => void; destructive?: boolean }[]
}) {
  const t = useI18n().t.senders
  return (
    <li className="group relative" onMouseEnter={() => onHover?.(true)} onMouseLeave={() => onHover?.(false)}>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onOpen}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-lg py-2 pr-2.5 pl-8 text-left text-sm transition-colors outline-none select-none focus-visible:bg-accent",
          selected ? "bg-accent" : "group-hover:bg-accent/60"
        )}
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{sender.name ?? sender.email}</span>
          <span className={cn("shrink-0 text-xs text-muted-foreground tabular-nums", UNDER_ACTIONS)}>
            {t.messages(sender.messages)}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <span className="min-w-0 truncate">{sender.email}</span>
          {sender.unread > 0 && <span className="shrink-0">· {t.unread(sender.unread)}</span>}
        </span>
      </button>
      <RowActions actions={actions} />
    </li>
  )
}

/** A snoozed or scheduled message, laid out as a mail line, with its moment and quick actions. */
function LaterRow({
  title,
  subject,
  when,
  failed,
  selected,
  onOpen,
  onHover,
  actions,
}: {
  title: string
  subject: string
  when: string
  failed?: boolean
  selected: boolean
  onOpen: () => void
  onHover?: (hovering: boolean) => void
  actions: { icon: IconSvgElement; label: string; run: () => void }[]
}) {
  return (
    <li className="group relative" onMouseEnter={() => onHover?.(true)} onMouseLeave={() => onHover?.(false)}>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onOpen}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-lg py-2 pr-2.5 pl-8 text-left text-sm transition-colors outline-none select-none focus-visible:bg-accent",
          selected ? "bg-accent" : "group-hover:bg-accent/60"
        )}
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
          <span
            className={cn(
              "shrink-0 text-xs tabular-nums",
              failed ? "text-destructive" : "text-muted-foreground",
              UNDER_ACTIONS
            )}
          >
            {when}
          </span>
        </span>
        <span className="min-w-0 truncate text-muted-foreground">{subject}</span>
      </button>
      <RowActions actions={actions} />
    </li>
  )
}

/** A delivery in the Parcels list, laid out as a mail line: opens its mail; tracking on hover. */
function ParcelRow({
  shipment,
  selected,
  onOpen,
  onHover,
}: {
  shipment: MailShipmentView
  selected: boolean
  onOpen: (thread: MailThreadView) => void
  onHover: (hovering: boolean) => void
}) {
  const { t, locale } = useI18n()
  const p = t.parcels
  const title = shipment.merchant ?? carrierName(shipment, p.unknownCarrier)
  const url = shipment.trackingUrl
  const threadId = canReport(shipment.thread?.id) ? shipment.thread?.id : undefined
  const [reporting, setReporting] = useState(false)
  return (
    <li className="group relative" onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        disabled={!shipment.thread}
        onClick={() => shipment.thread && onOpen(shipment.thread)}
        className={cn(
          // The same inset as mail lines, whose gutter holds the unread dot and checkbox.
          "flex w-full flex-col gap-0.5 rounded-lg py-2 pr-2.5 pl-8 text-left text-sm transition-colors outline-none select-none focus-visible:bg-accent",
          selected ? "bg-accent" : "group-hover:bg-accent/60"
        )}
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
          <time
            className={cn("shrink-0 text-xs text-muted-foreground tabular-nums", (url || threadId) && UNDER_ACTIONS)}
            dateTime={shipment.receivedAt}
          >
            {shortDate(shipment.receivedAt, locale)}
          </time>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <Status shipment={shipment} />
          {shipment.merchant && shipment.carrier && <span className="truncate">· {CARRIER_NAMES[shipment.carrier]}</span>}
        </span>
      </button>
      <RowActions
        actions={[
          ...(url
            ? [{ icon: ArrowUpRight01Icon, label: p.trackParcel, run: () => window.open(url, "_blank", "noopener,noreferrer") }]
            : []),
          ...(threadId ? [{ icon: Flag02Icon, label: t.recognition.report, run: () => setReporting(true) }] : []),
        ]}
      />
      {threadId && (
        <ReportRecognitionDialog kind="parcel" threadId={threadId} open={reporting} onOpenChange={setReporting} />
      )}
    </li>
  )
}

function DraftRow({
  draft,
  mailbox,
  selected,
  onOpen,
  onDelete,
}: {
  draft: MailDraftView
  mailbox: MailAccountView | undefined
  selected: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const { t, locale } = useI18n()
  const recipients = draft.to
    .map((address) => address.name || address.email)
    .join(", ")
  return (
    <li className="group relative">
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onOpen}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors outline-none focus-visible:bg-accent",
          // On the whole row, so it stays while the pointer is on a quick action.
          selected ? "bg-accent" : "group-hover:bg-accent/60"
        )}
      >
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              !recipients && "text-muted-foreground"
            )}
          >
            {recipients || t.drafts.noRecipients}
          </span>
          {draft.hasAttachments && (
            <HugeiconsIcon
              icon={Attachment01Icon}
              strokeWidth={1.75}
              aria-label={t.inbox.attachment}
              className={cn("size-3.5 shrink-0 text-muted-foreground", UNDER_ACTIONS)}
            />
          )}
          <time
            className={cn("shrink-0 text-xs text-muted-foreground tabular-nums", UNDER_ACTIONS)}
            dateTime={draft.updatedAt}
          >
            {shortDate(draft.updatedAt, locale)}
          </time>
        </span>
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            <span className="text-foreground">
              {draft.subject || t.inbox.noSubject}
            </span>
            {draft.snippet && ` · ${draft.snippet}`}
          </span>
          {mailbox && (
            <AccountDot
              color={mailbox.color}
              label={mailbox.email}
              className="mr-0.5 self-center"
            />
          )}
        </span>
      </button>
      <RowActions actions={[{ icon: Delete02Icon, label: t.compose.discard, run: onDelete, destructive: true }]} />
    </li>
  )
}

/** The list header while conversations are selected: what can be done to all of them. */
/** One line in the selection's ⋯ menu: compact, to sit with the small buttons beside it. */
function MenuAction({
  icon,
  label,
  destructive,
  onSelect,
}: {
  icon: IconSvgElement
  label: string
  destructive?: boolean
  onSelect: () => void
}) {
  return (
    <DropdownMenuItem
      variant={destructive ? "destructive" : "default"}
      className="min-h-7 gap-2.5 rounded-lg px-2 py-1 text-[13px]"
      onSelect={onSelect}
    >
      <HugeiconsIcon icon={icon} strokeWidth={1.75} aria-hidden="true" className="size-3.5" />
      <span className="flex-1">{label}</span>
    </DropdownMenuItem>
  )
}

/**
 * What to do with the selected conversations: the folder's two moves as
 * buttons, then clearing the selection, and the rest (read, unread, star,
 * spam, a third move) in ⋯.
 */
function SelectionBar({
  count,
  total,
  allStarred,
  allRead,
  allUnread,
  folder,
  canDelete,
  onSelectAll,
  onAction,
  onClear,
  onSnooze,
}: {
  count: number
  total: number
  allStarred: boolean
  allRead: boolean
  allUnread: boolean
  folder: MailFolder | null
  /** Every selected conversation is in a mailbox that can delete for good. */
  canDelete: boolean
  onSelectAll: () => void
  onAction: (action: MailThreadAction) => void
  onClear: () => void
  onSnooze: (until: Date) => void
}) {
  const strings = useI18n().t
  const t = strings.selection
  const [picking, setPicking] = useState(false)
  const c = strings.conversation
  const button = (icon: IconSvgElement, label: string, run: () => void, className?: string) => (
    <IconTip key={label} label={label}>
      <Button variant="ghost" size="icon-sm" aria-label={label} className={className} onClick={run}>
        <HugeiconsIcon icon={icon} strokeWidth={1.75} aria-hidden="true" />
      </Button>
    </IconTip>
  )
  const moves = moveActions(folder, canDelete)
  const shown = moves.slice(0, 2)
  const more = moves.slice(2)
  return (
    // No padding: the header's own puts this checkbox right above the rows' checkboxes.
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Checkbox
        checked={count === total ? true : "indeterminate"}
        aria-label={t.selectAll}
        onClick={(event) => {
          event.preventDefault()
          onSelectAll()
        }}
      />
      <span role="status" className="mr-auto min-w-0 truncate pl-2 text-sm font-medium">
        {t.selected(count)}
      </span>
      {shown.map((action) =>
        button(
          MOVE_ICONS[action] ?? ArchiveIcon,
          moveLabel(action, folder, c),
          () => onAction(action),
          isDestructive(action) ? "hover:text-destructive" : undefined
        )
      )}
      {button(MinusSignSquareIcon, t.clear, onClear)}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t.more}>
            <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="min-w-48 rounded-xl p-1">
          <MenuAction icon={AlarmClockIcon} label={`${strings.later.snooze}…`} onSelect={() => setPicking(true)} />
          {!allRead && <MenuAction icon={MailOpen01Icon} label={t.markRead} onSelect={() => onAction("read")} />}
          {!allUnread && <MenuAction icon={Mail01Icon} label={c.markUnread} onSelect={() => onAction("unread")} />}
          <MenuAction
            icon={StarIcon}
            label={allStarred ? c.unstar : c.star}
            onSelect={() => onAction(allStarred ? "unstar" : "star")}
          />
          {canReportSpam(folder) && (
            <MenuAction icon={SpamIcon} label={c.reportSpam} onSelect={() => onAction("spam")} />
          )}
          {more.map((action) => (
            <MenuAction
              key={action}
              icon={MOVE_ICONS[action] ?? ArchiveIcon}
              label={moveLabel(action, folder, c)}
              destructive={isDestructive(action)}
              onSelect={() => onAction(action)}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <WhenPicker open={picking} onOpenChange={setPicking} purpose="snooze" onPick={onSnooze} />
    </div>
  )
}


/** Lines while a list loads, inset like the lines that follow: drafts flush, mail and parcels past the gutter. */
function ListSkeleton({ inset = true }: { inset?: boolean }) {
  return (
    <div aria-hidden="true" className="px-2 pb-2">
      {Array.from({ length: 10 }, (_, index) => (
        <div key={index} className={cn("flex flex-col gap-2 py-3 pr-2.5", inset ? "pl-8" : "pl-2.5")}>
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
      ))}
    </div>
  )
}

/** Loads the next page when the end of the list scrolls into view. */
function LoadMore({
  onVisible,
  loading,
}: {
  onVisible: () => void
  loading: boolean
}) {
  const marker = useRef<HTMLDivElement>(null)
  const latest = useRef(onVisible)
  useEffect(() => {
    latest.current = onVisible
  })
  useEffect(() => {
    if (!marker.current || loading) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) latest.current()
    })
    observer.observe(marker.current)
    return () => observer.disconnect()
  }, [loading])
  return (
    <div ref={marker} className="flex h-12 items-center justify-center">
      {loading && <Spinner className="text-muted-foreground" />}
    </div>
  )
}

export function InboxPage({
  navigation,
  syncStatus,
  loadingAccounts,
  open,
  onOpen,
  compose,
  composeHidden,
  composeDraftId,
  drafts,
  onOpenDraft,
  onDeleteDraft,
  discardRequest,
  onComposeDraftChange,
  onHideCompose,
  onShowCompose,
  onCloseCompose,
}: {
  navigation: MailNavigation
  syncStatus: SyncStatus
  loadingAccounts: boolean
  open: MailThreadView | null
  onOpen: (thread: MailThreadView | null) => void
  compose: { key: number; draft: DraftRef | null } | null
  composeHidden: boolean
  composeDraftId: string | null
  drafts: ReturnType<typeof useDrafts>
  onOpenDraft: (draft: DraftRef) => void
  onDeleteDraft: (draft: DraftRef) => void
  /** Goes up when the open draft should be thrown away. */
  discardRequest: number
  onComposeDraftChange: (id: string | null) => void
  onHideCompose: () => void
  onShowCompose: () => void
  onCloseCompose: () => void
}) {
  const { t: strings, locale } = useI18n()
  const t = strings.inbox
  const listScroller = useScrollFade<HTMLDivElement>()
  const showDrafts = navigation.view === "drafts"
  const showParcels = navigation.view === "parcels"
  const showSnoozed = navigation.view === "snoozed"
  const showScheduled = navigation.view === "scheduled"
  const showSenders = navigation.view === "senders"
  const showInvoices = navigation.view === "invoices"
  // These lists aren't the folder's conversations: nothing to select there.
  const listOfOthers = showDrafts || showParcels || showInvoices || showSnoozed || showScheduled || showSenders
  const snoozes = useSnoozes()
  const scheduled = useScheduled()
  const unsnooze = useUnsnooze()
  const scheduledActions = useScheduledActions()
  const snoozedIds = new Set(snoozes.data?.snoozed.map((item) => item.thread.id) ?? [])
  // A list other than the inbox can show one mailbox; the inbox has the sidebar for that.
  const inMailbox = (id: string | undefined) => !navigation.accountId || id === navigation.accountId
  const shipments = useShipments(showParcels)
  const invoiceList = useInvoiceList(showInvoices)
  const [invoiceFilter, setInvoiceFilter] = useState<"all" | "due" | "paid">("all")
  const allInvoices = (invoiceList.data?.invoices ?? []).filter((invoice) => inMailbox(invoice.thread?.accountId))
  const invoiceRows = allInvoices.filter((invoice) =>
    invoiceFilter === "all" ? true : invoiceFilter === "due" ? isOpen(invoice) : !isOpen(invoice)
  )
  // What is still yours to pay, per currency, for the line above the list.
  const toPay = Object.entries(
    allInvoices
      .filter((invoice) => isOpen(invoice) && invoice.amountCents !== null)
      .reduce<Record<string, number>>((sums, invoice) => {
        const currency = invoice.currency ?? "EUR"
        sums[currency] = (sums[currency] ?? 0) + invoice.amountCents!
        return sums
      }, {})
  )
  const showDelivered = useShowDelivered()
  const allParcels = (shipments.data?.shipments ?? []).filter((shipment) => inMailbox(shipment.thread?.accountId))
  const deliveredCount = allParcels.filter((shipment) => shipment.status === "delivered").length
  // Arrived parcels stay out of the way unless the filter in the header shows them.
  const parcelRows = showDelivered ? allParcels : allParcels.filter((shipment) => shipment.status !== "delivered")
  const queryClient = useQueryClient()
  // The list already knows each card's invoice, so opening one shows it at once.
  useEffect(() => {
    for (const invoice of invoiceList.data?.invoices ?? [])
      if (invoice.thread) queryClient.setQueryData(["mail-invoice", invoice.thread.id], { invoice })
  }, [invoiceList.data, queryClient])
  // The list already knows each card's parcel, so opening one shows it at once.
  useEffect(() => {
    for (const shipment of shipments.data?.shipments ?? [])
      if (shipment.thread) queryClient.setQueryData(["mail-shipment", shipment.thread.id], { shipment })
  }, [shipments.data, queryClient])
  const draftRows = (drafts.data?.drafts ?? []).filter((draft) => inMailbox(draft.accountId))
  const snoozedRows = (snoozes.data?.snoozed ?? []).filter((item) => inMailbox(item.thread.accountId))
  const scheduledRows = (scheduled.data?.scheduled ?? []).filter((item) => inMailbox(item.accountId))
  const { accounts, accountId, onCompose, onSettings } = navigation
  const senders = useSenderList(accountId, showSenders)
  const tidy = useTidy(accountId)
  // Archive and trash ask first, from the list or the sender pane.
  const [confirming, setConfirming] = useState<{ sender: MailSenderView; action: "archive" | "trash" } | null>(null)
  const [pickedSender, setPickedSender] = useState<string | null>(null)
  const paneSender = showSenders ? senders.data?.senders.find((item) => item.email === pickedSender) : undefined
  const actOnSender = (target: MailSenderView, action: SenderAction) =>
    action === "read" ? tidy.act.mutate({ sender: target, action }) : setConfirming({ sender: target, action })
  const { mutate: runAction } = useThreadAction()
  const prefetch = usePrefetchThreads()
  const folder = isMailFolder(navigation.view) ? navigation.view : null
  // Every folder is synced, so each list is one query on our own database.
  const list = useInfiniteQuery({
    queryKey: listKey(accountId, folder),
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (accountId) params.set("account", accountId)
      if (folder) params.set("folder", folder)
      if (pageParam) params.set("cursor", pageParam)
      return api<MailThreadsPage>(`/api/mail/threads?${params}`)
    },
    getNextPageParam: (page) => page.nextCursor,
  })
  const listed = list.data?.pages.flatMap((page) => page.threads) ?? []
  // Back from snooze and not read yet: on top of the inbox, as Gmail brings them back.
  const returned =
    navigation.view === "inbox"
      ? (snoozes.data?.returned ?? [])
          .map((item) => item.thread)
          .filter((thread) => !accountId || thread.accountId === accountId)
      : []
  const returnedIds = new Set(returned.map((thread) => thread.id))
  const rows = returned.length ? [...returned, ...listed.filter((thread) => !returnedIds.has(thread.id))] : listed
  const position = open ? rows.findIndex((thread) => thread.id === open.id) : -1
  // The neighbours of the open conversation are where J, K and archive go next.
  const before = position > 0 ? rows[position - 1]?.id : undefined
  const after = position >= 0 ? rows[position + 1]?.id : undefined
  useEffect(() => {
    if (after) prefetch.now(after)
    if (before) prefetch.now(before)
  }, [before, after, prefetch])
  const selectedAccount = accounts.find((account) => account.id === accountId)
  const accountOf = new Map(accounts.map((account) => [account.id, account]))

  useEffect(() => onOpen(null), [accountId, onOpen])

  // Selection: ids of conversations in this list, plus where a Shift range starts.
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const anchor = useRef<string | null>(null)
  const hovered = useRef<string | null>(null)
  useEffect(() => {
    setPicked(new Set())
    anchor.current = null
  }, [navigation.view, accountId])
  const selection = listOfOthers ? [] : rows.filter((thread) => picked.has(thread.id))
  const selecting = selection.length > 0

  function toggle(id: string, range: boolean) {
    setPicked((current) => {
      const next = new Set(current)
      const from = anchor.current ? rows.findIndex((thread) => thread.id === anchor.current) : -1
      const to = rows.findIndex((thread) => thread.id === id)
      if (range && from >= 0 && to >= 0) {
        const [low, high] = from < to ? [from, to] : [to, from]
        for (const thread of rows.slice(low, high + 1)) next.add(thread.id)
      } else if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    anchor.current = id
  }

  function clearSelection() {
    setPicked(new Set())
    anchor.current = null
  }

  function bulk(action: MailThreadAction, until?: Date) {
    const ids = selection.map((thread) => thread.id)
    if (open && ids.includes(open.id) && (until || leavesList(folder, action))) onOpen(null)
    runAction({ ids, action, ...(until && { until: until.toISOString() }) })
    clearSelection()
  }

  // Cmd/Ctrl+A selects the list, unless focus is in a field or a dialog is open.
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "a" || listOfOthers) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest("input,textarea,select,[contenteditable]")) return
      if (document.querySelector("[role=dialog],[role=alertdialog],[role=menu],[role=listbox]")) return
      event.preventDefault()
      setPicked(new Set(rows.map((thread) => thread.id)))
    }
    document.addEventListener("keydown", keydown)
    return () => document.removeEventListener("keydown", keydown)
  })
  const composing = compose !== null
  const composerVisible = composing && !composeHidden
  const showingDetail = Boolean(open) || composerVisible || Boolean(paneSender)

  function step(by: number) {
    if (listOfOthers) return
    const next = rows[Math.max(0, position + by)]
    if (next) onOpen(next)
  }

  /** `until` snoozes: it leaves like an archived conversation and comes back then. */
  function leave(thread: MailThreadView, action: MailThreadAction, until?: Date) {
    const run = () => runAction({ id: thread.id, action, ...(until && { until: until.toISOString() }) })
    // A star or a read mark keeps the conversation where it is.
    if (!until && action !== "unread" && !leavesList(folder, action)) return run()
    // Opened from search and not in this list: there's no next one to move to.
    if (position < 0) {
      onOpen(null)
      return run()
    }
    // Marking unread means "not now", so the next mail shouldn't open by itself.
    onOpen(
      action === "unread"
        ? null
        : (rows[position + 1] ?? rows[position - 1] ?? null)
    )
    run()
  }

  useHotkeys({
    j: () => step(1),
    k: () => step(-1),
    c: onCompose,
    "/": navigation.onSearch,
    x: () => {
      if (open && !listOfOthers) toggle(open.id, false)
    },
    // Space selects the row under the pointer, or the open one; Shift takes a range.
    " ": (event) => {
      const id = hovered.current ?? open?.id
      if (id && !listOfOthers && rows.some((thread) => thread.id === id)) toggle(id, event.shiftKey)
    },
    // Clearing a selection comes before closing the conversation.
    Escape: () => (selecting ? clearSelection() : onOpen(null)),
  })

  return (
    <>
      <section
        className={cn(
          "min-h-0 w-full shrink-0 flex-col md:w-80 xl:w-96",
          showingDetail ? "hidden md:flex" : "flex"
        )}
      >
        <header
          className={cn(
            "flex h-14 shrink-0 items-center gap-1.5 pr-2 pl-2",
            // The title lines up with the senders; the select-all box with the rows' boxes.
            selecting ? "lg:pl-4.5" : "lg:pl-10"
          )}
        >
          <MailMenu {...navigation} />
          {selecting ? (
            <SelectionBar
              count={selection.length}
              total={rows.length}
              allStarred={selection.every((thread) => thread.isStarred)}
              allRead={selection.every((thread) => thread.isRead)}
              allUnread={selection.every((thread) => !thread.isRead)}
              folder={folder}
              canDelete={selection.every((thread) => canDeleteForever(accountOf.get(thread.accountId)?.provider ?? "gmail"))}
              onSelectAll={() =>
                selection.length === rows.length ? clearSelection() : setPicked(new Set(rows.map((thread) => thread.id)))
              }
              onAction={bulk}
              onClear={clearSelection}
              onSnooze={(until) => bulk("archive", until)}
            />
          ) : (
            <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
              {showDrafts
                ? strings.drafts.title
                : showParcels
                  ? strings.parcels.title
                  : showInvoices
                    ? strings.invoices.title
                  : showSnoozed
                    ? strings.later.snoozedTitle
                    : showScheduled
                      ? strings.later.scheduledTitle
                      : showSenders
                        ? strings.senders.title
                        : folder
                  ? strings.folders[folder]
                  : (selectedAccount?.email ?? t.title)}
            </h1>
          )}
          <span
            role="status"
            className="flex items-center text-muted-foreground"
          >
            {syncStatus === "syncing" && (
              <IconTip label={t.syncing}>
                <span className="flex">
                  <Spinner />
                  <span className="sr-only">{t.syncing}</span>
                </span>
              </IconTip>
            )}
            {syncStatus === "failed" && (
              <IconTip label={t.syncFailed}>
                <span className="flex">
                  <HugeiconsIcon
                    icon={CloudAlertIcon}
                    strokeWidth={1.75}
                    aria-hidden="true"
                    className="size-4"
                  />
                  <span className="sr-only">{t.syncFailed}</span>
                </span>
              </IconTip>
            )}
          </span>
          {!selecting && navigation.view !== "inbox" && accounts.length > 1 && (
            <MailboxFilter accounts={accounts} accountId={accountId} onChange={navigation.onFilterAccount} />
          )}
          {folder === "trash" && <EmptyTrashButton accounts={accounts} />}
          {showParcels && (
            <IconTip label={showDelivered ? strings.parcels.hideDelivered : strings.parcels.showDelivered}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={strings.parcels.showDelivered}
                aria-pressed={showDelivered}
                className={cn(showDelivered && "bg-accent text-foreground")}
                onClick={() => setShowDelivered(!showDelivered)}
              >
                <HugeiconsIcon icon={PackageDeliveredIcon} strokeWidth={1.75} aria-hidden="true" />
              </Button>
            </IconTip>
          )}
          <IconTip label={strings.spotlight.search} shortcut="⌘K">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={strings.spotlight.search}
              aria-keyshortcuts="Meta+K Control+K /"
              onClick={navigation.onSearch}
            >
              <HugeiconsIcon icon={Search01Icon} strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </IconTip>
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label={t.compose}
            onClick={onCompose}
          >
            <HugeiconsIcon
              icon={PencilEdit02Icon}
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </Button>
        </header>

        {/* Relative keeps absolute children, like screen-reader text, inside this scroller.
            It scrolls by wheel, touch and keys, without showing a bar. */}
        {showInvoices && (
          // Stays put while the list scrolls under it; lined up with the rows' text.
          <div className="shrink-0 pr-4 pb-2 pl-10">
            <div className="invoice-filter" role="tablist" aria-label={strings.invoices.title}>
              {(["all", "due", "paid"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={invoiceFilter === key}
                  onClick={() => setInvoiceFilter(key)}
                >
                  {key === "all" ? strings.invoices.filterAll : key === "due" ? strings.invoices.filterDue : strings.invoices.filterPaid}
                  {key === "due" && toPay.length > 0 && (
                    <span className="invoice-filter-sum">
                      {toPay.map(([currency, cents]) => formatMoney(cents, currency, locale, true)).join(" + ")}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
        <div
          ref={listScroller}
          className="scroll-fade relative min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {showInvoices ? (
            <>
              {invoiceList.isPending && <ListSkeleton />}
              {invoiceList.isError && <p className="p-4 pl-8 text-sm text-destructive">{strings.invoices.loadFailed}</p>}
              {invoiceList.isSuccess && invoiceRows.length === 0 && (
                <p className="p-4 pl-8 text-sm text-muted-foreground">
                  {!invoiceList.data?.complete
                    ? strings.invoices.stillReading
                    : allInvoices.length === 0
                      ? strings.invoices.empty
                      : strings.invoices.nothingHere}
                </p>
              )}
              <ul className="flex flex-col gap-0.5 px-2 pb-2">
                {invoiceRows.map((invoice, index) => (
                  <InvoiceRow
                    key={invoice.thread?.id ?? index}
                    invoice={invoice}
                    selected={!!open && invoice.thread?.id === open.id}
                    onOpen={onOpen}
                    onHover={(hovering) => prefetch.onHover(hovering && invoice.thread ? invoice.thread.id : null)}
                  />
                ))}
              </ul>
              {invoiceList.data && !invoiceList.data.complete && invoiceRows.length > 0 && (
                <p className="px-4 pb-3 pl-10 text-xs text-muted-foreground">{strings.invoices.stillReading}</p>
              )}
            </>
          ) : showSenders ? (
            <>
              {senders.isPending && <ListSkeleton />}
              {senders.isError && <p className="p-4 pl-8 text-sm text-destructive">{strings.senders.loadFailed}</p>}
              {senders.isSuccess && senders.data.senders.length === 0 && (
                <p className="p-4 pl-8 text-sm text-muted-foreground">{strings.senders.empty}</p>
              )}
              <ul className="flex flex-col gap-0.5 px-2 pb-2">
                {senders.data?.senders.map((sender) => (
                  <SenderRow
                    key={sender.email}
                    sender={sender}
                    selected={!open && sender.email === pickedSender}
                    onOpen={() => {
                      // A sender opens their pane, not a mail; their mail opens from there.
                      onOpen(null)
                      setPickedSender(sender.email)
                    }}
                    actions={[
                      { icon: FilterMailRemoveIcon, label: strings.senders.unsubscribe, run: () => tidy.unsubscribe.mutate(sender) },
                      ...(sender.unread > 0
                        ? [{ icon: MailOpen01Icon, label: strings.senders.readAll, run: () => actOnSender(sender, "read") }]
                        : []),
                      { icon: ArchiveIcon, label: strings.senders.archiveAll, run: () => actOnSender(sender, "archive") },
                      { icon: Delete02Icon, label: strings.senders.trashAll, run: () => actOnSender(sender, "trash"), destructive: true },
                    ]}
                  />
                ))}
              </ul>
              <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {confirming &&
                        (confirming.action === "trash" ? strings.senders.confirmTrash : strings.senders.confirmArchive)(
                          confirming.sender.conversations,
                          nameOf(confirming.sender)
                        )}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {confirming?.action === "trash"
                        ? strings.senders.confirmTrashBody
                        : strings.senders.confirmArchiveBody}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{strings.senders.cancel}</AlertDialogCancel>
                    <AlertDialogAction
                      variant={confirming?.action === "trash" ? "destructive" : "default"}
                      onClick={() => {
                        if (confirming) tidy.act.mutate(confirming)
                        setConfirming(null)
                      }}
                    >
                      {confirming?.action === "trash" ? strings.senders.trashAll : strings.senders.archiveAll}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : showSnoozed ? (
            <>
              {snoozes.isPending && <ListSkeleton />}
              {snoozes.isSuccess && snoozedRows.length === 0 && (
                <p className="p-4 pl-8 text-sm text-muted-foreground">{strings.later.snoozedEmpty}</p>
              )}
              <ul className="flex flex-col gap-0.5 px-2 pb-2">
                {snoozedRows.map((item) => (
                  <LaterRow
                    key={item.thread.id}
                    title={item.thread.fromName ?? item.thread.fromEmail ?? t.unknownSender}
                    subject={item.thread.subject || t.noSubject}
                    when={strings.later.backAt(formatMoment(new Date(item.until), locale))}
                    selected={item.thread.id === open?.id}
                    onOpen={() => onOpen(item.thread)}
                    onHover={(hovering) => prefetch.onHover(hovering ? item.thread.id : null)}
                    actions={[
                      {
                        icon: InboxIcon,
                        label: strings.later.unsnooze,
                        run: () => {
                          if (open?.id === item.thread.id) onOpen(null)
                          unsnooze.mutate(item.thread.id)
                        },
                      },
                    ]}
                  />
                ))}
              </ul>
            </>
          ) : showScheduled ? (
            <>
              {scheduled.isPending && <ListSkeleton />}
              {scheduled.isSuccess && scheduledRows.length === 0 && (
                <p className="p-4 pl-8 text-sm text-muted-foreground">{strings.later.scheduledEmpty}</p>
              )}
              <ul className="flex flex-col gap-0.5 px-2 pb-2">
                {scheduledRows.map((item) => {
                  // Opening it is changing it: it goes back to the drafts, as in Gmail.
                  const edit = () =>
                    scheduledActions.cancel.mutate(item.id, {
                      onSuccess: (draft) => {
                        toast.success(strings.later.canceled)
                        onOpenDraft({ accountId: draft.accountId, id: draft.draftId })
                      },
                    })
                  return (
                    <LaterRow
                      key={item.id}
                      title={strings.folders.to(item.to.map((address) => address.name || address.email).join(", ") || "—")}
                      subject={item.subject || t.noSubject}
                      when={item.failed ? strings.later.failed : formatMoment(new Date(item.sendAt), locale)}
                      failed={item.failed}
                      selected={false}
                      onOpen={edit}
                      actions={[
                        { icon: SentIcon, label: strings.later.sendNow, run: () => scheduledActions.sendNow.mutate(item.id) },
                        { icon: PencilEdit02Icon, label: strings.later.cancel, run: edit },
                      ]}
                    />
                  )
                })}
              </ul>
            </>
          ) : showParcels ? (
            <>
              {shipments.isPending && <ListSkeleton />}
              {shipments.isError && <p className="p-4 text-sm text-destructive">{strings.parcels.loadFailed}</p>}
              {shipments.isSuccess && parcelRows.length === 0 && (
                // Only delivered ones, hidden: say so, with the way to see them right here.
                <div className="flex flex-col items-start gap-3 p-4 pl-8 text-sm text-muted-foreground">
                  <p>
                    {!shipments.data?.complete
                      ? strings.parcels.stillReading
                      : deliveredCount > 0
                        ? strings.parcels.nothingOnTheWay
                        : strings.parcels.empty}
                  </p>
                  {deliveredCount > 0 && (
                    <Button variant="outline" size="sm" onClick={() => setShowDelivered(true)}>
                      {strings.parcels.showDeliveredCount(deliveredCount)}
                    </Button>
                  )}
                </div>
              )}
              <ul className="flex flex-col gap-0.5 px-2 pb-2">
                {parcelRows.map((shipment, index) => (
                  <ParcelRow
                    key={`${shipment.trackingCode ?? shipment.thread?.id ?? index}`}
                    shipment={shipment}
                    selected={!!open && shipment.thread?.id === open.id}
                    onOpen={onOpen}
                    onHover={(hovering) => prefetch.onHover(hovering && shipment.thread ? shipment.thread.id : null)}
                  />
                ))}
              </ul>
              {shipments.data && !shipments.data?.complete && parcelRows.length > 0 && (
                <p className="px-4 pb-3 text-xs text-muted-foreground">{strings.parcels.stillReading}</p>
              )}
            </>
          ) : showDrafts ? (
            <>
              {drafts.isPending && <ListSkeleton inset={false} />}
              {drafts.isError && (
                <p className="p-4 text-sm text-destructive">
                  {strings.drafts.loadFailed}
                </p>
              )}
              {!!drafts.data?.failedAccounts.length && (
                <p className="px-4 pb-2 text-xs text-muted-foreground">
                  {strings.drafts.someFailed}
                </p>
              )}
              {drafts.isSuccess && draftRows.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  {strings.drafts.empty}
                </p>
              )}
              <ul className="flex flex-col gap-0.5 px-2 pb-2">
                {draftRows.map((draft) => (
                  <DraftRow
                    key={`${draft.accountId}:${draft.id}`}
                    draft={draft}
                    mailbox={
                      accounts.length > 1
                        ? accountOf.get(draft.accountId)
                        : undefined
                    }
                    selected={composerVisible && draft.id === composeDraftId}
                    onOpen={() =>
                      onOpenDraft({ accountId: draft.accountId, id: draft.id })
                    }
                    onDelete={() =>
                      onDeleteDraft({ accountId: draft.accountId, id: draft.id })
                    }
                  />
                ))}
              </ul>
            </>
          ) : (
            <>
              {(list.isPending || loadingAccounts) && <ListSkeleton />}
              {!loadingAccounts && accounts.length === 0 ? (
                <Empty className="h-full">
                  <EmptyHeader>
                    <EmptyTitle>{t.noMailboxes}</EmptyTitle>
                    <EmptyDescription>{t.noMailboxesBody}</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button onClick={onSettings}>{t.connect}</Button>
                  </EmptyContent>
                </Empty>
              ) : (
                <>
                  {list.isError && (
                    <p className="p-4 text-sm text-destructive">
                      {folder ? strings.folders.loadFailed : t.loadFailed}
                    </p>
                  )}
                  {list.isSuccess &&
                    !loadingAccounts &&
                    rows.length === 0 && (
                      <p className="p-4 text-sm text-muted-foreground">
                        {folder
                          ? strings.folders.empty
                          : syncStatus === "syncing"
                            ? t.firstSync
                            : t.empty}
                      </p>
                    )}
                  <ul className="flex flex-col gap-0.5 px-2 pb-2">
                    {rows.map((thread) => (
                      <ThreadRow
                        key={thread.id}
                        thread={thread}
                        mailbox={
                          !accountId && accounts.length > 1
                            ? accountOf.get(thread.accountId)
                            : undefined
                        }
                        selected={thread.id === open?.id}
                        folder={folder}
                        canDelete={canDeleteForever(accountOf.get(thread.accountId)?.provider ?? "gmail")}
                        checked={picked.has(thread.id)}
                        selecting={selecting}
                        returned={returnedIds.has(thread.id)}
                        onToggle={(range) => toggle(thread.id, range)}
                        onHover={(hovering) => {
                          if (hovering) hovered.current = thread.id
                          else if (hovered.current === thread.id) hovered.current = null
                          prefetch.onHover(hovering ? thread.id : null)
                        }}
                        onOpen={() => onOpen(thread)}
                        onAction={(action) =>
                          thread.id === open?.id
                            ? leave(thread, action)
                            : runAction({ id: thread.id, action })
                        }
                      />
                    ))}
                  </ul>
                  {list.hasNextPage && (
                    <LoadMore
                      loading={list.isFetchingNextPage}
                      onVisible={() => void list.fetchNextPage()}
                    />
                  )}
                </>
              )}
            </>
          )}
        </div>
      </section>

      <section
        className={cn(
          "floating-panel min-h-0 min-w-0 flex-1 flex-col overflow-hidden max-md:rounded-none! max-md:shadow-none! md:m-2",
          showingDetail ? "flex" : "hidden md:flex"
        )}
      >
        {compose && (
          <ComposePage
            key={compose.key}
            accounts={accounts}
            defaultAccountId={accountId}
            draft={compose.draft}
            hidden={Boolean(open) || composeHidden}
            onHide={onHideCompose}
            onShow={onShowCompose}
            onClose={onCloseCompose}
            onDraftChange={onComposeDraftChange}
            discardRequest={discardRequest}
          />
        )}
        {open ? (
          <ConversationPage
            key={open.id}
            thread={open}
            account={accountOf.get(open.accountId)}
            onBack={() => onOpen(null)}
            folder={folder}
            onLeave={(action) => leave(open, action)}
            onSnooze={(until) => leave(open, "archive", until)}
            snoozed={snoozedIds.has(open.id)}
            onUnsnooze={() => {
              unsnooze.mutate(open.id)
              onOpen(null)
            }}
          />
        ) : paneSender ? (
          <SenderPane
            key={paneSender.email}
            sender={paneSender}
            accountId={accountId}
            onBack={() => setPickedSender(null)}
            onOpenThread={onOpen}
            onUnsubscribe={() => tidy.unsubscribe.mutate(paneSender)}
            onAct={(action) => actOnSender(paneSender, action)}
          />
        ) : showSenders && !composerVisible ? (
          <p className="m-auto max-w-xs px-6 text-center text-sm text-muted-foreground">{strings.senders.pickOne}</p>
        ) : (
          !composerVisible && <EmptyPane />
        )}
      </section>
    </>
  )
}
