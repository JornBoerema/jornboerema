import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { SettingsRow, SettingsSection } from "@evido/ui/components/settings-dialog"
import { Switch } from "@evido/ui/components/switch"
import type { MailAccountView, MailSignature } from "@evido/mail-core/types"
import { useI18n } from "@/i18n"
import { api } from "@/lib/api"
import { ACCOUNTS_KEY, useAccounts } from "@/lib/mail"

const RichTextEditor = lazy(() => import("@/components/rich-text-editor"))

/** Typing pauses this long before the signature is saved. */
const SAVE_DELAY_MS = 800

function useSaveSignature(account: MailAccountView) {
  const t = useI18n().t.signatures
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (signature: Partial<MailSignature>) =>
      api(`/api/mail/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature }),
      }),
    onMutate: (signature) => {
      queryClient.setQueryData<{ accounts: MailAccountView[] }>(
        ACCOUNTS_KEY,
        (data) =>
          data && {
            accounts: data.accounts.map((item) =>
              item.id === account.id ? { ...item, signature: { ...item.signature, ...signature } } : item
            ),
          }
      )
    },
    onError: () => {
      toast.error(t.saveFailed)
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY })
    },
  })
}

function AccountSignature({ account }: { account: MailAccountView }) {
  const t = useI18n().t.signatures
  const save = useSaveSignature(account)
  const { mutate } = save
  const timer = useRef<number | undefined>(undefined)
  const pending = useRef<string | null>(null)
  // The editor reports its starting content once; that isn't an edit.
  const started = useRef(false)
  // The editor owns the content after it starts.
  const [initialHtml] = useState(account.signature.html)
  const editorId = `signature-${account.id}`

  // Leaving the page keeps what was typed.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      if (pending.current !== null) mutate({ html: pending.current })
    },
    [mutate]
  )

  return (
    <SettingsSection title={account.email}>
      <SettingsRow
        title={t.signature}
        description={t.signatureHelp}
        footer={
          <div className="rounded-lg border" id={editorId}>
            <Suspense fallback={<div className="min-h-28" />}>
              <RichTextEditor
                label={`${t.signature} ${account.email}`}
                placeholder={t.placeholder}
                className="is-signature min-h-28"
                initialHtml={initialHtml}
                onChange={(value) => {
                  if (!started.current) {
                    started.current = true
                    return
                  }
                  pending.current = value.text ? value.html : ""
                  window.clearTimeout(timer.current)
                  timer.current = window.setTimeout(() => {
                    if (pending.current === null) return
                    mutate({ html: pending.current })
                    pending.current = null
                  }, SAVE_DELAY_MS)
                }}
              />
            </Suspense>
          </div>
        }
      />
      <SettingsRow title={t.forNew} htmlFor={`${editorId}-new`} description={t.forNewHelp}>
        <Switch
          id={`${editorId}-new`}
          checked={account.signature.forNew}
          onCheckedChange={(forNew) => mutate({ forNew })}
        />
      </SettingsRow>
      <SettingsRow title={t.forReplies} htmlFor={`${editorId}-replies`} description={t.forRepliesHelp}>
        <Switch
          id={`${editorId}-replies`}
          checked={account.signature.forReplies}
          onCheckedChange={(forReplies) => mutate({ forReplies })}
        />
      </SettingsRow>
    </SettingsSection>
  )
}

export function SignatureSettings() {
  const t = useI18n().t.signatures
  const accounts = useAccounts().data?.accounts.filter((account) => account.status === "active") ?? []
  return (
    <div className="flex flex-col gap-8">
      <p className="px-1 text-sm text-muted-foreground">{accounts.length ? t.description : t.noMailboxes}</p>
      {accounts.map((account) => (
        <AccountSignature key={account.id} account={account} />
      ))}
    </div>
  )
}
