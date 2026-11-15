import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { encode } from "uqr"
import {
  ComputerIcon,
  Copy01Icon,
  Delete02Icon,
  Download04Icon,
  FingerPrintIcon,
  LaptopIcon,
  Logout03Icon,
  Mail01Icon,
  SmartPhone01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { webUrl, type SocialProvider } from "@even/auth/client"
import { Alert, AlertDescription } from "@even/ui/components/alert"
import { PASSKEY_DISMISSED } from "@even/ui/components/auth-form"
import { CodeInput } from "@even/ui/components/code-input"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@even/ui/components/alert-dialog"
import { Button } from "@even/ui/components/button"
import { Field, FieldGroup, FieldLabel } from "@even/ui/components/field"
import { Input } from "@even/ui/components/input"
import { SettingsRow, SettingsSection } from "@even/ui/components/settings-dialog"
import { PROVIDER_NAMES, ProviderLogo, useSocialProviders } from "@even/ui/components/social-providers"
import { Brand } from "@even/shell/brand"
import { RequireSession } from "@/account/components/require-session"
import { Subscription } from "@/account/components/subscription"
import { useI18n } from "@/account/i18n"
import { authClient } from "@/account/lib/auth-client"
import { useTitle } from "@/account/lib/use-title"

const icon = (svg: IconSvgElement, className = "size-4") => (
  <HugeiconsIcon icon={svg} strokeWidth={1.75} aria-hidden="true" className={className} />
)

type User = { name: string; email: string; twoFactorEnabled?: boolean | null }

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
        <Subscription />
        <Profile user={user} />
        <SignIn user={user} />
        <Security user={user} />
        <ConnectedAccounts />
        <Sessions current={sessionToken} />
        <DeleteAccount />
      </main>
    </div>
  )
}

const ACCOUNTS = ["accounts"]

/** How this user can sign in: "credential" (a password) and each linked provider. */
function useAccounts() {
  return useQuery({
    queryKey: ACCOUNTS,
    queryFn: async () => {
      const result = await authClient.listAccounts()
      if (result.error) throw new Error(result.error.code ?? "")
      return result.data
    },
  })
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
  // Signed up with Google, Microsoft or Apple: no password yet. The reset link sets one.
  const accounts = useAccounts()
  const hasPassword = !accounts.data || accounts.data.some((account) => account.providerId === "credential")
  const sendResetLink = () =>
    void perform("reset", async () => {
      const result = await authClient.requestPasswordReset({
        email: user.email,
        redirectTo: webUrl("/reset-password"),
      })
      if (result.error) throw new Error()
      setResetSent(true)
    })
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
              const result = await authClient.changeEmail({ newEmail: nextEmail, callbackURL: webUrl("/account") })
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
        description={hasPassword ? t.passwordHelp : t.noPasswordHelp}
        footer={
          <>
            {changing && <ChangePassword onDone={() => setChanging(false)} />}
            {resetSent && notice(hasPassword ? t.resetSent : t.setPasswordSent)}
            {!resetSent && hasPassword && (
              <p className="text-sm text-muted-foreground">
                {t.forgotPassword}{" "}
                <button
                  type="button"
                  className="form-link"
                  disabled={!!busy}
                  onClick={sendResetLink}
                >
                  {busy === "reset" ? all.common.sending : t.sendResetLink}
                </button>
              </p>
            )}
          </>
        }
      >
        {hasPassword
          ? !changing && (
              <Button variant="outline" onClick={() => setChanging(true)}>
                {t.changePassword}
              </Button>
            )
          : !resetSent && (
              <Button variant="outline" disabled={!!busy} onClick={sendResetLink}>
                {busy === "reset" ? all.common.sending : t.setPassword}
              </Button>
            )}
      </SettingsRow>
    </SettingsSection>
  )
}

/** Errors for changes that want a recent sign-in, or the password. */
function securityError(t: ReturnType<typeof useI18n>["t"], code?: string) {
  if (code === "SESSION_NOT_FRESH" || code === "SESSION_EXPIRED") return t.account.signInAgainFirst
  if (code === "INVALID_PASSWORD") return t.account.wrongPassword
  if (code === "INVALID_CODE") return t.auth.twoFactor.invalidCode
  return t.common.failed
}

function Security({ user }: { user: User }) {
  const t = useI18n().t.account
  const accounts = useAccounts()
  const hasPassword = !accounts.data || accounts.data.some((account) => account.providerId === "credential")
  return (
    <SettingsSection title={t.security} description={t.securityHelp}>
      <Passkeys />
      <TwoFactor enabled={!!user.twoFactorEnabled} hasPassword={hasPassword} />
    </SettingsSection>
  )
}

const PASSKEYS = ["passkeys"]

