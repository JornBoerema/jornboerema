import { useState, type FormEvent } from "react"
import { Button } from "@evido/ui/components/button"
import { Input } from "@evido/ui/components/input"
import { Label } from "@evido/ui/components/label"
import { Brand } from "@/components/brand"
import { useI18n } from "@/i18n"
import { authClient } from "@/lib/auth-client"

export function LoginPage() {
  const t = useI18n().t.login
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    const result = await authClient.signIn.email({ email, password })
    if (result.error) setError(result.error.message ?? t.failed)
    setBusy(false)
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-sidebar p-4">
      <Brand />
      <div className="flex w-full max-w-sm flex-col gap-5 rounded-xl border bg-background p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.hint}</p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">{t.email}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">{t.password}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {t.submit}
          </Button>
        </form>
      </div>
    </main>
  )
}
