import { useRef, useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ArrowUpRight01Icon,
  CheckmarkSquare02Icon,
  ComputerIcon,
  Delete02Icon,
  Download04Icon,
  LaptopIcon,
  Logout03Icon,
  Mail01Icon,
  SmartPhone01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { webUrl } from "@evido/auth/client"
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
import { Brand } from "@/components/brand"
import { RequireSession } from "@/components/require-session"
import { useI18n } from "@/i18n"
import { appLinks } from "@/lib/apps"
import { authClient } from "@/lib/auth-client"
import { useTitle } from "@/lib/use-title"

const icon = (svg: IconSvgElement, className = "size-4") => (
  <HugeiconsIcon icon={svg} strokeWidth={1.75} aria-hidden="true" className={className} />
)

type User = { name: string; email: string }

export function AccountPage() {
  const t = useI18n().t.account
  useTitle(t.pageTitle)
  return (
    <RequireSession>
      {(session) => <Account user={session.user} sessionToken={session.session.token} />}
    </RequireSession>
  )
}

async function signOut() {
  await authClient.signOut()
  window.location.assign("/login")
}

function Account({ user, sessionToken }: { user: User; sessionToken: string }) {
  const { t: all } = useI18n()
  const t = all.account
  return (
    <div className="auth-layout">
      <header className="flex items-center justify-between gap-4">
        <Brand />
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          {icon(Logout03Icon)}
          {all.common.signOut}
        </Button>
      </header>
      <main className="account-main">
        <div className="flex flex-col gap-1 px-1">
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-1px]">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.description}</p>
        </div>
        <Apps />
        <Profile user={user} />
        <SignIn user={user} />
        <Sessions current={sessionToken} />
        <DeleteAccount />
      </main>
    </div>
  )
}

function Apps() {
  const t = useI18n().t.account
  const links = appLinks()
  const apps: { title: string; help: string; href: string; icon: IconSvgElement; action: string; actionIcon: IconSvgElement }[] = [
    { title: t.appTodo, help: t.appTodoHelp, href: links.todo, icon: CheckmarkSquare02Icon, action: t.open, actionIcon: ArrowUpRight01Icon },
    { title: t.appMail, help: t.appMailHelp, href: links.mail, icon: Mail01Icon, action: t.open, actionIcon: ArrowUpRight01Icon },
    { title: t.appDesktop, help: t.appDesktopHelp, href: links.download, icon: ComputerIcon, action: t.download, actionIcon: Download04Icon },
  ]
  return (
    <SettingsSection title={t.apps}>
      {apps.map((app) => (
        <SettingsRow
          key={app.href}
          title={app.title}
          description={
            <span className="flex items-center gap-2">
              {icon(app.icon, "size-3.5 shrink-0")}
              {app.help}
            </span>
          }
        >
          <Button asChild variant="outline" size="sm">
            <a href={app.href}>
              {app.action}
              <HugeiconsIcon icon={app.actionIcon} strokeWidth={1.75} aria-hidden="true" data-icon="inline-end" />
            </a>
          </Button>
        </SettingsRow>
      ))}
    </SettingsSection>
  )
}

/** Runs one change at a time; a failed one shows a toast. */
function useBusy() {
  const { t } = useI18n()
  const [busy, setBusy] = useState<string | null>(null)
  const inFlight = useRef(false)
  async function perform(action: string, work: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(action)
    try {
      await work()
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t.common.failed)
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }
  return { busy, perform }
}

