import { deleteOutlookDraft, getOutlookDraft, listOutlookDrafts, saveOutlookDraft, sendOutlookDraft } from "./outlook-drafts"
import { getJson, requestTokens, sendJson } from "./http"
import { readOutlookAttachment, readOutlookThread } from "./outlook-read"
import { applyOutlookThreadAction, forwardOutlook, replyOutlook, sendOutlook } from "./outlook-send"
import { GRAPH_BASE, syncOutlookPage } from "./outlook-sync"
import { ProviderError, type MailProvider, type ProviderCredentials } from "./provider"

/** Graph allows just under 7 days for mail; a day's slack survives a missed renewal. */
const WATCH_MS = 6 * 24 * 60 * 60 * 1000

// "common" accepts both work/school and personal Microsoft accounts.
const OAUTH_BASE = "https://login.microsoftonline.com/common/oauth2/v2.0"

const SCOPES = ["offline_access", "openid", "profile", "email", "User.Read", "Mail.ReadWrite", "Mail.Send"]

export function createOutlookProvider({
  clientId,
  clientSecret,
}: ProviderCredentials): MailProvider {
  const scope = SCOPES.join(" ")

  return {
    id: "outlook",

    authorizationUrl({ state, codeChallenge, redirectUri }) {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        response_mode: "query",
        scope,
        // Without this a signed-in browser silently reuses the same account.
        prompt: "select_account",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      })
      return `${OAUTH_BASE}/authorize?${params}`
    },

    exchangeCode({ code, codeVerifier, redirectUri }) {
      return requestTokens(`${OAUTH_BASE}/token`, {
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        scope,
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      })
    },

    refresh(refreshToken) {
      return requestTokens(`${OAUTH_BASE}/token`, {
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        scope,
        refresh_token: refreshToken,
      })
    },

    async identity(accessToken) {
      const me = await getJson<{
        id?: string
        displayName?: string | null
        mail?: string | null
        userPrincipalName?: string | null
      }>(`${GRAPH_BASE}/me?$select=id,displayName,mail,userPrincipalName`, accessToken)
      // Personal accounts often have no `mail`; their sign-in name is the address.
      const email = me.mail ?? me.userPrincipalName
      if (!me.id || !email) throw new ProviderError("Microsoft profile is incomplete")
      return { providerAccountId: me.id, email, displayName: me.displayName ?? null }
    },

    async inboxSummary(accessToken) {
      const inbox = await getJson<{ totalItemCount?: number; unreadItemCount?: number }>(
        `${GRAPH_BASE}/me/mailFolders/inbox?$select=totalItemCount,unreadItemCount`,
        accessToken
      )
      return { total: inbox.totalItemCount ?? 0, unread: inbox.unreadItemCount ?? 0 }
    },

    syncPage: syncOutlookPage,

    getThread: readOutlookThread,

    applyThreadAction: applyOutlookThreadAction,

    send: sendOutlook,

    reply: replyOutlook,

    forward: forwardOutlook,

    listDrafts: listOutlookDrafts,

    getDraft: getOutlookDraft,

    saveDraft: saveOutlookDraft,

    sendDraft: sendOutlookDraft,

    deleteDraft: deleteOutlookDraft,

    getAttachment: readOutlookAttachment,

    async watch(accessToken, { webhookUrl, clientState, existingId }) {
      const expiresAt = new Date(Date.now() + WATCH_MS)
      const expirationDateTime = expiresAt.toISOString()
      if (existingId) {
        try {
          await sendJson(
            "PATCH",
            `${GRAPH_BASE}/subscriptions/${encodeURIComponent(existingId)}`,
            accessToken,
            { expirationDateTime }
          )
          return { id: existingId, expiresAt }
        } catch (error) {
          // Expired or removed at Microsoft's side: create a new one below.
          if (!(error instanceof ProviderError && error.status === 404)) throw error
        }
      }
      const response = await sendJson("POST", `${GRAPH_BASE}/subscriptions`, accessToken, {
        changeType: "created,updated,deleted",
        notificationUrl: webhookUrl,
        resource: "me/mailFolders('inbox')/messages",
        expirationDateTime,
        clientState,
      })
      const created = (await response.json()) as { id?: string }
      if (!created.id) throw new ProviderError("Graph subscription has no id")
      return { id: created.id, expiresAt }
    },

    async unwatch(accessToken, watchId) {
      const url = `${GRAPH_BASE}/subscriptions/${encodeURIComponent(watchId)}`
      const response = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok && response.status !== 404)
        throw new ProviderError(`Graph unwatch answered ${response.status}`)
    },
  }
}
