import { scheduledDraftIds } from "./later-server"
import type { MailDraft, MailDraftContent, MailDraftView } from "@even/mail-core/types"
import { ownedAccount, visibleAccounts, withAccessToken, type MailViewer } from "./accounts-server"

export type DraftSave = MailDraftContent & { draftId: string | null; attachmentsChanged: boolean }

const sender = (account: { email: string; displayName: string | null }) => ({
  name: account.displayName,
  email: account.email,
})

/**
 * Drafts live at the provider and are read live, like mail bodies, so nothing of
 * them is stored here. A mailbox that fails is reported instead of failing the list.
 */
export async function listDrafts(viewer: MailViewer) {
  const accounts = await visibleAccounts(viewer, { active: true })
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
  const scheduled = await scheduledDraftIds(viewer)
  const drafts = results
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((draft) => !scheduled.has(`${draft.accountId}:${draft.id}`))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return { drafts, failedAccounts }
}

export async function readDraft(viewer: MailViewer, accountId: string, draftId: string): Promise<MailDraft> {
  const account = await ownedAccount(viewer, accountId)
  return withAccessToken(account, (provider, token) => provider.getDraft(token, draftId))
}

export async function saveDraft(viewer: MailViewer, accountId: string, input: DraftSave) {
  const account = await ownedAccount(viewer, accountId)
  const draftId = await withAccessToken(account, (provider, token) =>
    provider.saveDraft(token, { ...input, from: sender(account) })
  )
  return { draftId }
}

/** Saves the final content first, so what goes out is exactly what the user sees. */
export async function sendDraft(viewer: MailViewer, accountId: string, input: DraftSave & { draftId: string }) {
  const account = await ownedAccount(viewer, accountId)
  await withAccessToken(account, async (provider, token) => {
    const draftId = await provider.saveDraft(token, { ...input, from: sender(account) })
    await provider.sendDraft(token, draftId)
  })
}

export async function deleteDraft(viewer: MailViewer, accountId: string, draftId: string) {
  const account = await ownedAccount(viewer, accountId)
  await withAccessToken(account, (provider, token) => provider.deleteDraft(token, draftId))
}