function Profile({ user }: { user: User }) {
  const { t: all } = useI18n()
  const t = all.account
  const { busy, perform } = useBusy()
  const [saved, setSaved] = useState(user.name)
  const [name, setName] = useState(user.name)
  const next = name.trim()
  return (
    <SettingsSection title={t.profile} description={t.profileHelp}>
      <SettingsRow title={t.name} htmlFor="profile-name">
        <form
          className="flex w-full gap-2 sm:w-auto"
          onSubmit={(event) => {
            event.preventDefault()
            if (!next || next === saved) return
            void perform("name", async () => {
              const result = await authClient.updateUser({ name: next })
              if (result.error) throw new Error()
              setSaved(next)
              setName(next)
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
          <Button type="submit" disabled={!!busy || !next || next === saved}>
            {busy === "name" ? all.common.saving : all.common.save}
          </Button>
        </form>
      </SettingsRow>
    </SettingsSection>
  )
}

function SignIn({ user }: { user: User }) {
  const { t: all } = useI18n()
  const t = all.account
  const { busy, perform } = useBusy()
  const [email, setEmail] = useState(user.email)
  const [emailSent, setEmailSent] = useState("")
  const [resetSent, setResetSent] = useState(false)
  const [changing, setChanging] = useState(false)
  const nextEmail = email.trim().toLowerCase()
  const emailUnchanged = !nextEmail || nextEmail === user.email.toLowerCase() || nextEmail === emailSent
  const notice = (text: ReactNode) => (
    <Alert role="status">
      {icon(Mail01Icon)}
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  )
  return (
    <SettingsSection title={t.signIn} description={t.signInHelp}>
      <SettingsRow
        title={t.email}
        htmlFor="profile-email"
        description={t.emailHelp}
        footer={emailSent && notice(t.emailSent(emailSent))}
      >
        <form
          className="flex w-full gap-2 sm:w-auto"
          onSubmit={(event) => {
            event.preventDefault()
            if (emailUnchanged) return
            void perform("email", async () => {
              const result = await authClient.changeEmail({ newEmail: nextEmail, callbackURL: webUrl("/") })
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
            {busy === "email" ? all.common.sending : t.change}
          </Button>
        </form>
      </SettingsRow>
      <SettingsRow
        title={t.password}
        description={t.passwordHelp}
        footer={
          <>
            {changing && <ChangePassword onDone={() => setChanging(false)} />}
            {resetSent && notice(t.resetSent)}
            {!resetSent && (
              <p className="text-sm text-muted-foreground">
                {t.forgotPassword}{" "}
                <button
                  type="button"
                  className="form-link"
                  disabled={!!busy}
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
                  {busy === "reset" ? all.common.sending : t.sendResetLink}
                </button>
              </p>
            )}
          </>
        }
      >
        {!changing && (
          <Button variant="outline" onClick={() => setChanging(true)}>
            {t.changePassword}
          </Button>
        )}
      </SettingsRow>
    </SettingsSection>
  )
}

function ChangePassword({ onDone }: { onDone: () => void }) {
  const { t: all } = useI18n()
  const t = all.account
  const queryClient = useQueryClient()
  const { busy, perform } = useBusy()
  const [error, setError] = useState("")
  return (
    <form
      className="flex flex-col gap-4 rounded-xl bg-muted/50 p-4"
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const newPassword = String(data.get("new") ?? "")
        if (newPassword !== data.get("confirm")) return setError(all.auth.errors.passwordMismatch)
        setError("")
        void perform("password", async () => {
          const result = await authClient.changePassword({
            currentPassword: String(data.get("current") ?? ""),
            newPassword,
            revokeOtherSessions: true,
          })
          if (result.error) {
            setError(result.error.code === "INVALID_PASSWORD" ? t.wrongPassword : all.auth.errors.generic)
            return
          }
          toast.success(t.passwordSaved)
          void queryClient.invalidateQueries({ queryKey: SESSIONS })
          onDone()
        })
      }}
    >
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="password-current">{t.currentPassword}</FieldLabel>
          <Input id="password-current" name="current" type="password" autoComplete="current-password" required disabled={!!busy} />
        </Field>
        <Field>
          <FieldLabel htmlFor="password-new">{t.newPassword}</FieldLabel>
          <Input
            id="password-new"
            name="new"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            disabled={!!busy}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="password-confirm">{t.confirmPassword}</FieldLabel>
          <Input
            id="password-confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            disabled={!!busy}
          />
        </Field>
      </FieldGroup>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={!!busy} onClick={onDone}>
          {all.common.cancel}
        </Button>
        <Button type="submit" disabled={!!busy}>
          {busy === "password" ? all.common.saving : t.changePassword}
        </Button>
      </div>
    </form>
  )
}

const SESSIONS = ["sessions"]

/** "Chrome on Mac", or the Even app: its webview names no browser. */
function describe(userAgent: string | null | undefined, texts: { unknownDevice: string; evenApp: string }) {
  if (!userAgent) return { label: texts.unknownDevice, icon: LaptopIcon }
  const os = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X|Macintosh/.test(userAgent)
        ? "Mac"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : ""
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Version\/.*Safari\//.test(userAgent)
          ? "Safari"
          : /AppleWebKit/.test(userAgent)
            ? texts.evenApp
            : ""
  const label = [browser, os].filter(Boolean).join(" · ") || texts.unknownDevice
  const phone = os === "iOS" || os === "Android"
  return { label, icon: phone ? SmartPhone01Icon : browser === texts.evenApp ? ComputerIcon : LaptopIcon }
}

function Sessions({ current }: { current: string }) {
  const { t: all, locale } = useI18n()
  const t = all.account
  const queryClient = useQueryClient()
  const sessions = useQuery({
    queryKey: SESSIONS,
    queryFn: async () => {
      const result = await authClient.listSessions()
      if (result.error) throw new Error()
      return [...result.data].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
    },
  })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: SESSIONS })
  const revoke = useMutation({
    mutationFn: async (token: string) => {
      const result = await authClient.revokeSession({ token })
      if (result.error) throw new Error()
    },
    onSettled: refresh,
    onError: () => toast.error(all.common.failed),
  })
  const revokeOthers = useMutation({
    mutationFn: async () => {
      const result = await authClient.revokeOtherSessions()
      if (result.error) throw new Error()
    },
    onSuccess: () => toast.success(t.signedOutOthers),
    onSettled: refresh,
    onError: () => toast.error(all.common.failed),
  })
  const when = (date: Date | string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(date))
  const list = sessions.data ?? []
  return (
    <SettingsSection title={t.sessions} description={t.sessionsHelp}>
      {list.map((session) => {
        const device = describe(session.userAgent, t)
        const isCurrent = session.token === current
        return (
          <SettingsRow
            key={session.id}
            title={device.label}
            description={
              <span className="flex flex-wrap items-center gap-x-2">
                {icon(device.icon, "size-3.5 shrink-0")}
                {isCurrent ? <span className="font-medium text-primary">{t.thisDevice}</span> : t.lastActive(when(session.updatedAt))}
              </span>
            }
          >
            {isCurrent ? (
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                {all.common.signOut}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(session.token)}
              >
                {t.signOutDevice}
              </Button>
            )}
          </SettingsRow>
        )
      })}
      {list.length > 1 && (
        <SettingsRow title={t.signOutOthers}>
          <Button variant="outline" size="sm" disabled={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>
            {t.signOutDevice}
          </Button>
        </SettingsRow>
      )}
    </SettingsSection>
  )
}

function DeleteAccount() {
  const { t: all } = useI18n()
  const t = all.account
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  return (
    <>
      <SettingsSection title={t.dangerZone} destructive>
        <SettingsRow title={t.deleteAccount} destructive description={t.deleteHelp}>
          <Button variant="destructive" onClick={() => setOpen(true)}>
            {icon(Delete02Icon)}
            {t.delete}
          </Button>
        </SettingsRow>
      </SettingsSection>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return
          setOpen(next)
          setPassword("")
          setError("")
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.deleteDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <form
            className="flex flex-col gap-6"
            onSubmit={async (event) => {
              event.preventDefault()
              if (!password || pending) return
              setPending(true)
              setError("")
              try {
                const result = await authClient.deleteUser({ password })
                if (result.error) throw new Error()
                toast.success(t.deleted)
                window.location.assign("/login")
              } catch {
                setError(t.deleteFailed)
                setPending(false)
              }
            }}
          >
            <FieldGroup>
              <Field data-invalid={!!error}>
                <FieldLabel htmlFor="delete-password">{t.currentPassword}</FieldLabel>
                <Input
                  id="delete-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setError("")
                  }}
                  required
                  disabled={pending}
                  aria-invalid={!!error}
                  aria-describedby={error ? "delete-error" : undefined}
                />
              </Field>
            </FieldGroup>
            {error && (
              <p id="delete-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={pending}>
                {all.common.cancel}
              </AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={pending || !password}>
                {pending ? t.deleting : t.deletePermanently}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
