import { useRef, useState } from "react"
import { useNavigate } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"
import { webUrl } from "@/lib/api"
import { useI18n } from "@/i18n"
import { Mail, Trash2 } from "@/components/icons"
import { SettingsRow, SettingsSection } from "@evido/ui/components/settings-dialog"
import { Button } from "@evido/ui/components/button"
import { Input } from "@evido/ui/components/input"
import { Field, FieldGroup, FieldLabel } from "@evido/ui/components/field"
import { Alert, AlertDescription } from "@evido/ui/components/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@evido/ui/components/alert-dialog"

export function AccountSettings({ user }: { user: { name: string; email: string } }) {
  const navigate = useNavigate()
  const { t } = useI18n()
  const s = t.settings
  const client = useQueryClient()
  const [savedName, setSavedName] = useState(user.name)
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [busy, setBusy] = useState<string | null>(null)
  const inFlight = useRef(false)
  const [emailSent, setEmailSent] = useState("")
  const [resetSent, setResetSent] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [password, setPassword] = useState("")
  const [deleteError, setDeleteError] = useState("")

  async function perform(action: string, work: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(action)
    try {
      await work()
    } catch {
      if (action === "delete")
        setDeleteError(s.account.deleteFailed)
      else toast.error(s.common.failed)
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  const nextName = name.trim()
  const nextEmail = email.trim().toLowerCase()
  const emailUnchanged =
    !nextEmail || nextEmail === user.email.toLowerCase() || nextEmail === emailSent

  return (
    <>
      <SettingsSection title={s.account.profile} description={s.account.profileHelp}>
        <SettingsRow title={s.account.name} htmlFor="profile-name">
          <form
            className="flex w-full gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault()
              if (!nextName || nextName === savedName) return
              void perform("name", async () => {
                const result = await authClient.updateUser({ name: nextName })
                if (result.error) throw new Error()
                setSavedName(nextName)
                setName(nextName)
                toast.success(s.account.profileSaved)
              })
            }}
          >
            <Input
              id="profile-name"
              className="sm:w-60"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              disabled={!!busy}
            />
            <Button type="submit" disabled={!!busy || !nextName || nextName === savedName}>
              {busy === "name" ? s.common.saving : s.common.save}
            </Button>
          </form>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={s.account.signIn} description={s.account.signInHelp}>
        <SettingsRow
          title={s.account.email}
          htmlFor="profile-email"
          description={s.account.emailHelp}
          footer={
            emailSent && (
              <Alert role="status">
                <Mail />
                <AlertDescription>
                  {s.account.emailSent(emailSent)}
                </AlertDescription>
              </Alert>
            )
          }
        >
          <form
            className="flex w-full gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault()
              if (emailUnchanged) return
              void perform("email", async () => {
                const result = await authClient.changeEmail({
                  newEmail: nextEmail,
                  callbackURL: webUrl("/?settings=account"),
                })
                if (result.error) throw new Error()
                setEmailSent(nextEmail)
              })
            }}
          >
            <Input
              id="profile-email"
              className="sm:w-60"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
              disabled={!!busy}
            />
            <Button type="submit" variant="outline" disabled={!!busy || emailUnchanged}>
              {busy === "email" ? s.common.sending : s.account.change}
            </Button>
          </form>
        </SettingsRow>
        <SettingsRow
          title={s.account.password}
          description={
            <>
              {s.account.passwordHelpBefore}
              <strong className="font-medium text-foreground">{user.email}</strong>
              {s.account.passwordHelpAfter}
            </>
          }
          footer={
            resetSent && (
              <Alert role="status">
                <Mail />
                <AlertDescription>
                  {s.account.resetSent}
                </AlertDescription>
              </Alert>
            )
          }
        >
          <Button
            variant="outline"
            disabled={!!busy || resetSent}
            onClick={() =>
              void perform("reset", async () => {
                const result = await authClient.requestPasswordReset({
                  email: user.email,
                  redirectTo: webUrl("/reset-password"),
                })
                if (result.error) throw new Error()
                setResetSent(true)
              })
            }
          >
            <Mail data-icon="inline-start" />
            {busy === "reset" ? s.common.sending : resetSent ? s.account.sent : s.account.sendResetLink}
          </Button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={s.common.dangerZone} destructive>
        <SettingsRow
          title={s.account.deleteAccount}
          destructive
          description={s.account.deleteHelp}
        >
          <Button variant="destructive" disabled={!!busy} onClick={() => setDeleting(true)}>
            <Trash2 data-icon="inline-start" />
            {s.common.delete}
          </Button>
        </SettingsRow>
      </SettingsSection>

      <AlertDialog
        open={deleting}
        onOpenChange={(open) => {
          if (busy) return
          setDeleting(open)
          setPassword("")
          setDeleteError("")
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{s.account.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {s.account.deleteDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form
            className="flex flex-col gap-6"
            onSubmit={(event) => {
              event.preventDefault()
              if (!password) return
              setDeleteError("")
              void perform("delete", async () => {
                const result = await authClient.deleteUser({ password })
                if (result.error) throw new Error()
                client.clear()
                toast.success(s.account.deleted)
                navigate("/login", { replace: true })
              })
            }}
          >
            <FieldGroup>
              <Field data-invalid={!!deleteError}>
                <FieldLabel htmlFor="delete-password">{s.account.currentPassword}</FieldLabel>
                <Input
                  id="delete-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setDeleteError("")
                  }}
                  required
                  disabled={!!busy}
                  aria-invalid={!!deleteError}
                  aria-describedby={deleteError ? "delete-error" : undefined}
                />
              </Field>
            </FieldGroup>
            {deleteError && (
              <p id="delete-error" role="alert" className="text-sm text-destructive">
                {deleteError}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={!!busy}>
                {s.common.cancel}
              </AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={!!busy || !password}>
                {busy === "delete" ? s.account.deleting : s.account.deletePermanently}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
