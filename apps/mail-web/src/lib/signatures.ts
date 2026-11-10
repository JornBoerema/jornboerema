import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { MailAccountView, MailSignature } from "@evido/mail-core/types"
import { api } from "@/lib/api"

export const SIGNATURES_KEY = ["mail-signatures"]

export function useSignatures() {
  return useQuery({
    queryKey: SIGNATURES_KEY,
    queryFn: () => api<{ signatures: MailSignature[] }>("/api/mail/signatures"),
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * The signature a message uses: the mailbox's default for `kind`, until one is
 * picked in the composer. Switching mailboxes goes back to that one's default.
 */
export function useSignatureChoice(
  account: MailAccountView | undefined,
  kind: "new" | "reply"
) {
  const signatures = useSignatures().data?.signatures ?? []
  const [picked, setPicked] = useState<{
    accountId: string | undefined
    id: string | null
  } | null>(null)
  const chosen = account?.signatures as
    MailAccountView["signatures"] | undefined
  const fallback = (kind === "new" ? chosen?.newId : chosen?.replyId) ?? null
  const id = picked && picked.accountId === account?.id ? picked.id : fallback
  const signature = signatures.find((item) => item.id === id) ?? null
  return {
    html: signature?.html ?? "",
    value: signature?.id ?? null,
    signatures,
    choose: (next: string | null) =>
      setPicked({ accountId: account?.id, id: next }),
  }
}

export type SignatureChoice = ReturnType<typeof useSignatureChoice>

/** The signature as one line of text, for the list. Parsed inertly: nothing loads or runs. */
export function previewOf(html: string) {
  const body = new DOMParser().parseFromString(html, "text/html").body
  body.querySelectorAll("p, div, li, br").forEach((element) => element.after(" · "))
  return (body.textContent ?? "").replace(/(\s*·\s*)+/g, " · ").replace(/^ · | · $/g, "").trim()
}
