import { listGmailFolder, searchGmail } from "./gmail-search"
import { deleteGmailDraft, getGmailDraft, listGmailDrafts, saveGmailDraft, sendGmailDraft } from "./gmail-drafts"
import { readGmailAttachment, readGmailThread } from "./gmail-read"
import { applyGmailThreadAction, forwardGmail, replyGmail, sendGmail } from "./gmail-send"
import { GMAIL_API, syncGmailPage } from "./gmail-sync"
import { getJson, requestTokens, sendJson } from "./http"
import {
  MissingScopeError,
  ProviderError,
  type MailProvider,
  type ProviderCredentials,
} from "./provider"

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const REVOKE_URL = "https://oauth2.googleapis.com/revoke"
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
const INBOX_URL = "https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX"

// gmail.modify covers read, label, trash and send, without permanent delete.
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify"
const SCOPES = ["openid", "email", "profile", GMAIL_SCOPE]

export function createGmailProvider({ clientId, clientSecret }: ProviderCredentials): MailProvider {
  return {
    id: "gmail",

    authorizationUrl({ state, codeChallenge, redirectUri }) {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: SCOPES.join(" "),
        // Offline plus forced consent is the only way to always get a refresh token.
        access_type: "offline",
        prompt: "select_account consent",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      })
      return `${AUTHORIZE_URL}?${params}`
    },

    async exchangeCode({ code, codeVerifier, redirectUri }) {
      const tokens = await requestTokens(TOKEN_URL, {
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      })
      // Google's consent screen lets people untick individual scopes.
      if (!tokens.scope.split(" ").includes(GMAIL_SCOPE))
        throw new MissingScopeError("Gmail access was not granted")
      return tokens
    },

    refresh(refreshToken) {
      return requestTokens(TOKEN_URL, {
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      })
    },

    async identity(accessToken) {
      const user = await getJson<{ sub?: string; email?: string; name?: string }>(
        USERINFO_URL,
        accessToken
      )
      if (!user.sub || !user.email) throw new ProviderError("Google profile is incomplete")
      return { providerAccountId: user.sub, email: user.email, displayName: user.name ?? null }
    },

    async inboxSummary(accessToken) {
      const inbox = await getJson<{ messagesTotal?: number; messagesUnread?: number }>(
        INBOX_URL,
        accessToken
      )
      return { total: inbox.messagesTotal ?? 0, unread: inbox.messagesUnread ?? 0 }
    },

    syncPage: syncGmailPage,

    getThread: readGmailThread,

    applyThreadAction: applyGmailThreadAction,

    send: sendGmail,

    reply: replyGmail,

    forward: forwardGmail,

    search: searchGmail,

    listFolder: listGmailFolder,

    listDrafts: listGmailDrafts,

    getDraft: getGmailDraft,

    saveDraft: saveGmailDraft,

    sendDraft: sendGmailDraft,

    deleteDraft: deleteGmailDraft,

    getAttachment: readGmailAttachment,

    async watch(accessToken, { gmailTopic }) {
      if (!gmailTopic) throw new ProviderError("No Gmail Pub/Sub topic configured")
      // Unfiltered on purpose: Google doesn't promise a label filter reports archiving.
      const response = await sendJson("POST", `${GMAIL_API}/watch`, accessToken, {
        topicName: gmailTopic,
      })
      const { expiration } = (await response.json()) as { expiration?: string }
      return { id: null, expiresAt: new Date(Number(expiration)) }
    },

    async revoke(refreshToken) {
      const response = await fetch(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new ProviderError(`Google revoke answered ${response.status}`)
    },
  }
}