function Passkeys() {
  const { t: all, language } = useI18n()
  const t = all.account
  const queryClient = useQueryClient()
  const { busy, perform } = useBusy()
  const supported = typeof window !== "undefined" && typeof window.PublicKeyCredential === "function"
  const passkeys = useQuery({
    queryKey: PASSKEYS,
    queryFn: async () => {
      const result = await authClient.$fetch<{ id: string; name?: string | null; createdAt: string }[]>(
        "/passkey/list-user-passkeys",
        { method: "GET" }
      )
      if (result.error) throw new Error()
      return [...result.data].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    },
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: PASSKEYS })
  const added = (date: string) =>
    new Date(date).toLocaleDateString(language, { day: "numeric", month: "long", year: "numeric" })
  return (
    <>
      <SettingsRow
        title={t.passkeys}
        description={supported ? t.passkeysHelp : t.passkeysUnsupported}
      >
        <Button
          variant="outline"
          size="sm"
          disabled={!supported || !!busy}
          onClick={() =>
            void perform("add", async () => {
              // Named after this browser and device, e.g. "Safari · Mac".
              const name = describe(navigator.userAgent, t).label
              const result = await authClient.passkey.addPasskey({ name })
              if (result?.error) {
                const code = (result.error as { code?: string }).code ?? ""
                if (PASSKEY_DISMISSED.has(code)) return
                if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") throw new Error(t.passkeyExists)
                if (code === "SESSION_NOT_FRESH") throw new Error(t.signInAgainFirst)
                throw new Error(t.passkeyFailed)
              }
              await refresh()
              toast.success(t.passkeyAdded)
            })
          }
        >
          {busy === "add" ? t.addingPasskey : t.addPasskey}
        </Button>
      </SettingsRow>
      {passkeys.data?.map((passkey) => (
        <SettingsRow
          key={passkey.id}
          title={
            <span className="flex items-center gap-2.5">
              {icon(FingerPrintIcon, "size-4 text-muted-foreground")}
              {passkey.name || t.passkeyUnnamed}
            </span>
          }
          description={t.passkeyAddedOn(added(passkey.createdAt))}
        >
          <Button
            variant="ghost"
            size="sm"
            disabled={!!busy}
            onClick={() =>
              void perform(passkey.id, async () => {
                const result = await authClient.passkey.deletePasskey({ id: passkey.id })
                if (result.error) throw new Error(t.passkeyRemoveFailed)
                await refresh()
                toast.success(t.passkeyRemoved)
              })
            }
          >
            {busy === passkey.id ? t.removing : t.remove}
          </Button>
        </SettingsRow>
      ))}
    </>
  )
}

/** The authenticator app's otpauth:// link as a QR code: dark on white, also in dark mode. */
function QrCode({ value, label }: { value: string; label: string }) {
  const path = useMemo(() => {
    const { data } = encode(value, { border: 0 })
    let d = ""
    data.forEach((row, y) => row.forEach((dark, x) => dark && (d += `M${x} ${y}h1v1h-1z`)))
    return { d, size: data.length }
  }, [value])
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`-2 -2 ${path.size + 4} ${path.size + 4}`}
      className="size-44 shrink-0 rounded-md bg-white"
      shapeRendering="crispEdges"
    >
      <path d={path.d} fill="#000" />
    </svg>
  )
}

function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t: all } = useI18n()
  const t = all.account
  const text = codes.join("\n")
  return (
    <div className="flex flex-col gap-4 rounded-lg bg-muted/50 p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{t.backupCodesTitle}</p>
        <p className="text-sm text-muted-foreground">{t.backupCodesHelp}</p>
      </div>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-sm tabular-nums">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            void navigator.clipboard.writeText(text).then(
              () => toast.success(t.codesCopied),
              () => toast.error(all.common.failed)
            )
          }
        >
          {icon(Copy01Icon)}
          {t.copyCodes}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const link = document.createElement("a")
            link.href = URL.createObjectURL(new Blob([`${t.backupCodesFile}\n\n${text}\n`], { type: "text/plain" }))
            link.download = "even-backup-codes.txt"
            link.click()
            URL.revokeObjectURL(link.href)
          }}
        >
          {icon(Download04Icon)}
          {t.downloadCodes}
        </Button>
        <Button type="button" size="sm" onClick={onDone}>
          {t.done}
        </Button>
      </div>
    </div>
  )
}

/** Turning on: password, then the QR code and a first code, then the backup codes. */
type TwoFactorFlow =
  | { step: "password"; action: "enable" | "disable" | "codes" }
  | { step: "scan"; uri: string; codes: string[] }
  | { step: "codes"; codes: string[] }

