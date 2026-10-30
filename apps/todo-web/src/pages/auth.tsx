import { AuthForm } from "@/components/auth-form"
import { useI18n } from "@/i18n"
import { useTitle } from "@/lib/use-title"

type Mode = "login" | "register" | "forgot" | "reset"

export function AuthPage({ mode }: { mode: Mode }) {
  const { t } = useI18n()
  useTitle(t.auth.pageTitles[mode])
  return <AuthForm key={mode} mode={mode} />
}
