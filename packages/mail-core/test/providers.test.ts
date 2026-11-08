import { afterEach, describe, expect, it, vi } from "vitest"
import { createGmailProvider } from "../src/gmail"
import { createOutlookProvider } from "../src/outlook"
import { MissingScopeError, ProviderError, ReauthRequiredError } from "../src/provider"

const credentials = { clientId: "client", clientSecret: "secret" }
const gmail = createGmailProvider(credentials)
const outlook = createOutlookProvider(credentials)
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify"

function stubFetch(status: number, body: unknown) {
  const mock = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal("fetch", mock)
  return mock
}

const sentBody = (mock: ReturnType<typeof stubFetch>) =>
  (mock.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams

afterEach(() => vi.unstubAllGlobals())

const authInput = { state: "s", codeChallenge: "c", redirectUri: "https://api/cb" }
const codeInput = { code: "code", codeVerifier: "v", redirectUri: "https://api/cb" }

describe("authorization URLs", () => {
  it("gmail asks for a refresh token with PKCE", () => {
    const url = new URL(gmail.authorizationUrl(authInput))
    expect(url.searchParams.get("access_type")).toBe("offline")
    expect(url.searchParams.get("prompt")).toContain("consent")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("scope")).toContain(GMAIL_SCOPE)
  })

  it("outlook uses the common tenant and offline access", () => {
    const url = new URL(outlook.authorizationUrl(authInput))
    expect(url.pathname).toContain("/common/")
    expect(url.searchParams.get("scope")).toContain("offline_access")
    expect(url.searchParams.get("scope")).toContain("Mail.ReadWrite")
    expect(url.searchParams.get("code_challenge")).toBe("c")
  })
})

describe("token exchange", () => {
  it("gmail rejects a grant without the mail scope", async () => {
    stubFetch(200, { access_token: "a", refresh_token: "r", expires_in: 3600, scope: "openid email" })
    await expect(gmail.exchangeCode(codeInput)).rejects.toBeInstanceOf(MissingScopeError)
  })

  it("gmail sends the PKCE verifier and returns tokens", async () => {
    const mock = stubFetch(200, { access_token: "a", refresh_token: "r", expires_in: 3600, scope: GMAIL_SCOPE })
    const tokens = await gmail.exchangeCode(codeInput)
    expect(sentBody(mock).get("code_verifier")).toBe("v")
    expect(tokens.refreshToken).toBe("r")
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })
})

describe("refresh", () => {
  it("keeps refreshToken undefined when google does not rotate", async () => {
    stubFetch(200, { access_token: "new", expires_in: 3600 })
    expect((await gmail.refresh("old")).refreshToken).toBeUndefined()
  })

  it("returns the rotated outlook token", async () => {
    stubFetch(200, { access_token: "new", refresh_token: "rotated", expires_in: 3600 })
    expect((await outlook.refresh("old")).refreshToken).toBe("rotated")
  })

  it("maps invalid_grant to reauth and other failures to provider errors", async () => {
    stubFetch(400, { error: "invalid_grant" })
    await expect(outlook.refresh("old")).rejects.toBeInstanceOf(ReauthRequiredError)
    stubFetch(503, {})
    await expect(outlook.refresh("old")).rejects.toBeInstanceOf(ProviderError)
  })
})

describe("identity and inbox", () => {
  it("outlook falls back to userPrincipalName for personal accounts", async () => {
    stubFetch(200, { id: "1", displayName: "Jo", mail: null, userPrincipalName: "jo@outlook.com" })
    expect(await outlook.identity("t")).toEqual({
      providerAccountId: "1",
      email: "jo@outlook.com",
      displayName: "Jo",
    })
  })

  it("normalizes inbox counts from both providers", async () => {
    stubFetch(200, { messagesTotal: 10, messagesUnread: 2 })
    expect(await gmail.inboxSummary("t")).toEqual({ total: 10, unread: 2 })
    stubFetch(200, { totalItemCount: 7, unreadItemCount: 1 })
    expect(await outlook.inboxSummary("t")).toEqual({ total: 7, unread: 1 })
  })

  it("treats a rejected access token as reauth", async () => {
    stubFetch(401, {})
    await expect(gmail.inboxSummary("t")).rejects.toBeInstanceOf(ReauthRequiredError)
  })
})