function TwoFactor({ enabled, hasPassword }: { enabled: boolean; hasPassword: boolean }) {
  const { t: all } = useI18n()
  const t = all.account
  const { busy, perform } = useBusy()
  const [flow, setFlow] = useState<TwoFactorFlow | null>(null)
  const [error, setError] = useState("")
  const [code, setCode] = useState("")
  const scanFormRef = useRef<HTMLFormElement>(null)
  const close = () => {
    setFlow(null)
    setCode("")
    setError("")
  }
  const start = (action: "enable" | "disable" | "codes") => {
    setError("")
    setFlow({ step: "password", action })
  }
  const secret = flow?.step === "scan" ? new URL(flow.uri).searchParams.get("secret") ?? "" : ""

  const passwordForm = flow?.step === "password" && (
    <form
      className="flex flex-col gap-4 rounded-lg bg-muted/50 p-4"
      onSubmit={(event) => {
        event.preventDefault()
        const password = String(new FormData(event.currentTarget).get("password") ?? "")
        setError("")
        void perform("password", async () => {
          if (flow.action === "enable") {
            const result = await authClient.twoFactor.enable({ password })
            if (result.error) return setError(securityError(all, result.error.code))
            if (result.data.method !== "totp") throw new Error()
            setFlow({ step: "scan", uri: result.data.totpURI, codes: result.data.backupCodes })
          } else if (flow.action === "codes") {
            const result = await authClient.twoFactor.generateBackupCodes({ password })
            if (result.error) return setError(securityError(all, result.error.code))
            setFlow({ step: "codes", codes: result.data.backupCodes })
          } else {
            const result = await authClient.twoFactor.disable({ password })
            if (result.error) return setError(securityError(all, result.error.code))
            toast.success(t.twoFactorDisabled)
            close()
          }
        })
      }}
    >
      <Field data-invalid={!!error}>
        <FieldLabel htmlFor="two-factor-password">{t.currentPassword}</FieldLabel>
        <Input
          id="two-factor-password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          disabled={!!busy}
          aria-invalid={!!error}
        />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={!!busy} onClick={close}>
          {all.common.cancel}
        </Button>
        <Button type="submit" variant={flow.action === "disable" ? "destructive" : "default"} disabled={!!busy}>
          {busy ? t.checking : flow.action === "disable" ? t.turnOff : t.continue}
        </Button>
      </div>
    </form>
  )

  const scanForm = flow?.step === "scan" && (
    <form
      ref={scanFormRef}
      className="flex flex-col gap-4 rounded-lg bg-muted/50 p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (code.length < 6) return
        setError("")
        void perform("verify", async () => {
          const result = await authClient.twoFactor.verifyTotp({ code })
          if (result.error) {
            setCode("")
            return setError(securityError(all, result.error.code))
          }
          toast.success(t.twoFactorEnabled)
          setFlow({ step: "codes", codes: flow.codes })
        })
      }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <QrCode value={flow.uri} label={t.scanTitle} />
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm font-medium">{t.scanTitle}</p>
          <p className="text-sm text-muted-foreground">{t.scanHelp}</p>
          <code className="rounded bg-background px-2 py-1 font-mono text-xs break-all select-all">{secret}</code>
        </div>
      </div>
      <Field data-invalid={!!error}>
        <FieldLabel htmlFor="two-factor-code">{t.enterCode}</FieldLabel>
        <div className="sm:w-72">
          <CodeInput
            id="two-factor-code"
            value={code}
            onChange={(value) => {
              setCode(value)
              if (value) setError("")
            }}
            onComplete={() => scanFormRef.current?.requestSubmit()}
            disabled={!!busy}
            invalid={!!error}
          />
        </div>
      </Field>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={!!busy} onClick={close}>
          {all.common.cancel}
        </Button>
        <Button type="submit" disabled={!!busy}>
          {busy === "verify" ? t.checking : t.turnOn}
        </Button>
      </div>
    </form>
  )

  return (
    <SettingsRow
      title={t.twoFactor}
      description={!hasPassword ? t.twoFactorNeedsPassword : enabled ? t.twoFactorOn : t.twoFactorHelp}
      footer={
        passwordForm ||
        scanForm ||
        (flow?.step === "codes" && <BackupCodes codes={flow.codes} onDone={close} />) ||
        (enabled && !flow && hasPassword && (
          <p className="text-sm text-muted-foreground">
            {t.lostBackupCodes}{" "}
            <button type="button" className="form-link" onClick={() => start("codes")}>
              {t.newBackupCodes}
            </button>
          </p>
        ))
      }
    >
      {hasPassword && !flow && (
        <Button variant="outline" size="sm" onClick={() => start(enabled ? "disable" : "enable")}>
          {enabled ? t.turnOff : t.turnOn}
        </Button>
      )}
    </SettingsRow>
  )
}

