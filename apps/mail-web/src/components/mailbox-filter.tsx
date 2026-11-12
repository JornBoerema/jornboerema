import type { ReactNode } from "react"
import { AtIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuLabel,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@evido/ui/components/dropdown-menu"
import { cn } from "@evido/ui/lib/utils"
import type { MailAccountView } from "@evido/mail-core/types"
import { AccountDot } from "@/components/account-dot"
import { IconTip } from "@/components/icon-tip"
import { useI18n } from "@/i18n"

/** Compact like the app's other menus; the tick small and quiet on the right. */
const ITEM =
  "min-h-7 gap-2.5 rounded-lg py-1 pr-7 pl-2 text-[13px] [&_[data-slot=dropdown-menu-radio-item-indicator]_svg]:size-3.5 [&_[data-slot=dropdown-menu-radio-item-indicator]]:text-muted-foreground"

/** With a mailbox picked the button names it; only the bare icon needs a name on hover. */
const MaybeTip = ({ label, children }: { label?: string; children: ReactNode }) =>
  label ? <IconTip label={label}>{children}</IconTip> : children

/**
 * Which mailbox a list shows, beside its title. Every mailbox by default; one
 * picked shows as its dot and address, so the list never looks complete when it isn't.
 */
export function MailboxFilter({
  accounts,
  accountId,
  onChange,
}: {
  accounts: MailAccountView[]
  /** Empty means every mailbox. */
  accountId: string
  onChange: (id: string) => void
}) {
  const t = useI18n().t.mailboxFilter
  const picked = accounts.find((account) => account.id === accountId)
  return (
    <DropdownMenu>
      <MaybeTip label={picked ? undefined : t.label}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size={picked ? "sm" : "icon-sm"}
            aria-label={picked ? `${t.label}: ${picked.email}` : t.label}
            className={cn(picked && "max-w-48 gap-1.5 bg-accent px-2 text-foreground")}
          >
            {picked ? (
              <>
                <AccountDot color={picked.color} />
                <span className="truncate text-xs">{picked.email}</span>
              </>
            ) : (
              <HugeiconsIcon icon={AtIcon} strokeWidth={1.75} aria-hidden="true" />
            )}
          </Button>
        </DropdownMenuTrigger>
      </MaybeTip>
      <DropdownMenuContent align="end" sideOffset={6} className="w-64 p-1">
        <DropdownMenuLabel className="px-2 pt-1.5 pb-1 text-xs font-normal text-muted-foreground">{t.showFrom}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={accountId} onValueChange={onChange}>
          <DropdownMenuRadioItem value="" className={ITEM}>
            {/* Every mailbox's dot, a little overlapped: all of them, at a glance. */}
            <span className="flex w-4 shrink-0 justify-center -space-x-1" aria-hidden="true">
              {accounts.slice(0, 3).map((account) => (
                <AccountDot key={account.id} color={account.color} className="ring-2 ring-popover" />
              ))}
            </span>
            <span className="flex-1 truncate">{t.all}</span>
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator className="mx-1 my-1" />
          {accounts.map((account) => (
            <DropdownMenuRadioItem key={account.id} value={account.id} className={ITEM}>
              <span className="flex w-4 shrink-0 justify-center" aria-hidden="true">
                <AccountDot color={account.color} />
              </span>
              <span className="flex-1 truncate">{account.email}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
