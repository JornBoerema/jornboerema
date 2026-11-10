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

/** The signature HTML a mailbox adds, or empty for none. */
export function useSignatureFor(account: MailAccountView | undefined, kind: "new" | "reply") {
  const signatures = useSignatures().data?.signatures
  // Optional while a newer web app briefly talks to an older API during a deploy.
  const chosen = account?.signatures as MailAccountView["signatures"] | undefined
  const id = kind === "new" ? chosen?.newId : chosen?.replyId
  return signatures?.find((signature) => signature.id === id)?.html ?? ""
}
