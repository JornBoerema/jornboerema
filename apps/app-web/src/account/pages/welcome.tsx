import { useState, type KeyboardEvent, type ReactNode } from "react"
import { useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Cancel01Icon, CheckmarkCircle02Icon, Loading03Icon, Mail01Icon, UserGroupIcon, UserIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { appUrl } from "@even/auth/client"
import { Alert, AlertDescription } from "@even/ui/components/alert"
import { Button } from "@even/ui/components/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@even/ui/components/field"
import { Input } from "@even/ui/components/input"
import { ProviderLogo } from "@even/ui/components/social-providers"
import { Textarea } from "@even/ui/components/textarea"
import { cn } from "@even/ui/lib/utils"
import { RequireSession } from "@/account/components/require-session"
import { useI18n } from "@/account/i18n"
import { api } from "@/account/lib/api"
import { authClient } from "@/account/lib/auth-client"
import { useTitle } from "@/account/lib/use-title"

type Step = "mailbox" | "details" | "team" | "done"
type Provider = "outlook" | "gmail"
type ErrorCode = "denied" | "expired" | "session" | "missing_scope" | "admin_consent" | "failed"
type Access = { access: boolean; requested: boolean; needsPlan?: boolean }
type Mailbox = { id: string; provider: Provider; email: string; displayName: string | null }
type Organization = { id: string; personal: boolean }

const ERROR_CODES: ErrorCode[] = ["denied", "expired", "session", "missing_scope", "admin_consent", "failed"]
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Where to go once done: the page that sent people here, or the mail app. */
function target(next: string | null) {
  if (next && next.startsWith("/") && !next.startsWith("//") && next !== "/" && !next.startsWith("/welcome")) return next
  return appUrl("mail")
}

/** A plain-text signature as the HTML the mail app keeps: escaped, one line per line. */
function signatureHtml(text: string) {
  const escape = (line: string) =>
    line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  return text
    .trim()
    .split("\n")
    .map((line) => `<div>${escape(line) || "<br>"}</div>`)
    .join("")
}

/**
 * The first-run steps for a new account: connect a mailbox, a name and a
 * signature, alone or with a team. Every step can be skipped; finishing or
 * skipping marks the account, so it opens straight in the apps from then on.
 */
export function WelcomePage() {
  const t = useI18n().t.welcome
  useTitle(t.pageTitle)
  return <RequireSession>{(session) => <Welcome name={session.user.name} />}</RequireSession>
}

function Welcome({ name }: { name: string }) {
  const { t: all, locale } = useI18n()
  const t = all.welcome
  const [params, setParams] = useSearchParams()
  const [step, setStep] = useState<Step | null>(() => {
    const asked = params.get("step") as Step | null
    if (asked && ["mailbox", "details", "team", "done"].includes(asked)) return asked
    // Back from the provider with a mailbox: on to the next step.
    return params.has("connected") ? "details" : null
  })
  const [error] = useState(() => {
    const code = params.get("error") as ErrorCode | null
    return code && ERROR_CODES.includes(code) ? code : null
  })
  const [leaving, setLeaving] = useState(false)

  const mailAccess = useQuery({ queryKey: ["welcome", "access"], queryFn: () => api<Access>("/api/access/mail") })
  const mailboxes = useQuery({
    queryKey: ["welcome", "mailboxes"],
    queryFn: () => api<{ accounts: Mailbox[] }>("/api/mail/accounts").then((data) => data.accounts),
  })
  const organizations = useQuery({
    queryKey: ["welcome", "organizations"],
    queryFn: () => api<Organization[]>("/api/workspaces", { language: locale }),
  })

  if (mailAccess.isPending || mailboxes.isPending || organizations.isPending)
    return (
      <section className="auth-form items-center">
        <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="size-6 animate-spin text-muted-foreground" />
      </section>
    )

  // A failed check lets them try anyway: the API refuses outsiders itself.
  const canMail = mailAccess.data?.access ?? mailAccess.isError
  const inTeam = organizations.data?.some((organization) => !organization.personal) ?? false
  const steps: Step[] = [...(canMail ? (["mailbox"] as const) : []), "details", ...(inTeam ? [] : (["team"] as const)), "done"]
  const current = step && steps.includes(step) ? step : steps[0]
  const index = steps.indexOf(current)
  const accounts = mailboxes.data ?? []

  function go(next: Step) {
    setStep(next)
    // The provider's answer is shown once; going on leaves it behind.
    const back = params.get("next")
    setParams(back ? { step: next, next: back } : { step: next }, { replace: true })
  }
  const forward = () => go(steps[index + 1] ?? "done")

  async function finish() {
    setLeaving(true)
    try {
      await api("/api/onboarding/done", { method: "POST" })
    } catch {
      // Not marked: the steps come back next time, which is no worse than staying here.
    }
    window.location.assign(target(params.get("next")))
  }

  let body: ReactNode
  if (current === "mailbox") body = <MailboxStep accounts={accounts} error={error} onNext={forward} />
  else if (current === "details")
    body = <DetailsStep name={name || accounts[0]?.displayName || ""} accounts={accounts} onNext={forward} />
  else if (current === "team") body = <TeamStep onNext={forward} />
  else
    body = (
      <DoneStep
        access={mailAccess.data}
        hasMailbox={accounts.length > 0}
        leaving={leaving}
        onFinish={() => void finish()}
      />
    )

  return (
    <section className="auth-form welcome">
      <div className="welcome-progress" aria-label={t.progress(index + 1, steps.length)}>
        {steps.map((item, position) => (
          <span key={item} data-state={position < index ? "done" : position === index ? "current" : "todo"} />
        ))}
      </div>
      {body}
      {current !== "done" && (
        <button type="button" className="welcome-skip" disabled={leaving} onClick={() => void finish()}>
          {t.skipAll}
        </button>
      )}
    </section>
  )
}

function StepHeader({ title, description }: { title: string; description: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1>{title}</h1>
      <p className="text-muted-foreground">{description}</p>
    </div>
  )
}

function MailboxStep({ accounts, error, onNext }: { accounts: Mailbox[]; error: ErrorCode | null; onNext: () => void }) {
  const { t: all, locale } = useI18n()
  const t = all.welcome
  const queryClient = useQueryClient()
  const gmail = useQuery({ queryKey: ["welcome", "gmail"], queryFn: () => api<Access>("/api/access/gmail") })
  const connect = useMutation({
    mutationFn: (provider: Provider) =>
      api<{ url: string }>(`/api/mail/connect/${provider}`, {
        method: "POST",
        json: { returnTo: "welcome" },
        language: locale,
      }),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (failure) => toast.error(failure.message || all.common.noConnection),
  })
  const ask = useMutation({
    mutationFn: () => api<Access>("/api/access/gmail/request", { method: "POST", language: locale }),
    onSuccess: (data) => queryClient.setQueryData(["welcome", "gmail"], data),
    onError: (failure) => toast.error(failure.message || all.common.noConnection),
  })
  const adminLink = useMutation({
    mutationFn: () => api<{ url: string | null }>("/api/mail/outlook/admin-consent", { language: locale }),
    onSuccess: async ({ url }) => {
      if (!url) return
      await navigator.clipboard.writeText(url)
      toast.success(t.adminCopied)
    },
    onError: (failure) => toast.error(failure.message || all.common.noConnection),
  })
  // Unknown (loading or failed): offer it; the API refuses outsiders itself.
  const gmailLocked = gmail.data?.access === false
  const busy = connect.isPending || connect.isSuccess

  return (
    <>
      <StepHeader title={accounts.length ? t.mailbox.titleMore : t.mailbox.title} description={t.mailbox.description} />
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex flex-col items-start gap-3">
            {t.errors[error]}
            {error === "admin_consent" && (
              <Button size="sm" variant="outline" disabled={adminLink.isPending} onClick={() => adminLink.mutate()}>
                {t.adminCopy}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {accounts.length > 0 && (
        <ul className="welcome-mailboxes">
          {accounts.map((account) => (
            <li key={account.id}>
              <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={1.75} className="size-4.5 text-primary" />
              <span className="truncate">{account.email}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-3">
        <Button variant="outline" disabled={busy} onClick={() => connect.mutate("outlook")}>
          <ProviderLogo provider="microsoft" />
          {t.mailbox.outlook}
        </Button>
        <Button variant="outline" disabled={busy || gmailLocked} onClick={() => connect.mutate("gmail")}>
          <ProviderLogo provider="google" />
          {t.mailbox.gmail}
        </Button>
        {gmailLocked && (
          <p className="text-sm text-muted-foreground">
            {gmail.data?.requested ? (
              t.mailbox.gmailRequested
            ) : (
              <>
                {t.mailbox.gmailInvite}{" "}
                <button
                  type="button"
                  className="form-link"
                  disabled={ask.isPending}
                  onClick={() => ask.mutate()}
                >
                  {t.mailbox.gmailAsk}
                </button>
              </>
            )}
          </p>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{t.mailbox.privacy}</p>
      {accounts.length > 0 ? (
        <Button onClick={onNext}>{all.welcome.next}</Button>
      ) : (
        <Button variant="ghost" onClick={onNext}>
          {t.mailbox.later}
        </Button>
      )}
    </>
  )
}

function DetailsStep({ name: initial, accounts, onNext }: { name: string; accounts: Mailbox[]; onNext: () => void }) {
  const { t: all, locale } = useI18n()
  const t = all.welcome.details
  const [name, setName] = useState(initial)
  const [signature, setSignature] = useState("")
  const signatures = useQuery({
    queryKey: ["welcome", "signatures"],
    queryFn: () => api<{ signatures: unknown[] }>("/api/mail/signatures").then((data) => data.signatures),
    enabled: accounts.length > 0,
  })
  // A signature only means something with a mailbox, and only the first time.
  const asksSignature = accounts.length > 0 && signatures.data?.length === 0
  const save = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim()
      if (trimmed && trimmed !== initial) {
        const result = await authClient.updateUser({ name: trimmed })
        if (result.error) throw new Error(result.error.message)
      }
      if (asksSignature && signature.trim()) {
        const created = await api<{ id: string }>("/api/mail/signatures", {
          method: "POST",
          json: { name: t.signatureName, html: signatureHtml(signature) },
          language: locale,
        })
        for (const account of accounts)
          await api(`/api/mail/accounts/${account.id}`, {
            method: "PATCH",
            json: { signatureNewId: created.id, signatureReplyId: created.id },
            language: locale,
          })
      }
    },
    onSuccess: onNext,
    onError: (failure) => toast.error(failure.message || all.common.noConnection),
  })

  return (
    <>
      <StepHeader title={t.title} description={t.description} />
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="welcome-name">{t.name}</FieldLabel>
            <Input
              id="welcome-name"
              value={name}
              autoComplete="name"
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {asksSignature && (
            <Field>
              <FieldLabel htmlFor="welcome-signature">{t.signature}</FieldLabel>
              <Textarea
                id="welcome-signature"
                rows={4}
                value={signature}
                placeholder={t.signaturePlaceholder(name.trim() || initial)}
                onChange={(event) => setSignature(event.target.value)}
              />
              <FieldDescription>{t.signatureHelp}</FieldDescription>
            </Field>
          )}
        </FieldGroup>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && (
            <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="animate-spin" data-icon="inline-start" />
          )}
          {all.welcome.next}
        </Button>
      </form>
    </>
  )
}

function TeamStep({ onNext }: { onNext: () => void }) {
  const { t: all, locale } = useI18n()
  const t = all.welcome.team
  const [choice, setChoice] = useState<"alone" | "team" | null>(null)
  const [name, setName] = useState("")
  const [emails, setEmails] = useState<string[]>([])
  const [draft, setDraft] = useState("")
  // What is still being typed counts too, so nobody loses the last address by not pressing Enter.
  const addresses = [...new Set([...emails, ...splitEmails(draft)])]
  const invalid = addresses.filter((email) => !EMAIL.test(email))

  const create = useMutation({
    mutationFn: async () => {
      const id = crypto.randomUUID()
      await api("/api/workspaces", { method: "POST", json: { type: "create", id, name: name.trim() }, language: locale })
      let failed = 0
      for (const email of addresses)
        await api("/api/workspaces", {
          method: "POST",
          json: { type: "invite", workspaceId: id, email, role: "member" },
          language: locale,
        }).catch(() => failed++)
      if (failed) toast.error(t.inviteFailed(failed))
      else if (addresses.length) toast.success(t.invited(addresses.length))
    },
    onSuccess: onNext,
    onError: (failure) => toast.error(failure.message || all.common.noConnection),
  })

  const options = [
    { id: "alone" as const, icon: UserIcon, title: t.alone, description: t.aloneHelp },
    { id: "team" as const, icon: UserGroupIcon, title: t.withTeam, description: t.withTeamHelp },
  ]

  return (
    <>
      <StepHeader title={t.title} description={t.description} />
      <div className="welcome-choices" role="radiogroup" aria-label={t.title}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={choice === option.id}
            className={cn("welcome-choice", choice === option.id && "is-selected")}
            onClick={() => setChoice(option.id)}
          >
            <HugeiconsIcon icon={option.icon} strokeWidth={1.75} className="size-5" />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{option.title}</span>
              <span className="text-sm text-muted-foreground">{option.description}</span>
            </span>
          </button>
        ))}
      </div>
      {choice === "team" ? (
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault()
            if (name.trim() && !invalid.length) create.mutate()
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="welcome-team">{t.name}</FieldLabel>
              <Input
                id="welcome-team"
                value={name}
                autoComplete="organization"
                maxLength={60}
                placeholder={t.namePlaceholder}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field data-invalid={invalid.length > 0 || undefined}>
              <FieldLabel htmlFor="welcome-invites">{t.invites}</FieldLabel>
              <EmailChips
                id="welcome-invites"
                emails={emails}
                draft={draft}
                placeholder={t.invitesPlaceholder}
                removeLabel={t.removeInvite}
                onChange={setEmails}
                onDraft={setDraft}
              />
              <FieldDescription>{invalid.length ? t.invalidEmail(invalid[0]!) : t.invitesHelp}</FieldDescription>
            </Field>
          </FieldGroup>
          <Button type="submit" disabled={create.isPending || !name.trim() || invalid.length > 0}>
            {create.isPending && (
              <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="animate-spin" data-icon="inline-start" />
            )}
            {t.create}
          </Button>
        </form>
      ) : (
        <Button disabled={!choice} onClick={onNext}>
          {all.welcome.next}
        </Button>
      )}
    </>
  )
}

const splitEmails = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)

/**
 * Addresses as chips: Enter, a comma, a space or leaving the field turns what
 * was typed into one; a pasted list becomes several. Backspace in an empty
 * field takes the last one back to edit.
 */
function EmailChips({
  id,
  emails,
  draft,
  placeholder,
  removeLabel,
  onChange,
  onDraft,
}: {
  id: string
  emails: string[]
  draft: string
  placeholder: string
  removeLabel: (email: string) => string
  onChange: (emails: string[]) => void
  onDraft: (draft: string) => void
}) {
  function commit(text: string) {
    const added = splitEmails(text).filter((email) => !emails.includes(email))
    if (added.length) onChange([...emails, ...added])
    onDraft("")
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.key === "Enter" || event.key === "," || event.key === ";" || event.key === " ") && draft.trim()) {
      event.preventDefault()
      commit(draft)
    } else if (event.key === "Enter") {
      // An empty field: Enter submits the form as usual.
    } else if (event.key === "Backspace" && !draft && emails.length) {
      event.preventDefault()
      onDraft(emails.at(-1)!)
      onChange(emails.slice(0, -1))
    }
  }

  return (
    <div
      className="welcome-chips"
      onClick={(event) => {
        if (event.target === event.currentTarget) document.getElementById(id)?.focus()
      }}
    >
      {emails.map((email) => (
        <span key={email} className="welcome-chip" data-invalid={!EMAIL.test(email) || undefined}>
          <span className="truncate">{email}</span>
          <button type="button" aria-label={removeLabel(email)} onClick={() => onChange(emails.filter((item) => item !== email))}>
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        type="email"
        inputMode="email"
        autoComplete="off"
        value={draft}
        placeholder={emails.length ? "" : placeholder}
        onChange={(event) => {
          const value = event.target.value
          // A pasted list, or a separator typed inside the text: everything before it becomes chips.
          if (/[\s,;]/.test(value.trim())) {
            const parts = value.split(/[\s,;]+/)
            const rest = /[\s,;]$/.test(value) ? "" : (parts.pop() ?? "")
            commit(parts.join(" "))
            onDraft(rest)
          } else onDraft(value.trimStart())
        }}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && commit(draft)}
      />
    </div>
  )
}

function Key({ children }: { children: ReactNode }) {
  return <kbd className="welcome-key">{children}</kbd>
}

function DoneStep({
  access,
  hasMailbox,
  leaving,
  onFinish,
}: {
  access: Access | undefined
  hasMailbox: boolean
  leaving: boolean
  onFinish: () => void
}) {
  const t = useI18n().t.welcome.done
  const canMail = access?.access ?? true
  const description = !canMail
    ? access?.needsPlan
      ? t.trial
      : t.inviteOnly
    : hasMailbox
      ? t.syncing
      : t.noMailbox

  return (
    <>
      <HugeiconsIcon icon={canMail ? CheckmarkCircle02Icon : Mail01Icon} strokeWidth={1.75} className="size-7 text-primary" />
      <StepHeader title={t.title} description={description} />
      {canMail && hasMailbox && (
        <ul className="welcome-tips">
          <li>
            <span>
              <Key>J</Key>
              <Key>K</Key>
            </span>
            {t.tipMove}
          </li>
          <li>
            <span>
              <Key>E</Key>
            </span>
            {t.tipArchive}
          </li>
          <li>
            <span>
              <Key>B</Key>
            </span>
            {t.tipSnooze}
          </li>
          <li>
            <span>
              <Key>?</Key>
            </span>
            {t.tipAll}
          </li>
        </ul>
      )}
      <Button disabled={leaving} onClick={onFinish}>
        {leaving && <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="animate-spin" data-icon="inline-start" />}
        {t.open}
      </Button>
    </>
  )
}
