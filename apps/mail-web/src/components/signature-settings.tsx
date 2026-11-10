import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Add01Icon, ArrowLeft01Icon, ArrowRight01Icon, Delete02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@evido/ui/components/alert-dialog"
import { Button } from "@evido/ui/components/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@evido/ui/components/select"
import { SettingsRow, SettingsSection } from "@evido/ui/components/settings-dialog"
import { cn } from "@evido/ui/lib/utils"
import type { MailAccountView, MailSignature } from "@evido/mail-core/types"
import { AccountDot } from "@/components/account-dot"
import { useI18n } from "@/i18n"
import { api, errorText } from "@/lib/api"
import { ACCOUNTS_KEY, useAccounts } from "@/lib/mail"
import { SIGNATURES_KEY, useSignatures } from "@/lib/signatures"

const RichTextEditor = lazy(() => import("@/components/rich-text-editor"))

/** Typing pauses this long before a change is saved. */
const SAVE_DELAY_MS = 800
/** Not a signature id, which are UUIDs. */
const NONE = "none"

type SignatureList = { signatures: MailSignature[] }
type AccountList = { accounts: MailAccountView[] }
type Choice = { signatureNewId?: string | null; signatureReplyId?: string | null }

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})

/** Saves the latest value after a pause in typing, and on leaving the page. */
function useDebouncedSave<T>(save: (value: T) => void) {
  const timer = useRef<number | undefined>(undefined)
  const pending = useRef<{ value: T } | null>(null)
  const latestSave = useRef(save)
  useEffect(() => {
    latestSave.current = save
  })
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      if (pending.current) latestSave.current(pending.current.value)
    },
    []
  )
  return (value: T) => {
    pending.current = { value }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      if (pending.current) latestSave.current(pending.current.value)
      pending.current = null
    }, SAVE_DELAY_MS)
  }
}

/** The signature as one line of text, for the list. Parsed inertly: nothing loads or runs. */
function previewOf(html: string) {
  const body = new DOMParser().parseFromString(html, "text/html").body
  body.querySelectorAll("p, div, li, br").forEach((element) => element.after(" · "))
  return (body.textContent ?? "").replace(/(\s*·\s*)+/g, " · ").replace(/^ · | · $/g, "").trim()
}

function SignatureEditor({ signature, onBack }: { signature: MailSignature; onBack: () => void }) {
  const t = useI18n().t.signatures
  const queryClient = useQueryClient()
  const [name, setName] = useState(signature.name)
  // The editor owns the content after it starts, and reports it once on starting.
  const [initialHtml] = useState(signature.html)
  const started = useRef(false)

  const update = useMutation({
    mutationFn: (change: Partial<Pick<MailSignature, "name" | "html">>) =>
      api(`/api/mail/signatures/${signature.id}`, json("PATCH", change)),
    onMutate: (change) =>
      queryClient.setQueryData<SignatureList>(
        SIGNATURES_KEY,
        (data) =>
          data && {
            signatures: data.signatures.map((item) => (item.id === signature.id ? { ...item, ...change } : item)),
          }
      ),
    onError: () => {
      toast.error(t.saveFailed)
      void queryClient.invalidateQueries({ queryKey: SIGNATURES_KEY })
    },
  })
  const remove = useMutation({
    mutationFn: () => api(`/api/mail/signatures/${signature.id}`, { method: "DELETE" }),
    onSuccess: () => {
      onBack()
      // Mailboxes that used it now have none.
      void queryClient.invalidateQueries({ queryKey: SIGNATURES_KEY })
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY })
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const saveName = useDebouncedSave((value: string) => update.mutate({ name: value }))
  const saveHtml = useDebouncedSave((value: string) => update.mutate({ html: value }))
  const label = name.trim() || signature.name

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={onBack}>
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} data-icon="inline-start" aria-hidden="true" />
          {t.back}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto text-muted-foreground"
              aria-label={t.delete}
              title={t.delete}
              disabled={remove.isPending}
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.deleteTitle(label)}</AlertDialogTitle>
              <AlertDialogDescription>{t.deleteBody}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>
                {t.confirmDelete}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {/* The name is the page's title, edited in place; the editor is the only surface. */}
      <input
        aria-label={t.name}
        className="-mx-1 rounded-md bg-transparent px-1 text-lg font-semibold tracking-tight outline-none placeholder:text-muted-foreground hover:bg-muted/40 focus-visible:bg-muted/40"
        value={name}
        maxLength={100}
        placeholder={t.name}
        onChange={(event) => {
          setName(event.target.value)
          if (event.target.value.trim()) saveName(event.target.value.trim())
        }}
      />
      <div className="rounded-2xl bg-card ring-1 ring-border">
        <Suspense fallback={<div className="min-h-48" />}>
          <RichTextEditor
            autoFocus
            label={t.content(label)}
            placeholder={t.placeholder}
            className="is-signature min-h-48"
            initialHtml={initialHtml}
            imagesAsFiles={false}
            onChange={(value) => {
              if (!started.current) {
                started.current = true
                return
              }
              saveHtml(value.html)
            }}
          />
        </Suspense>
      </div>
    </div>
  )
}

function SignatureRow({
  signature,
  usedBy,
  onOpen,
}: {
  signature: MailSignature
  usedBy: number
  onOpen: () => void
}) {
  const t = useI18n().t.signatures
  const preview = previewOf(signature.html)
  return (
    <button
      type="button"
      className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
      onClick={onOpen}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{signature.name}</span>
        <span className="truncate text-sm text-muted-foreground">{preview || t.emptyPreview}</span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground max-sm:hidden">{t.usedBy(usedBy)}</span>
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        strokeWidth={2}
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </button>
  )
}

