import { AuthForm, type AuthMode } from "@evido/ui/components/auth-form"
import { useI18n } from "@/i18n"
import { authClient } from "@/lib/auth-client"
import { useReturnTo } from "@/lib/return-to"
import { useTitle } from "@/lib/use-title"

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
    />
  )
}
