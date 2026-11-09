import type { ReactNode } from "react"
import {
  Alert02Icon,
  InboxIcon,
  Logout01Icon,
  Mail01Icon,
  Menu01Icon,
  PencilEdit02Icon,
  Settings01Icon,
  UnfoldMoreIcon,
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
  DropdownMenuTrigger,
} from "@evido/ui/components/dropdown-menu"
import { cn } from "@evido/ui/lib/utils"
import type { MailAccountView } from "@evido/mail-core/types"
import { Brand } from "@/components/brand"
import { useI18n } from "@/i18n"
import { authClient } from "@/lib/auth-client"

export type MailNavigation = {
  accounts: MailAccountView[]
  /** Empty means every mailbox. */
  accountId: string
  email: string
  onSelectAccount: (id: string) => void
  onCompose: () => void
  onSettings: () => void
}

function NavItem({
  icon,
  active,
  title,
  onClick,
  children,
}: {
  icon: IconSvgElement
  active: boolean
  title?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
    >
      <HugeiconsIcon icon={icon} strokeWidth={1.75} aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate">{children}</span>
    </button>
  )
}

/** Full navigation from large screens up; smaller screens use MailMenu. */
export function Sidebar({
  accounts,
  accountId,
  email,
  onSelectAccount,
  onCompose,
  onSettings,
}: MailNavigation) {
  const { t } = useI18n()
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground lg:flex">
      <div className="flex h-12 shrink-0 items-center px-4">
        <Brand />
      </div>
      <div className="px-3 pb-3">
        <Button variant="outline" className="w-full justify-start" onClick={onCompose} title={`${t.inbox.compose} (C)`}>
          <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={1.75} data-icon="inline-start" aria-hidden="true" />
          {t.inbox.compose}
        </Button>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3">
        <NavItem icon={InboxIcon} active={accountId === ""} onClick={() => onSelectAccount("")}>
          {t.inbox.allMailboxes}
        </NavItem>
        {accounts.map((account) => (
          <NavItem
            key={account.id}
            icon={account.status === "active" ? Mail01Icon : Alert02Icon}
            active={accountId === account.id}
            title={account.status === "active" ? account.email : t.inbox.reconnectNeeded}
            onClick={() => onSelectAccount(account.id)}
          >
            {account.email}
          </NavItem>
        ))}
      </nav>
      <div className="p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="w-full justify-between font-normal text-muted-foreground">
              <span className="truncate">{email}</span>
              <HugeiconsIcon icon={UnfoldMoreIcon} strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-54">
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
      </div>
    </aside>
  )
}

/** The sidebar's choices in one menu, for screens too narrow to keep it open. */
export function MailMenu({
  accounts,
  accountId,
  onSelectAccount,
  onSettings,
}: Pick<MailNavigation, "accounts" | "accountId" | "onSelectAccount" | "onSettings">) {
  const { t } = useI18n()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label={t.shell.menu}>
          <HugeiconsIcon icon={Menu01Icon} strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuRadioGroup value={accountId} onValueChange={onSelectAccount}>
          <DropdownMenuRadioItem value="">{t.inbox.allMailboxes}</DropdownMenuRadioItem>
          {accounts.map((account) => (
            <DropdownMenuRadioItem key={account.id} value={account.id}>
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
