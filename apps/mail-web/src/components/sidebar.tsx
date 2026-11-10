import {
  Add01Icon,
  Alert02Icon,
  File01Icon,
  InboxIcon,
  Logout01Icon,
  Menu01Icon,
  PencilEdit02Icon,
  Settings01Icon,
  SidebarLeft01Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
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
import type { MailAccountView } from "@evido/mail-core/types"
import { AccountDot } from "@/components/account-dot"
import { Brand } from "@/components/brand"
import { useI18n } from "@/i18n"
import { authClient } from "@/lib/auth-client"

export type MailNavigation = {
  accounts: MailAccountView[]
  /** Empty means every mailbox. */
  accountId: string
  user: { name: string; email: string }
  sidebar: ReturnType<typeof useCollapsibleSidebar>
  view: "inbox" | "drafts"
  draftCount: number
  /** A started message is out of view, ready to pick up again. */
  draftWaiting: boolean
  onSelectAccount: (id: string) => void
  onSelectDrafts: () => void
  onCompose: () => void
  onSettings: () => void
}

const NAV_ICON = "size-4 shrink-0"

/** The shared Evido sidebar. Smaller screens get MailMenu instead. */
export function Sidebar({
  accounts,
  accountId,
  user,
  sidebar,
  view,
  draftCount,
  draftWaiting,
  onSelectAccount,
  onSelectDrafts,
  onCompose,
  onSettings,
}: MailNavigation) {
  const { t } = useI18n()
  const allSelected = view === "inbox" && accountId === ""
  const draftsSelected = view === "drafts"
  return (
    <aside
      id="list-sidebar"
      className="list-sidebar max-lg:hidden!"
      aria-label={t.shell.sidebar}
      inert={sidebar.collapsed}
      aria-hidden={sidebar.collapsed}
    >
      <Brand />
      <div className="list-navigation sidebar-sections">
        <div className="sidebar-top">
          <button type="button" className="list-link" aria-keyshortcuts="C" onClick={onCompose}>
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
          </button>
          <button
            type="button"
            className={cn("list-link", draftsSelected && "is-selected")}
            aria-current={draftsSelected ? "page" : undefined}
            onClick={onSelectDrafts}
          >
            <HugeiconsIcon icon={File01Icon} strokeWidth={2} className={NAV_ICON} aria-hidden="true" />
            <span>{t.drafts.title}</span>
            {draftCount > 0 && (
              <span className="ml-auto text-xs text-muted-foreground tabular-nums" aria-label={t.drafts.count(draftCount)}>
                {draftCount}
              </span>
            )}
          </button>
        </div>
        <section className="sidebar-list-section" aria-labelledby="sidebar-mailboxes">
          <div className="sidebar-heading">
            <h2 id="sidebar-mailboxes">{t.shell.mailboxes}</h2>
            <Button
              variant="ghost"
              size="icon-sm"
              className="sidebar-add"
              aria-label={t.inbox.connect}
              title={t.inbox.connect}
              onClick={onSettings}
            >
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden="true" />
            </Button>
          </div>
          <nav aria-label={t.shell.mailboxes} className="sidebar-section-links">
            {accounts.map((account) => {
              const selected = view === "inbox" && account.id === accountId
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
      <div className="sidebar-footer">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="workspace-switcher" aria-label={t.shell.account(user.email)}>
              <span className="workspace-avatar" aria-hidden="true">
                {(user.name || user.email).trim().charAt(0).toUpperCase()}
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
          <DropdownMenuContent
            side="top"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            className="min-w-(--radix-dropdown-menu-trigger-width)"
          >
            <DropdownMenuItem onSelect={onSettings}>
              <HugeiconsIcon icon={Settings01Icon} strokeWidth={2} aria-hidden="true" />
              {t.shell.settings}
              <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void authClient.signOut()}>
              <HugeiconsIcon icon={Logout01Icon} strokeWidth={2} aria-hidden="true" />
              {t.shell.signOut}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  )
}

/** Brings the collapsed sidebar back. Only takes up room while it is collapsed. */
export function SidebarExpand({ sidebar }: Pick<MailNavigation, "sidebar">) {
  const t = useI18n().t.shell
  if (!sidebar.collapsed) return null
  return (
    <Button
      ref={sidebar.expandButton}
      variant="ghost"
      size="icon-sm"
      className="max-lg:hidden"
      aria-label={t.expand}
      title={t.expandTitle}
      aria-keyshortcuts="Meta+B Control+B"
      aria-expanded={false}
      aria-controls="list-sidebar"
      onClick={sidebar.toggle}
    >
      <HugeiconsIcon icon={SidebarLeft01Icon} strokeWidth={2} aria-hidden="true" />
    </Button>
  )
}

/** The sidebar's choices in one menu, for screens too narrow to keep it open. */
/** Not an account id, which are UUIDs. */
const DRAFTS_CHOICE = "drafts:"

export function MailMenu({
  accounts,
  accountId,
  view,
  draftCount,
  onSelectAccount,
  onSelectDrafts,
  onSettings,
}: Pick<
  MailNavigation,
  "accounts" | "accountId" | "view" | "draftCount" | "onSelectAccount" | "onSelectDrafts" | "onSettings"
>) {
  const { t } = useI18n()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label={t.shell.menu}>
          <HugeiconsIcon icon={Menu01Icon} strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuRadioGroup
          value={view === "drafts" ? DRAFTS_CHOICE : accountId}
          onValueChange={(value) => (value === DRAFTS_CHOICE ? onSelectDrafts() : onSelectAccount(value))}
        >
          <DropdownMenuRadioItem value="">{t.inbox.allMailboxes}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value={DRAFTS_CHOICE}>
            {t.drafts.title}
            {draftCount > 0 && <span className="ml-auto text-xs text-muted-foreground tabular-nums">{draftCount}</span>}
          </DropdownMenuRadioItem>
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
        <DropdownMenuItem onSelect={() => void authClient.signOut()}>
          <HugeiconsIcon icon={Logout01Icon} strokeWidth={1.75} aria-hidden="true" />
          {t.shell.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
