import { useParcels } from "@/lib/preferences"
import { AppSwitcher, useInDesktop } from "@evido/ui/components/app-switcher"
import { UpdateButton } from "@evido/ui/components/desktop-app"
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
import { MAIL_FOLDERS, type MailAccountView, type MailFolder } from "@evido/mail-core/types"
import { AccountDot } from "@/components/account-dot"
import { Brand } from "@/components/brand"
import { useI18n } from "@/i18n"
import { signOut } from "@/lib/auth-client"
import { useUnread } from "@/lib/mail"
import { IconTip } from "@/components/icon-tip"

export type MailView = "inbox" | "drafts" | "parcels" | MailFolder

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
  onSelectDrafts: () => void
  onSelectParcels: () => void
  onSelectFolder: (folder: MailFolder) => void
  onCompose: () => void
  onSettings: () => void
  onSearch: () => void
  onShortcuts: () => void
}

const NAV_ICON = "size-4 shrink-0"

/** Folders opened now and then, out of the way until asked for. */
const MORE: MailFolder[] = ["archive", "spam", "trash"]
const MORE_KEY = "evido.mail.sidebar.more"

function readMoreOpen() {
  try {
    return localStorage.getItem(MORE_KEY) === "open"
  } catch {
    return false
  }
}

function MoreFolders({ view, onSelect }: { view: MailView | null; onSelect: (folder: MailFolder) => void }) {
  const t = useI18n().t.shell
  const [chosen, setChosen] = useState(readMoreOpen)
  // Being in one of them keeps the group open, so the current folder stays in sight.
  const open = chosen || MORE.includes(view as MailFolder)
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
      <button type="button" className="list-link is-ghost" aria-expanded={open} onClick={toggle}>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          className={cn(NAV_ICON, "transition-transform", open && "rotate-90")}
          aria-hidden="true"
        />
        <span>{t.more}</span>
      </button>
      {open && MORE.map((folder) => <FolderLink key={folder} folder={folder} view={view} onSelect={onSelect} />)}
    </>
  )
}

