import { AccountSiteSection } from "@evido/ui/components/account-site"
import { useI18n } from "@/i18n"

/** Name, e-mail, password and devices live on the account site, shared by every Even app. */
export function AccountSettings({ user }: { user: { name: string; email: string } }) {
  return <AccountSiteSection user={user} texts={useI18n().t.account} />
}
