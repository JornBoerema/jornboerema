import { useEffect } from "react"
import { AuthForm, type AuthMode } from "@evido/ui/components/auth-form"
import { useI18n } from "@/i18n"
import { authClient } from "@/lib/auth-client"

const APP_NAME = "Even mailen"

export function AuthPage({ mode }: { mode: AuthMode }) {
  const { t } = useI18n()
  const title = t.auth.pageTitles[mode]
  useEffect(() => {
    document.title = `${title} · ${APP_NAME}`
    return () => {
      document.title = APP_NAME
    }
  }, [title])
  return (
    <AuthForm
      key={mode}
      mode={mode}
      client={authClient}
      texts={{ ...t.auth, noConnection: t.shell.noConnection }}
    />
  )
}
