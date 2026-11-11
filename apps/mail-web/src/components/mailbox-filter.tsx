import type { ReactNode } from "react"
import { Mailbox01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@evido/ui/components/dropdown-menu"
import { cn } from "@evido/ui/lib/utils"
import type { MailAccountView } from "@evido/mail-core/types"
import { AccountDot } from "@/components/account-dot"
import { IconTip } from "@/components/icon-tip"
import { useI18n } from "@/i18n"

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
              <HugeiconsIcon icon={Mailbox01Icon} strokeWidth={1.75} aria-hidden="true" />
            )}
          </Button>
        </DropdownMenuTrigger>
      </MaybeTip>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-56 rounded-xl p-1">
        <DropdownMenuRadioGroup value={accountId} onValueChange={onChange}>
          <DropdownMenuRadioItem value="">{t.all}</DropdownMenuRadioItem>
          {accounts.map((account) => (
            <DropdownMenuRadioItem key={account.id} value={account.id}>
              <AccountDot color={account.color} />
              <span className="truncate">{account.email}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
