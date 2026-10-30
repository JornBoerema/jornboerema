import { AuthForm } from "@/components/auth-form"
import { useTitle } from "@/lib/use-title"

const titles = {
  login: "Inloggen",
  register: "Registreren",
  forgot: "Wachtwoord vergeten",
  reset: "Wachtwoord herstellen",
} as const

export function AuthPage({ mode }: { mode: keyof typeof titles }) {
  useTitle(titles[mode])
  return <AuthForm key={mode} mode={mode} />
}
