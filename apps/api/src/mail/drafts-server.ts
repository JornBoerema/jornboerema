import { scheduledDraftIds } from "./later-server"
import { getDb } from "@evido/db"
import type { MailDraft, MailDraftContent, MailDraftView } from "@evido/mail-core/types"
import { ownedAccount, withAccessToken } from "./accounts-server"

export type DraftSave = MailDraftContent & { draftId: string | null; attachmentsChanged: boolean }

const sender = (account: { email: string; displayName: string | null }) => ({
  name: account.displayName,
  email: account.email,
})

/**
 * Drafts live at the provider and are read live, like mail bodies, so nothing of
 * them is stored here. A mailbox that fails is reported instead of failing the list.
 */
export async function listDrafts(userId: string) {
  const accounts = await getDb().mailAccount.findMany({ where: { userId, status: "active" } })
  const results = await Promise.allSettled(
    accounts.map((account) =>
      withAccessToken(account, (provider, token) => provider.listDrafts(token)).then((drafts) =>
        drafts.map((draft): MailDraftView => ({ ...draft, accountId: account.id }))
      )
    )
  )
  const failedAccounts = accounts.flatMap((account, index) =>
    results[index]?.status === "rejected" ? [account.id] : []
  )
  for (const result of results)
    if (result.status === "rejected")
      console.error("Drafts list failed", result.reason instanceof Error ? result.reason.message : "unknown")
  // Drafts waiting to be sent later show under Scheduled instead.
  const scheduled = await scheduledDraftIds(userId)
  const drafts = results
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((draft) => !scheduled.has(`${draft.accountId}:${draft.id}`))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return { drafts, failedAccounts }
}

export async function readDraft(userId: string, accountId: string, draftId: string): Promise<MailDraft> {
  const account = await ownedAccount(userId, accountId)
  return withAccessToken(account, (provider, token) => provider.getDraft(token, draftId))
}

export async function saveDraft(userId: string, accountId: string, input: DraftSave) {
  const account = await ownedAccount(userId, accountId)
  const draftId = await withAccessToken(account, (provider, token) =>
    provider.saveDraft(token, { ...input, from: sender(account) })
  )
  return { draftId }
}

/** Saves the final content first, so what goes out is exactly what the user sees. */
export async function sendDraft(userId: string, accountId: string, input: DraftSave & { draftId: string }) {
  const account = await ownedAccount(userId, accountId)
  await withAccessToken(account, async (provider, token) => {
    const draftId = await provider.saveDraft(token, { ...input, from: sender(account) })
    await provider.sendDraft(token, draftId)
  })
}

export async function deleteDraft(userId: string, accountId: string, draftId: string) {
  const account = await ownedAccount(userId, accountId)
  await withAccessToken(account, (provider, token) => provider.deleteDraft(token, draftId))
}
