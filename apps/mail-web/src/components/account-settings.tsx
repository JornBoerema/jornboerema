import { webUrl } from "@evido/auth/client"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { Delete02Icon, Mail01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
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
import { Button } from "@evido/ui/components/button"
import { Field, FieldGroup, FieldLabel } from "@evido/ui/components/field"
import { Input } from "@evido/ui/components/input"
import { SettingsRow, SettingsSection } from "@evido/ui/components/settings-dialog"
import { useI18n } from "@/i18n"
import { authClient } from "@/lib/auth-client"
import { clearMailCache } from "@/lib/cache"


const MailIcon = () => <HugeiconsIcon icon={Mail01Icon} strokeWidth={1.75} aria-hidden="true" />

/**
 * The Evido account behind the app, as in Even doen: name, sign-in email,
 * password reset and deleting it all.
 */
export function AccountSettings({ user }: { user: { name: string; email: string } }) {
  const t = useI18n().t.account
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
      if (action === "delete") setDeleteError(t.deleteFailed)
      else toast.error(t.failed)
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  const nextName = name.trim()
  const nextEmail = email.trim().toLowerCase()
  const emailUnchanged = !nextEmail || nextEmail === user.email.toLowerCase() || nextEmail === emailSent

  return (
    <>
      <SettingsSection title={t.profile} description={t.profileHelp}>
        <SettingsRow title={t.name} htmlFor="profile-name">
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
                toast.success(t.profileSaved)
              })
            }}
          >
            <Input
              id="profile-name"
              className="sm:w-60"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={100}
              disabled={!!busy}
            />
            <Button type="submit" disabled={!!busy || !nextName || nextName === savedName}>
              {busy === "name" ? t.saving : t.save}
            </Button>
          </form>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t.signIn} description={t.signInHelp}>
        <SettingsRow
          title={t.email}
          htmlFor="profile-email"
          description={t.emailHelp}
          footer={
            emailSent && (
              <Alert role="status">
                <MailIcon />
                <AlertDescription>{t.emailSent(emailSent)}</AlertDescription>
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
                  callbackURL: webUrl("/?settings=account", "mail"),
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
              onChange={(event) => setEmail(event.target.value)}
              required
              maxLength={254}
              disabled={!!busy}
            />
            <Button type="submit" variant="outline" disabled={!!busy || emailUnchanged}>
              {busy === "email" ? t.sending : t.change}
            </Button>
          </form>
        </SettingsRow>
        <SettingsRow
          title={t.password}
          description={
            <>
              {t.passwordHelpBefore}
              <strong className="font-medium text-foreground">{user.email}</strong>
              {t.passwordHelpAfter}
            </>
          }
          footer={
            resetSent && (
              <Alert role="status">
                <MailIcon />
                <AlertDescription>{t.resetSent}</AlertDescription>
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
                  redirectTo: webUrl("/reset-password", "mail"),
                })
                if (result.error) throw new Error()
                setResetSent(true)
              })
            }
          >
            <HugeiconsIcon icon={Mail01Icon} strokeWidth={1.75} data-icon="inline-start" aria-hidden="true" />
            {busy === "reset" ? t.sending : resetSent ? t.sent : t.sendResetLink}
          </Button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t.dangerZone} destructive>
        <SettingsRow title={t.deleteAccount} destructive description={t.deleteHelp}>
          <Button variant="destructive" disabled={!!busy} onClick={() => setDeleting(true)}>
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.75} data-icon="inline-start" aria-hidden="true" />
            {t.delete}
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
            <AlertDialogTitle>{t.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.deleteDescription}</AlertDialogDescription>
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
                // Nothing of this account stays in the browser.
                clearMailCache()
                try {
                  localStorage.removeItem("evido.mail.access")
                } catch {
                  // Blocked storage has nothing to clear.
                }
                window.location.assign("/login")
              })
            }}
          >
            <FieldGroup>
              <Field data-invalid={!!deleteError}>
                <FieldLabel htmlFor="delete-password">{t.currentPassword}</FieldLabel>
                <Input
                  id="delete-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
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
                {t.cancel}
              </AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={!!busy || !password}>
                {busy === "delete" ? t.deleting : t.deletePermanently}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