/** Back from Google, Microsoft or Apple after linking: say how it went, once. */
function useLinkResult() {
  const t = useI18n().t.account
  const queryClient = useQueryClient()
  useEffect(() => {
    const url = new URL(window.location.href)
    const linked = url.searchParams.get("linked") as SocialProvider | null
    if (!linked) return
    const error = url.searchParams.get("error")
    if (!error) toast.success(t.linked(PROVIDER_NAMES[linked] ?? linked))
    else if (error === "account_already_linked_to_different_user") toast.error(t.linkTaken)
    else toast.error(t.linkFailed)
    for (const name of ["linked", "error", "error_description"]) url.searchParams.delete(name)
    window.history.replaceState(null, "", url)
    void queryClient.invalidateQueries({ queryKey: ACCOUNTS })
  }, [queryClient, t])
}

function ConnectedAccounts() {
  const { t: all, language } = useI18n()
  const t = all.account
  const queryClient = useQueryClient()
  const { busy, perform } = useBusy()
  const providers = useSocialProviders(authClient, true)
  const accounts = useAccounts()
  useLinkResult()
  if (!providers.length) return null
  // The last way in can't be removed.
  const lastOne = (accounts.data?.length ?? 0) <= 1
  const since = (date: Date | string) =>
    new Date(date).toLocaleDateString(language, { day: "numeric", month: "long", year: "numeric" })
  return (
    <SettingsSection title={t.connected} description={t.connectedHelp}>
      {providers.map((provider) => {
        const account = accounts.data?.find((item) => item.providerId === provider)
        const name = PROVIDER_NAMES[provider]
        return (
          <SettingsRow
            key={provider}
            title={
              <span className="flex items-center gap-2.5">
                <ProviderLogo provider={provider} />
                {name}
              </span>
            }
            description={account ? t.connectedSince(since(account.createdAt)) : t.notConnected}
          >
            {account ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!!busy || lastOne}
                title={lastOne ? t.lastSignInMethod : undefined}
                onClick={() =>
                  void perform(provider, async () => {
                    // Better Auth's own id for the account, not the provider's.
                    const result = await authClient.unlinkAccount({ accountId: account.id })
                    if (result.error?.code === "SESSION_EXPIRED") throw new Error(t.unlinkSignInAgain)
                    if (result.error) throw new Error(t.unlinkFailed)
                    await queryClient.invalidateQueries({ queryKey: ACCOUNTS })
                    toast.success(t.unlinked(name))
                  })
                }
              >
                {busy === provider ? t.unlinking : t.unlink}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={!!busy}
                onClick={() =>
                  void perform(provider, async () => {
                    const back = webUrl(`/account?linked=${provider}`)
                    const result = await authClient.linkSocial({ provider, callbackURL: back, errorCallbackURL: back })
                    if (result.error) throw new Error(t.linkFailed)
                    // On its way to the provider; the button stays busy until the page leaves.
                    await new Promise(() => {})
                  })
                }
              >
                {busy === provider ? t.linking : t.link}
              </Button>
            )}
          </SettingsRow>
        )
      })}
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
      className="flex flex-col gap-4 rounded-lg bg-muted/50 p-4"
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
      if (result.error) throw new Error(result.error.code ?? "")
      return [...result.data].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
    },
    retry: false,
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
  // Better Auth lists devices only for a session signed in within the last day.
  const notFresh = sessions.error?.message === "SESSION_NOT_FRESH"
  return (
    <SettingsSection title={t.sessions} description={t.sessionsHelp}>
      {sessions.isPending && <SettingsRow title={t.loadingSessions} />}
      {sessions.isError && (
        <SettingsRow
          title={notFresh ? t.confirmTitle : all.common.failed}
          description={notFresh ? t.confirmDescription : undefined}
        >
          {notFresh ? (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await authClient.signOut()
                window.location.assign("/login?returnTo=%2Faccount")
              }}
            >
              {t.signInAgain}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => void sessions.refetch()}>
              {t.retry}
            </Button>
          )}
        </SettingsRow>
      )}
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
  // Someone who only signs in with Google, Microsoft or Apple has no password to confirm with.
  const accounts = useAccounts()
  const hasPassword = !accounts.data || accounts.data.some((account) => account.providerId === "credential")
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
              if ((hasPassword && !password) || pending) return
              setPending(true)
              setError("")
              try {
                // Without a password, the API asks for a session started in the last day.
                const result = await authClient.deleteUser(hasPassword ? { password } : {})
                if (result.error?.code === "SESSION_EXPIRED") {
                  setError(t.deleteSignInAgain)
                  setPending(false)
                  return
                }
                if (result.error) throw new Error()
                toast.success(t.deleted)
                window.location.assign("/login")
              } catch {
                setError(t.deleteFailed)
                setPending(false)
              }
            }}
          >
            {hasPassword && (
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
            )}
            {error && (
              <p id="delete-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={pending}>
                {all.common.cancel}
              </AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={pending || (hasPassword && !password)}>
                {pending ? t.deleting : t.deletePermanently}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
