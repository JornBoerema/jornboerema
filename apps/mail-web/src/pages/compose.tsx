import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@evido/ui/components/button"
import type { MailAccountView, MailAddress, MailOutgoing } from "@evido/mail-core/types"
import { useI18n } from "@/i18n"
import { api } from "@/lib/api"

const FIELD = "rounded-md border bg-background px-2 py-1"
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/

function parseAddresses(value: string): { addresses: MailAddress[]; invalid: string | null } {
  const parts = value
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
  const invalid = parts.find((part) => !EMAIL.test(part)) ?? null
  return { addresses: parts.map((email) => ({ name: null, email })), invalid }
}

export function ComposePage({
  accounts,
  onClose,
}: {
  accounts: MailAccountView[]
  onClose: () => void
}) {
  const t = useI18n().t.compose
  const usable = accounts.filter((account) => account.status === "active")
  const [accountId, setAccountId] = useState(usable[0]?.id ?? "")
  const [to, setTo] = useState("")
  const [cc, setCc] = useState("")
  const [bcc, setBcc] = useState("")
  const [subject, setSubject] = useState("")
  const [text, setText] = useState("")

  const send = useMutation({
    mutationFn: (message: MailOutgoing) =>
      api(`/api/mail/accounts/${accountId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      }),
    onSuccess: () => {
      toast.success(t.sent)
      onClose()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  })

  function submit() {
    const parsed = [to, cc, bcc].map(parseAddresses)
    const invalid = parsed.find((item) => item.invalid)?.invalid
    if (invalid) return toast.error(t.invalid(invalid))
    const [toList, ccList, bccList] = parsed.map((item) => item.addresses) as [
      MailAddress[],
      MailAddress[],
      MailAddress[],
    ]
    if (toList.length + ccList.length + bccList.length === 0) return toast.error(t.noRecipients)
    send.mutate({ to: toList, cc: ccList, bcc: bccList, subject, text })
  }

  const field = (name: string, value: string, set: (value: string) => void) => (
    <label className="flex flex-col gap-1">
      {name}
      <input className={FIELD} value={value} onChange={(event) => set(event.target.value)} />
    </label>
  )

  return (
    <form
      className="flex flex-col gap-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <h2 className="text-lg font-semibold">{t.title}</h2>
      <label className="flex flex-col gap-1">
        {t.from}
        <select className={FIELD} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
          {usable.map((account) => (
            <option key={account.id} value={account.id}>
              {account.email}
            </option>
          ))}
        </select>
      </label>
      {field(t.to, to, setTo)}
      <p className="text-xs text-muted-foreground">{t.hint}</p>
      {field(t.cc, cc, setCc)}
      {field(t.bcc, bcc, setBcc)}
      {field(t.subject, subject, setSubject)}
      <label className="flex flex-col gap-1">
        {t.body}
        <textarea
          className={`${FIELD} min-h-48`}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={send.isPending || !accountId}>
          {t.send}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t.cancel}
        </Button>
      </div>
    </form>
  )
}
