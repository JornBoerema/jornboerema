import { useLaterCounts } from "@/lib/later"
import { useInvoices, useParcels, useSenders, useSidebarLayout } from "@/lib/preferences"
import type { NavItem, SidebarLayout } from "@evido/mail-core/sidebar"
import { useInDesktop } from "@evido/ui/components/app-switcher"
import { DesktopDownloadItem } from "@evido/ui/components/desktop-download"
import { useState, type ReactNode } from "react"
import {
  Add01Icon,
  Alert02Icon,
  ArrowRight01Icon,
  ArchiveIcon,
  Delete02Icon,
  SentIcon,
  SpamIcon,
  StarIcon,
  File01Icon,
  InboxIcon,
  KeyboardIcon,
  Mail01Icon,
  Logout01Icon,
  Menu01Icon,
  PencilEdit02Icon,
  Settings01Icon,
  // Hugeicons names these by the panel's state: Close points right (expand), Open points left (collapse).
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  UnfoldMoreIcon,
  PackageIcon,
  AlarmClockIcon,
  MailSend01Icon,
  CleanIcon,
  Invoice02Icon,
  DragDropVerticalIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@evido/ui/components/dropdown-menu"
import { useCollapsibleSidebar } from "@evido/ui/hooks/use-collapsible-sidebar"
import { cn } from "@evido/ui/lib/utils"
import type { MailAccountView, MailFolder } from "@evido/mail-core/types"
import { AccountDot } from "@/components/account-dot"
import { Brand } from "@/components/brand"
import { useI18n } from "@/i18n"
import { signOut } from "@/lib/auth-client"
import { useUnread } from "@/lib/mail"
import { IconTip } from "@/components/icon-tip"
import { SidebarEditor } from "@/components/sidebar-editor"

export type MailView = "inbox" | "drafts" | "parcels" | "invoices" | "snoozed" | "scheduled" | "senders" | MailFolder

export const FOLDER_ICONS: Record<MailFolder, IconSvgElement> = {
  starred: StarIcon,
  sent: SentIcon,
  archive: ArchiveIcon,
  spam: SpamIcon,
  trash: Delete02Icon,
}

export type MailNavigation = {
  accounts: MailAccountView[]
  /** Empty means every mailbox. */
  accountId: string
  user: { name: string; email: string }
  sidebar: ReturnType<typeof useCollapsibleSidebar>
  view: MailView
  draftCount: number
  /** A started message is out of view, ready to pick up again. */
  draftWaiting: boolean
  /** The composer fills the reading pane; New message is then the current place. */
  composing: boolean
  onSelectAccount: (id: string) => void
  /** The sidebar itself is being arranged, with Save and Cancel at the bottom. */
  editingSidebar: boolean
  /** Starts arranging the sidebar in place. */
  onCustomizeSidebar: () => void
  onDoneEditingSidebar: () => void
  /** One mailbox for the list in view, or every one, without leaving it. */
  onFilterAccount: (id: string) => void
  onSelectDrafts: () => void
  onSelectParcels: () => void
  onSelectInvoices: () => void
  onSelectSnoozed: () => void
  onSelectScheduled: () => void
  onSelectSenders: () => void
  onSelectFolder: (folder: MailFolder) => void
  onCompose: () => void
  onSettings: () => void
  onSearch: () => void
  onShortcuts: () => void
}

const NAV_ICON = "size-4 shrink-0"

const MORE_KEY = "evido.mail.sidebar.more"

function readMoreOpen() {
  try {
    return localStorage.getItem(MORE_KEY) === "open"
  } catch {
    return false
  }
}

/** Each place's icon, here and where the sidebar is arranged. */
export const PLACE_ICONS: Record<NavItem, IconSvgElement> = {
  inbox: InboxIcon,
  starred: StarIcon,
  parcels: PackageIcon,
  invoices: Invoice02Icon,
  snoozed: AlarmClockIcon,
  drafts: File01Icon,
  scheduled: MailSend01Icon,
  sent: SentIcon,
  senders: CleanIcon,
  archive: ArchiveIcon,
  spam: SpamIcon,
  trash: Delete02Icon,
}

/** Each place's name. */
export function usePlaceLabels(): Record<NavItem, string> {
  const t = useI18n().t
  return {
    inbox: t.inbox.allMailboxes,
    starred: t.folders.starred,
    parcels: t.parcels.title,
    invoices: t.invoices.title,
    snoozed: t.later.snoozedTitle,
    drafts: t.drafts.title,
    scheduled: t.later.scheduledTitle,
    sent: t.folders.sent,
    senders: t.senders.title,
    archive: t.folders.archive,
    spam: t.folders.spam,
    trash: t.folders.trash,
  }
}

/** One place in the sidebar, however it is drawn: a link, a rail icon, a menu choice. */
type Place = {
  icon: IconSvgElement
  label: string
  selected: boolean
  onSelect: () => void
  /** A number beside it, with how a screen reader says it. */
  count?: { value: string; label?: string }
  /** A dot on the rail icon, for unread mail. */
  badge?: boolean
  /** Turned off as a feature, or empty where empty means nothing to show. */
  shown: boolean
}

/** Every place the sidebar can show, by its id in the layout. */
function usePlaces(
  nav: Pick<
    MailNavigation,
    | "accountId"
    | "view"
    | "draftCount"
    | "composing"
    | "onSelectAccount"
    | "onSelectDrafts"
    | "onSelectParcels"
    | "onSelectInvoices"
    | "onSelectSnoozed"
    | "onSelectScheduled"
    | "onSelectSenders"
    | "onSelectFolder"
  >
): Record<NavItem, Place> {
  const { t, locale } = useI18n()
  const parcels = useParcels()
  const invoices = useInvoices()
  const tidy = useSenders()
  const { snoozedCount, scheduledCount } = useLaterCounts()
  const unread = useUnread(true).data?.count
  const shownView: MailView | null = nav.composing ? null : nav.view
  const folder = (id: MailFolder): Place => ({
    icon: FOLDER_ICONS[id],
    label: t.folders[id],
    selected: shownView === id,
    onSelect: () => nav.onSelectFolder(id),
    shown: true,
  })
  return {
    inbox: {
      icon: InboxIcon,
      label: t.inbox.allMailboxes,
      selected: shownView === "inbox" && nav.accountId === "",
      onSelect: () => nav.onSelectAccount(""),
      count: unread ? { value: unread.toLocaleString(locale), label: t.emptyPane.unread(String(unread)) } : undefined,
      badge: !!unread,
      shown: true,
    },
    starred: folder("starred"),
    parcels: {
      icon: PackageIcon,
      label: t.parcels.title,
      selected: shownView === "parcels",
      onSelect: nav.onSelectParcels,
      shown: parcels,
    },
    invoices: {
      icon: Invoice02Icon,
      label: t.invoices.title,
      selected: shownView === "invoices",
      onSelect: nav.onSelectInvoices,
      shown: invoices,
    },
    // Snoozed and Scheduled only when there is something in them, or they are open.
    snoozed: {
      icon: AlarmClockIcon,
      label: t.later.snoozedTitle,
      selected: shownView === "snoozed",
      onSelect: nav.onSelectSnoozed,
      count: { value: String(snoozedCount) },
      shown: snoozedCount > 0 || shownView === "snoozed",
    },
    drafts: {
      icon: File01Icon,
      label: t.drafts.title,
      selected: shownView === "drafts",
      onSelect: nav.onSelectDrafts,
      count: nav.draftCount > 0 ? { value: String(nav.draftCount), label: t.drafts.count(nav.draftCount) } : undefined,
      shown: true,
    },
    scheduled: {
      icon: MailSend01Icon,
      label: t.later.scheduledTitle,
      selected: shownView === "scheduled",
      onSelect: nav.onSelectScheduled,
      count: { value: String(scheduledCount) },
      shown: scheduledCount > 0 || shownView === "scheduled",
    },
    sent: folder("sent"),
    senders: {
      icon: CleanIcon,
      label: t.senders.title,
      selected: shownView === "senders",
      onSelect: nav.onSelectSenders,
      shown: tidy,
    },
    archive: folder("archive"),
    spam: folder("spam"),
    trash: folder("trash"),
  }
}

function PlaceLink({ place }: { place: Place }) {
  return (
    <button
      type="button"
      className={cn("list-link", place.selected && "is-selected")}
      aria-current={place.selected ? "page" : undefined}
      onClick={place.onSelect}
    >
      <HugeiconsIcon icon={place.icon} strokeWidth={2} className={NAV_ICON} aria-hidden="true" />
      <span>{place.label}</span>
      {place.count && (
        <span className="list-count" aria-label={place.count.label}>
          {place.count.value}
        </span>
      )}
    </button>
  )
}

/** The places tucked under More, out of the way until asked for, and the way to arrange them all. */
function MorePlaces({ places, onCustomize }: { places: Place[]; onCustomize: () => void }) {
  const t = useI18n().t.shell
  const [chosen, setChosen] = useState(readMoreOpen)
  // Being in one of them keeps the group open, so the current place stays in sight.
  const open = chosen || places.some((place) => place.selected)
  const toggle = () => {
    const next = !open
    setChosen(next)
    try {
      if (next) localStorage.setItem(MORE_KEY, "open")
      else localStorage.removeItem(MORE_KEY)
    } catch {
      // Not kept then; the group just starts closed next time.
    }
  }
  return (
    <>
      <button type="button" className="list-link is-ghost is-small" aria-expanded={open} onClick={toggle}>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          className={cn("shrink-0 transition-transform", open && "rotate-90")}
          aria-hidden="true"
        />
        <span>{t.more}</span>
      </button>
      {/* Unfolds by growing its row from nothing, and folds back the same way.
          The negative margin cancels the column gap while it is folded. */}
      <div
        inert={!open}
        className={cn(
          "-mt-0.5 grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-0.5 pt-0.5">
            {places.map((place) => (
              <PlaceLink key={place.label} place={place} />
            ))}
            <button type="button" className="list-link is-ghost" onClick={onCustomize}>
              <HugeiconsIcon icon={DragDropVerticalIcon} strokeWidth={2} className={NAV_ICON} aria-hidden="true" />
              <span>{t.customizeSidebar}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

/** The shared Evido sidebar. Smaller screens get MailMenu instead. */
export function Sidebar({
  accounts,
  accountId,
  user,
  sidebar,
  view,
  draftCount,
  draftWaiting,
  composing,
  onSelectAccount,
  onSelectDrafts,
  onSelectParcels,
  onSelectInvoices,
  onSelectSnoozed,
  onSelectScheduled,
  onSelectSenders,
  onSelectFolder,
  onCompose,
  onSettings,
  onShortcuts,
  onCustomizeSidebar,
  editingSidebar,
  onDoneEditingSidebar,
}: MailNavigation) {
  const { t } = useI18n()
  const desktop = useInDesktop()
  const layout = useSidebarLayout()
  const placeLabels = usePlaceLabels()
  // While writing, only New message is current; closing it gives the selection back.
  const places = usePlaces({
    accountId,
    view,
    draftCount,
    composing,
    onSelectAccount,
    onSelectDrafts,
    onSelectParcels,
    onSelectInvoices,
    onSelectSnoozed,
    onSelectScheduled,
    onSelectSenders,
    onSelectFolder,
  })
  return (
    // One panel for both: its width animates, and the full sidebar and the rail fade into each other.
    <aside
      id="list-sidebar"
      className={cn(
        "list-sidebar mail-sidebar max-lg:hidden!",
        sidebar.collapsed && "is-collapsed",
        // Above the veil the editor puts over the rest.
        editingSidebar && "z-50"
      )}
      aria-label={t.shell.sidebar}
    >
      <div className="sidebar-full" inert={sidebar.collapsed}>
        <div className="sidebar-brand-row">
          <Brand />
          {/* The desktop app keeps the sidebar open. */}
          {!desktop && (
            <IconTip label={t.shell.collapse} shortcut="⌘B">
              <Button
                variant="ghost"
                size="icon-sm"
                className="mail-collapse"
                aria-label={t.shell.collapse}
                aria-keyshortcuts="Meta+B Control+B"
                aria-expanded={true}
                aria-controls="list-sidebar"
                onClick={sidebar.toggle}
              >
                <HugeiconsIcon icon={PanelLeftOpenIcon} strokeWidth={2} aria-hidden="true" />
              </Button>
            </IconTip>
          )}
        </div>
        <div className="list-navigation sidebar-sections">
          <div className="sidebar-top">
            {/* Apart from the folders: writing is an action, not a place. */}
            <button
              type="button"
              className={cn("list-link mb-3", composing && "is-selected")}
              aria-current={composing ? "page" : undefined}
              aria-keyshortcuts="C"
              onClick={onCompose}
            >
              <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} className={NAV_ICON} aria-hidden="true" />
              <span>{draftWaiting ? t.inbox.resumeDraft : t.inbox.compose}</span>
              <kbd className="nav-kbd">C</kbd>
            </button>
            {editingSidebar ? (
              <SidebarEditor icons={PLACE_ICONS} labels={placeLabels} onDone={onDoneEditingSidebar} />
            ) : (
              <>
                {layout.main.map((id) => places[id].shown && <PlaceLink key={id} place={places[id]} />)}
                <MorePlaces
                  places={layout.more.map((id) => places[id]).filter((place) => place.shown)}
                  onCustomize={onCustomizeSidebar}
                />
              </>
            )}
          </div>
          <section className="sidebar-list-section" aria-labelledby="sidebar-mailboxes">
            <div className="sidebar-heading">
              <h2 id="sidebar-mailboxes">{t.shell.mailboxes}</h2>
              <Button
                variant="ghost"
                size="icon-sm"
                className="sidebar-add"
                aria-label={t.inbox.connect}
                onClick={onSettings}
              >
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden="true" />
              </Button>
            </div>
            <nav aria-label={t.shell.mailboxes} className="sidebar-section-links">
              {accounts.map((account) => {
                const selected = !composing && view === "inbox" && account.id === accountId
                const active = account.status === "active"
                return (
                  <button
                    key={account.id}
                    type="button"
                    className={cn("list-link", selected && "is-selected")}
                    aria-current={selected ? "page" : undefined}
                    title={active ? account.email : t.inbox.reconnectNeeded}
                    onClick={() => onSelectAccount(account.id)}
                  >
                    {active ? (
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        <AccountDot color={account.color} className="size-2.5" />
                      </span>
                    ) : (
                      <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className={NAV_ICON} aria-hidden="true" />
                    )}
                    <span className="truncate">{account.email}</span>
                  </button>
                )
              })}
            </nav>
          </section>
        </div>
        {/* In the desktop app the rail's settings button opens settings; signing out is on their account page. */}
        {!desktop && (
          <div className="sidebar-footer">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="workspace-switcher" aria-label={t.shell.account(user.email)}>
                  <span className="workspace-avatar" aria-hidden="true">
                    {initialOf(user)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col text-left">
                    <span className="truncate">{user.name || user.email}</span>
                    <span className="truncate text-xs font-normal text-muted-foreground">{user.email}</span>
                  </span>
                  <HugeiconsIcon
                    icon={UnfoldMoreIcon}
                    strokeWidth={2}
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </button>
              </DropdownMenuTrigger>
              <AccountMenuContent onSettings={onSettings} onShortcuts={onShortcuts} />
            </DropdownMenu>
          </div>
        )}
      </div>
      <SidebarRail
        {...{ accounts, accountId, user, sidebar, view, draftWaiting, composing }}
        {...{ onSelectAccount, onCompose, onSettings, onShortcuts }}
        places={places}
        layout={layout}
      />
    </aside>
  )
}

const initialOf = (user: { name: string; email: string }) => (user.name || user.email).trim().charAt(0).toUpperCase()

function AccountMenuContent({
  onSettings,
  onShortcuts,
  side = "top",
}: {
  onSettings: () => void
  onShortcuts: () => void
  side?: "top" | "right"
}) {
  return (
    <DropdownMenuContent
      side={side}
      align={side === "right" ? "end" : "start"}
      sideOffset={6}
      collisionPadding={12}
      className={side === "right" ? "min-w-52" : "min-w-(--radix-dropdown-menu-trigger-width)"}
    >
      <AccountMenuItems onSettings={onSettings} onShortcuts={onShortcuts} />
    </DropdownMenuContent>
  )
}

/** Settings, shortcuts and sign-out: the account menu on the web. */
function AccountMenuItems({ onSettings, onShortcuts }: { onSettings: () => void; onShortcuts: () => void }) {
  const t = useI18n().t
  return (
    <>
      <DropdownMenuItem onSelect={onSettings}>
        <HugeiconsIcon icon={Settings01Icon} strokeWidth={2} aria-hidden="true" />
        {t.shell.settings}
        <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onShortcuts}>
        <HugeiconsIcon icon={KeyboardIcon} strokeWidth={2} aria-hidden="true" />
        {t.shortcuts.title}
        <DropdownMenuShortcut>?</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DesktopDownloadItem label={t.shell.downloadDesktop} />
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => void signOut()}>
        <HugeiconsIcon icon={Logout01Icon} strokeWidth={2} aria-hidden="true" />
        {t.shell.signOut}
      </DropdownMenuItem>
    </>
  )
}

function RailLink({
  icon,
  label,
  selected,
  badge,
  shortcut,
  onClick,
  children,
}: {
  icon?: IconSvgElement
  label: string
  selected?: boolean
  /** A small dot, for unread mail. */
  badge?: boolean
  shortcut?: string
  onClick: () => void
  children?: ReactNode
}) {
  return (
    <RailTip label={label} shortcut={shortcut}>
      <button
        type="button"
        className={cn("rail-link", selected && "is-selected")}
        aria-current={selected ? "page" : undefined}
        aria-label={label}
        aria-keyshortcuts={shortcut}
        onClick={onClick}
      >
        {icon ? <HugeiconsIcon icon={icon} strokeWidth={2} className={NAV_ICON} aria-hidden="true" /> : children}
        {badge && <span className="rail-badge" aria-hidden="true" />}
      </button>
    </RailTip>
  )
}

/** The name of a rail icon, beside it on the right. */
function RailTip({ label, shortcut, children }: { label: string; shortcut?: string; children: ReactNode }) {
  return (
    <IconTip label={label} shortcut={shortcut} side="right">
      {children}
    </IconTip>
  )
}

/**
 * The collapsed sidebar: the same places as icons in a narrow strip, so
 * nothing is more than a click away. The logo brings the full sidebar back.
 */
function SidebarRail({
  accounts,
  accountId,
  user,
  sidebar,
  view,
  draftWaiting,
  composing,
  onSelectAccount,
  onCompose,
  onSettings,
  onShortcuts,
  places,
  layout,
}: Pick<
  MailNavigation,
  | "accounts"
  | "accountId"
  | "user"
  | "sidebar"
  | "view"
  | "draftWaiting"
  | "composing"
  | "onSelectAccount"
  | "onCompose"
  | "onSettings"
  | "onShortcuts"
> & {
  places: Record<NavItem, Place>
  layout: SidebarLayout
}) {
  const { t } = useI18n()
  const desktop = useInDesktop()
  return (
    <div className="sidebar-rail" inert={!sidebar.collapsed}>
      <RailTip label={t.shell.expand} shortcut="⌘B">
        <button
          ref={sidebar.expandButton}
          type="button"
          className="rail-brand"
          aria-label={t.shell.expand}
          aria-keyshortcuts="Meta+B Control+B"
          aria-expanded={false}
          aria-controls="list-sidebar"
          onClick={sidebar.toggle}
        >
          <HugeiconsIcon icon={Mail01Icon} strokeWidth={2.5} aria-hidden="true" className="rail-logo size-5" />
          <HugeiconsIcon icon={PanelLeftCloseIcon} strokeWidth={2} aria-hidden="true" className="rail-expand size-4" />
        </button>
      </RailTip>
      <nav className="rail-group" aria-label={t.shell.sidebar}>
        <RailLink
          icon={PencilEdit02Icon}
          label={draftWaiting ? t.inbox.resumeDraft : t.inbox.compose}
          selected={composing}
          shortcut="C"
          onClick={onCompose}
        />
        <span className="rail-gap" aria-hidden="true" />
        {[...layout.main, ...layout.more].map((id) => {
          const place = places[id]
          if (!place.shown) return null
          return (
            <RailLink
              key={id}
              icon={place.icon}
              label={place.count?.label ? `${place.label} · ${place.count.label}` : place.label}
              selected={place.selected}
              badge={place.badge}
              onClick={place.onSelect}
            />
          )
        })}
      </nav>
      <nav className="rail-group rail-mailboxes" aria-label={t.shell.mailboxes}>
        {accounts.map((account) => (
          <RailLink
            key={account.id}
            label={account.status === "active" ? account.email : `${account.email} · ${t.inbox.reconnectNeeded}`}
            selected={!composing && view === "inbox" && account.id === accountId}
            onClick={() => onSelectAccount(account.id)}
          >
            {account.status === "active" ? (
              <AccountDot color={account.color} className="size-2.5" />
            ) : (
              <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className={NAV_ICON} aria-hidden="true" />
            )}
          </RailLink>
        ))}
      </nav>
      {!desktop && (
        <div className="rail-footer">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="rail-account" aria-label={t.shell.account(user.email)}>
                <span className="workspace-avatar" aria-hidden="true">
                  {initialOf(user)}
                </span>
              </button>
            </DropdownMenuTrigger>
            <AccountMenuContent onSettings={onSettings} onShortcuts={onShortcuts} side="right" />
          </DropdownMenu>
        </div>
      )}
    </div>
  )
}

/** The sidebar's choices in one menu, for screens too narrow to keep it open. */
/** Not an account id, which are UUIDs. */
const DRAFTS_CHOICE = "drafts:"
const PARCELS_CHOICE = "parcels:"
const SNOOZED_CHOICE = "snoozed:"
const SCHEDULED_CHOICE = "scheduled:"
const SENDERS_CHOICE = "senders:"
const INVOICES_CHOICE = "invoices:"
const FOLDER_CHOICE = "folder:"

/** Each place as a choice in the menu: the inbox is all mailboxes, "". */
const MENU_CHOICES: Record<NavItem, string> = {
  inbox: "",
  starred: `${FOLDER_CHOICE}starred`,
  parcels: PARCELS_CHOICE,
  invoices: INVOICES_CHOICE,
  snoozed: SNOOZED_CHOICE,
  drafts: DRAFTS_CHOICE,
  scheduled: SCHEDULED_CHOICE,
  sent: `${FOLDER_CHOICE}sent`,
  senders: SENDERS_CHOICE,
  archive: `${FOLDER_CHOICE}archive`,
  spam: `${FOLDER_CHOICE}spam`,
  trash: `${FOLDER_CHOICE}trash`,
}

export function MailMenu({
  accounts,
  accountId,
  view,
  draftCount,
  onSelectAccount,
  onSelectDrafts,
  onSelectParcels,
  onSelectInvoices,
  onSelectSnoozed,
  onSelectScheduled,
  onSelectSenders,
  onSelectFolder,
  onSettings,
}: Pick<
  MailNavigation,
  | "accounts"
  | "accountId"
  | "view"
  | "draftCount"
  | "onSelectAccount"
  | "onSelectDrafts"
  | "onSelectParcels"
  | "onSelectInvoices"
  | "onSelectSnoozed"
  | "onSelectScheduled"
  | "onSelectSenders"
  | "onSelectFolder"
  | "onSettings"
>) {
  const { t } = useI18n()
  const parcels = useParcels()
  const tidy = useSenders()
  const invoices = useInvoices()
  const layout = useSidebarLayout()
  const labels = usePlaceLabels()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label={t.shell.menu}>
          <HugeiconsIcon icon={Menu01Icon} strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuRadioGroup
          value={
            view === "drafts"
              ? DRAFTS_CHOICE
              : view === "parcels"
                ? PARCELS_CHOICE
                : view === "invoices"
                  ? INVOICES_CHOICE
                : view === "snoozed"
                  ? SNOOZED_CHOICE
                  : view === "scheduled"
                    ? SCHEDULED_CHOICE
                    : view === "senders"
                      ? SENDERS_CHOICE
                      : view === "inbox"
                  ? accountId
                  : `${FOLDER_CHOICE}${view}`
          }
          onValueChange={(value) => {
            if (value === DRAFTS_CHOICE) onSelectDrafts()
            else if (value === PARCELS_CHOICE) onSelectParcels()
            else if (value === INVOICES_CHOICE) onSelectInvoices()
            else if (value === SNOOZED_CHOICE) onSelectSnoozed()
            else if (value === SCHEDULED_CHOICE) onSelectScheduled()
            else if (value === SENDERS_CHOICE) onSelectSenders()
            else if (value.startsWith(FOLDER_CHOICE)) onSelectFolder(value.slice(FOLDER_CHOICE.length) as MailFolder)
            else onSelectAccount(value)
          }}
        >
          {[...layout.main, ...layout.more].map((id) => {
            if ((id === "parcels" && !parcels) || (id === "invoices" && !invoices) || (id === "senders" && !tidy))
              return null
            return (
              <DropdownMenuRadioItem key={id} value={MENU_CHOICES[id]}>
                {labels[id]}
                {id === "drafts" && draftCount > 0 && (
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">{draftCount}</span>
                )}
              </DropdownMenuRadioItem>
            )
          })}
          {accounts.map((account) => (
            <DropdownMenuRadioItem key={account.id} value={account.id}>
              <AccountDot color={account.color} />
              <span className="truncate">{account.email}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSettings}>
          <HugeiconsIcon icon={Settings01Icon} strokeWidth={1.75} aria-hidden="true" />
          {t.shell.settings}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut()}>
          <HugeiconsIcon icon={Logout01Icon} strokeWidth={1.75} aria-hidden="true" />
          {t.shell.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