function FolderLink({
  folder,
  view,
  onSelect,
}: {
  folder: MailFolder
  view: MailView | null
  onSelect: (folder: MailFolder) => void
}) {
  const t = useI18n().t.folders
  const selected = view === folder
  return (
    <button
      type="button"
      className={cn("list-link", selected && "is-selected")}
      aria-current={selected ? "page" : undefined}
      onClick={() => onSelect(folder)}
    >
      <HugeiconsIcon icon={FOLDER_ICONS[folder]} strokeWidth={2} className={NAV_ICON} aria-hidden="true" />
      <span>{t[folder]}</span>
    </button>
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
  onSelectFolder,
  onCompose,
  onSettings,
  onShortcuts,
}: MailNavigation) {
  const { t, locale } = useI18n()
  const desktop = useInDesktop()
  const parcels = useParcels()
  const unread = useUnread(true).data?.count
  // While writing, only New message is current; closing it gives the selection back.
  const allSelected = !composing && view === "inbox" && accountId === ""
  const draftsSelected = !composing && view === "drafts"
  const shownView: MailView | null = composing ? null : view
  return (
    // One panel for both: its width animates, and the full sidebar and the rail fade into each other.
    <aside
      id="list-sidebar"
      className={cn("list-sidebar mail-sidebar max-lg:hidden!", sidebar.collapsed && "is-collapsed")}
      aria-label={t.shell.sidebar}
    >
      <div className="sidebar-full" inert={sidebar.collapsed}>
        <div className="sidebar-brand-row">
          <AppSwitcher menu={<AccountMenuItems onSettings={onSettings} onShortcuts={onShortcuts} />}>
            <Brand />
          </AppSwitcher>
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
            <button
              type="button"
              className={cn("list-link", allSelected && "is-selected")}
              aria-current={allSelected ? "page" : undefined}
              onClick={() => onSelectAccount("")}
            >
              <HugeiconsIcon icon={InboxIcon} strokeWidth={2} className={NAV_ICON} aria-hidden="true" />
              <span>{t.inbox.allMailboxes}</span>
              {!!unread && (
                <span className="list-count" aria-label={t.emptyPane.unread(String(unread))}>
                  {unread.toLocaleString(locale)}
                </span>
              )}
            </button>
            <FolderLink folder="starred" view={shownView} onSelect={onSelectFolder} />
            {parcels && (
              <button
                type="button"
                className={cn("list-link", shownView === "parcels" && "is-selected")}
                aria-current={shownView === "parcels" ? "page" : undefined}
                onClick={onSelectParcels}
              >
                <HugeiconsIcon icon={PackageIcon} strokeWidth={2} className={NAV_ICON} aria-hidden="true" />
                <span>{t.parcels.title}</span>
              </button>
            )}
            <button
              type="button"
              className={cn("list-link", draftsSelected && "is-selected")}
              aria-current={draftsSelected ? "page" : undefined}
              onClick={onSelectDrafts}
            >
              <HugeiconsIcon icon={File01Icon} strokeWidth={2} className={NAV_ICON} aria-hidden="true" />
              <span>{t.drafts.title}</span>
              {draftCount > 0 && (
                <span className="list-count" aria-label={t.drafts.count(draftCount)}>
                  {draftCount}
                </span>
              )}
            </button>
            <FolderLink folder="sent" view={shownView} onSelect={onSelectFolder} />
            <MoreFolders view={shownView} onSelect={onSelectFolder} />
          </div>
          <section className="sidebar-list-section" aria-labelledby="sidebar-mailboxes">
            <div className="sidebar-heading">
              <h2 id="sidebar-mailboxes">{t.shell.mailboxes}</h2>
              <IconTip label={t.inbox.connect}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="sidebar-add"
                  aria-label={t.inbox.connect}
                  onClick={onSettings}
                >
                  <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden="true" />
                </Button>
              </IconTip>
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
        <UpdateButton />
        {/* In the desktop app these sit in the brand's menu. */}
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
        {...{ accounts, accountId, user, sidebar, view, draftCount, draftWaiting, composing }}
        {...{ onSelectAccount, onSelectDrafts, onSelectParcels, onSelectFolder, onCompose, onSettings, onShortcuts }}
        unread={unread}
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

/** Settings, shortcuts and sign-out: the account menu on the web, the brand's menu in the desktop app. */
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
  draftCount,
  draftWaiting,
  composing,
  unread,
  onSelectAccount,
  onSelectDrafts,
  onSelectParcels,
  onSelectFolder,
  onCompose,
  onSettings,
  onShortcuts,
}: Omit<MailNavigation, "onSearch"> & { unread: number | undefined }) {
  const { t } = useI18n()
  const desktop = useInDesktop()
  const parcels = useParcels()
  const shownView: MailView | null = composing ? null : view
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
        <RailLink
          icon={InboxIcon}
          label={unread ? `${t.inbox.allMailboxes} · ${t.emptyPane.unread(String(unread))}` : t.inbox.allMailboxes}
          selected={!composing && view === "inbox" && accountId === ""}
          badge={!!unread}
          onClick={() => onSelectAccount("")}
        />
        <RailLink
          icon={StarIcon}
          label={t.folders.starred}
          selected={shownView === "starred"}
          onClick={() => onSelectFolder("starred")}
        />
        {parcels && (
          <RailLink
            icon={PackageIcon}
            label={t.parcels.title}
            selected={shownView === "parcels"}
            onClick={onSelectParcels}
          />
        )}
        <RailLink
          icon={File01Icon}
          label={draftCount > 0 ? `${t.drafts.title} · ${t.drafts.count(draftCount)}` : t.drafts.title}
          selected={!composing && view === "drafts"}
          onClick={onSelectDrafts}
        />
        <RailLink
          icon={SentIcon}
          label={t.folders.sent}
          selected={shownView === "sent"}
          onClick={() => onSelectFolder("sent")}
        />
        {MORE.map((folder) => (
          <RailLink
            key={folder}
            icon={FOLDER_ICONS[folder]}
            label={t.folders[folder]}
            selected={shownView === folder}
            onClick={() => onSelectFolder(folder)}
          />
        ))}
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
const FOLDER_CHOICE = "folder:"

export function MailMenu({
  accounts,
  accountId,
  view,
  draftCount,
  onSelectAccount,
  onSelectDrafts,
  onSelectParcels,
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
  | "onSelectFolder"
  | "onSettings"
>) {
  const { t } = useI18n()
  const parcels = useParcels()
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
                : view === "inbox"
                  ? accountId
                  : `${FOLDER_CHOICE}${view}`
          }
          onValueChange={(value) => {
            if (value === DRAFTS_CHOICE) onSelectDrafts()
            else if (value === PARCELS_CHOICE) onSelectParcels()
            else if (value.startsWith(FOLDER_CHOICE)) onSelectFolder(value.slice(FOLDER_CHOICE.length) as MailFolder)
            else onSelectAccount(value)
          }}
        >
          <DropdownMenuRadioItem value="">{t.inbox.allMailboxes}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value={DRAFTS_CHOICE}>
            {t.drafts.title}
            {draftCount > 0 && <span className="ml-auto text-xs text-muted-foreground tabular-nums">{draftCount}</span>}
          </DropdownMenuRadioItem>
          {parcels && <DropdownMenuRadioItem value={PARCELS_CHOICE}>{t.parcels.title}</DropdownMenuRadioItem>}
          {MAIL_FOLDERS.map((folder) => (
            <DropdownMenuRadioItem key={folder} value={`${FOLDER_CHOICE}${folder}`}>
              {t.folders[folder]}
            </DropdownMenuRadioItem>
          ))}
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