/** One line per mailbox, with the choices in columns; stacked on narrow screens. */
const MAILBOX_GRID = "grid items-center gap-3 px-5 sm:grid-cols-[minmax(0,1fr)_10.5rem_10.5rem]"

function SignatureChoice({
  id,
  label,
  value,
  signatures,
  onChange,
}: {
  id: string
  label: string
  value: string | null
  signatures: MailSignature[]
  onChange: (id: string | null) => void
}) {
  const t = useI18n().t.signatures
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {/* The table's column heads name these on wider screens; stacked, each says it itself. */}
      <label htmlFor={id} className="text-xs text-muted-foreground sm:sr-only">
        {label}
      </label>
      <Select value={value ?? NONE} onValueChange={(next) => onChange(next === NONE ? null : next)}>
        {/* Quiet like the sender choice in a new message: text and chevron, a surface on hover. */}
        <SelectTrigger
          id={id}
          size="sm"
          className={cn(
            "-ml-3 max-w-full bg-transparent hover:bg-accent sm:max-w-[calc(100%+0.75rem)]",
            value === null && "text-muted-foreground"
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={NONE}>{t.none}</SelectItem>
            {signatures.map((signature) => (
              <SelectItem key={signature.id} value={signature.id}>
                {signature.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

function MailboxSignatures({ account, signatures }: { account: MailAccountView; signatures: MailSignature[] }) {
  const t = useI18n().t.signatures
  const queryClient = useQueryClient()
  const choose = useMutation({
    mutationFn: (change: Choice) => api(`/api/mail/accounts/${account.id}`, json("PATCH", change)),
    onMutate: (change) =>
      queryClient.setQueryData<AccountList>(
        ACCOUNTS_KEY,
        (data) =>
          data && {
            accounts: data.accounts.map((item) =>
              item.id === account.id
                ? {
                    ...item,
                    signatures: {
                      newId: change.signatureNewId === undefined ? item.signatures.newId : change.signatureNewId,
                      replyId:
                        change.signatureReplyId === undefined ? item.signatures.replyId : change.signatureReplyId,
                    },
                  }
                : item
            ),
          }
      ),
    onError: (error) => {
      toast.error(errorText(error))
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY })
    },
  })
  return (
    <div className={`${MAILBOX_GRID} py-2.5`}>
      <p className="flex min-w-0 items-center gap-2 text-sm">
        <AccountDot color={account.color} />
        <span className="truncate">{account.email}</span>
      </p>
      <SignatureChoice
        id={`signature-new-${account.id}`}
        label={t.forNew}
        value={account.signatures?.newId ?? null}
        signatures={signatures}
        onChange={(signatureNewId) => choose.mutate({ signatureNewId })}
      />
      <SignatureChoice
        id={`signature-reply-${account.id}`}
        label={t.forReplies}
        value={account.signatures?.replyId ?? null}
        signatures={signatures}
        onChange={(signatureReplyId) => choose.mutate({ signatureReplyId })}
      />
    </div>
  )
}

export function SignatureSettings() {
  const t = useI18n().t.signatures
  const queryClient = useQueryClient()
  const signatures = useSignatures().data?.signatures ?? []
  const accounts = useAccounts().data?.accounts.filter((account) => account.status === "active") ?? []
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = signatures.find((signature) => signature.id === editingId)
  const create = useMutation({
    mutationFn: () =>
      api<MailSignature>("/api/mail/signatures", json("POST", { name: t.defaultName(signatures.length + 1), html: "" })),
    onSuccess: (created) => {
      queryClient.setQueryData<SignatureList>(
        SIGNATURES_KEY,
        (data) => data && { signatures: [...data.signatures, created] }
      )
      setEditingId(created.id)
    },
    onError: (error) => toast.error(errorText(error)),
  })

  if (editing) return <SignatureEditor key={editing.id} signature={editing} onBack={() => setEditingId(null)} />

  const usedBy = (id: string) =>
    accounts.filter((account) => account.signatures?.newId === id || account.signatures?.replyId === id).length

  return (
    <div className="flex flex-col gap-8">
      <SettingsSection title={t.title} description={t.description}>
        {signatures.length === 0 && <p className="px-5 py-4 text-sm text-muted-foreground">{t.empty}</p>}
        {signatures.map((signature) => (
          <SignatureRow
            key={signature.id}
            signature={signature}
            usedBy={usedBy(signature.id)}
            onOpen={() => setEditingId(signature.id)}
          />
        ))}
        <div className="px-3 py-2">
          <Button variant="ghost" size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} data-icon="inline-start" aria-hidden="true" />
            {t.add}
          </Button>
        </div>
      </SettingsSection>
      <SettingsSection title={t.defaults} description={t.defaultsHelp}>
        {accounts.length === 0 ? (
          <SettingsRow title={t.noMailboxes} />
        ) : (
          <>
            <div className={`${MAILBOX_GRID} py-2.5 text-xs text-muted-foreground max-sm:hidden`} aria-hidden="true">
              <span>{t.mailbox}</span>
              <span>{t.forNew}</span>
              <span>{t.forReplies}</span>
            </div>
            {accounts.map((account) => (
              <MailboxSignatures key={account.id} account={account} signatures={signatures} />
            ))}
          </>
        )}
      </SettingsSection>
    </div>
  )
}
