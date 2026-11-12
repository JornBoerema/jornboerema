import { useEffect } from "react"
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authUrl } from "@evido/auth/client"
import { Button } from "@evido/ui/components/button"
import { SettingsRow, SettingsSection } from "@evido/ui/components/settings-dialog"

const isPath = (value: string | null): value is string =>
  !!value && value.startsWith("/") && !value.startsWith("//")

/**
 * An app's old sign-in address (/login, /signup, /reset-password, …): forwards
 * to the same page on the account site, keeping its query (a reset token, an
 * error). Unless `keepQuery` alone, a returnTo path becomes this app's address
 * so the account site can send people back; `home` is where that defaults to.
 */
export function ToAccountSite({
  path,
  home = "/",
  keepQuery = false,
}: {
  path: string
  home?: string
  /** For signed OAuth requests (/connect), which must reach the account site unchanged. */
  keepQuery?: boolean
}) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (!keepQuery) {
      const returnTo = params.get("returnTo")
      params.set("returnTo", new URL(isPath(returnTo) ? returnTo : home, window.location.origin).toString())
    }
    window.location.replace(authUrl(path, Object.fromEntries(params)))
  }, [path, home, keepQuery])
  return null
}

export type AccountSiteTexts = {
  title: string
  description: string
  manage: string
}

/** The account behind an app, managed on the account site: name, e-mail, password, devices. */
export function AccountSiteSection({ user, texts }: { user: { name: string; email: string }; texts: AccountSiteTexts }) {
  return (
    <SettingsSection title={texts.title} description={texts.description}>
      <SettingsRow
        title={user.name || user.email}
        description={user.name ? user.email : undefined}
      >
        <Button asChild variant="outline">
          <a href={authUrl("/")} target="_blank" rel="noopener">
            {texts.manage}
            <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={1.75} aria-hidden="true" data-icon="inline-end" />
          </a>
        </Button>
      </SettingsRow>
    </SettingsSection>
  )
}

