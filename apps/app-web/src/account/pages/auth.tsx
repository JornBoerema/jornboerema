import { AuthForm, type AuthMode } from "@evido/ui/components/auth-form"
import { useI18n } from "@/account/i18n"
import { authClient } from "@/account/lib/auth-client"
import { useReturnTo } from "@/account/lib/return-to"
import { useTitle } from "@/account/lib/use-title"

export function AuthPage({ mode }: { mode: AuthMode }) {
  const { t } = useI18n()
  useTitle(t.auth.pageTitles[mode])
  return (
    <AuthForm
      key={mode}
      mode={mode}
      client={authClient}
      texts={{ ...t.auth, noConnection: t.common.noConnection }}
      returnTo={useReturnTo()}
      legal={
        <>
          {t.auth.legal.before}{" "}
          <a href="https://jornboerema.nl/terms" target="_blank" rel="noopener">
            {t.auth.legal.terms}
          </a>{" "}
          {t.auth.legal.and}{" "}
          <a href="https://jornboerema.nl/privacy" target="_blank" rel="noopener">
            {t.auth.legal.privacy}
          </a>
          .
        </>
      }
    />
  )
}
