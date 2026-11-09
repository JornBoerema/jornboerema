import { useSearchParams } from "react-router"
import { AuthForm, type AuthMode } from "@evido/ui/components/auth-form"
import { invitationReturnTo } from "@evido/todo-core/sharing"
import { useI18n } from "@/i18n"
import { authClient } from "@/lib/auth-client"
import { useTitle } from "@/lib/use-title"

export function AuthPage({ mode }: { mode: AuthMode }) {
  const { t } = useI18n()
  const [params] = useSearchParams()
  useTitle(t.auth.pageTitles[mode])
  return (
    <AuthForm
      key={mode}
      mode={mode}
      client={authClient}
      texts={{ ...t.auth, noConnection: t.common.noConnection }}
      returnTo={invitationReturnTo(params.get("returnTo"))}
    />
  )
}
