import { betterAuth } from "better-auth"
import { bearer, jwt, organization } from "better-auth/plugins"
import { mcp } from "@better-auth/mcp"
import { prismaAdapter } from "@better-auth/prisma-adapter"
import { billingConfigured, billingPlugin, endSubscriptions, syncSeats } from "./billing"
import { desktopSignIn } from "./desktop-sign-in"
import { getDb, Prisma } from "@evido/db"
import { authEmails, queueEmail } from "@evido/email"
import { pickLanguage } from "@evido/i18n"

export const MCP_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "todos:read",
  "todos:write",
]

// Optional OAuth arrays are stored as Json? (see schema.prisma). Prisma needs
// Prisma.DbNull, not null, to write SQL NULL into a Json column.
const NULLABLE_JSON: Record<string, string[]> = {
  OauthClient: ["scopes", "clientCredentialsScopes", "contacts", "postLogoutRedirectUris", "grantTypes", "responseTypes"],
  OauthResource: ["allowedScopes"],
  OauthAccessToken: ["resources", "requestedUserInfoClaims"],
  OauthRefreshToken: ["resources", "requestedUserInfoClaims"],
  OauthConsent: ["resources", "requestedUserInfoClaims"],
}

function nullsToDbNull(fields: string[], data: unknown) {
  if (!data || typeof data !== "object") return data
  const copy: Record<string, unknown> = { ...(data as Record<string, unknown>) }
  for (const field of fields) if (copy[field] === null) copy[field] = Prisma.DbNull
  return copy
}

function authDb() {
  return getDb().$extends({
    query: {
      $allModels: {
        async $allOperations({ model, args, query }) {
          const fields = NULLABLE_JSON[model]
          if (fields && args && typeof args === "object") {
            const a = args as Record<string, unknown>
            for (const key of ["data", "create", "update"])
              if (key in a) a[key] = nullsToDbNull(fields, a[key])
          }
          return query(args)
        },
      },
    },
  })
}

function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Configureer ${name}.`)
  return value
}

/** Where the Even desktop app runs: tauri://localhost on macOS, tauri.localhost on Windows. */
const DESKTOP_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]

/**
 * "https://app.jornboerema.nl/mail" is on the origin "https://app.jornboerema.nl".
 * An address the browser has no origin for (tauri://localhost) stays as it is written.
 */
function originOf(address: string) {
  const written = address.trim().replace(/\/$/, "")
  try {
    const { origin } = new URL(written)
    return origin === "null" ? written : origin
  } catch {
    return written
  }
}

/**
 * Web origins that may call the API with credentials: the Even web app, the
 * website's admin, the desktop app, and whatever TRUSTED_ORIGINS adds.
 */
export function trustedOrigins() {
  const origins = [
    ...(process.env.TRUSTED_ORIGINS ?? "").split(","),
    ...DESKTOP_ORIGINS,
    process.env.APP_WEB_URL ?? "",
    process.env.ADMIN_WEB_URL ?? "",
  ]
    .map(originOf)
    .filter(Boolean)
  return [...new Set(origins)]
}

/**
 * The organization plugin's endpoints that change something: closed, so every change
 * goes through the API's routes. Choosing the active organization stays open.
 */
const ORGANIZATION_WRITES = [
  "accept-invitation", "add-team-member", "cancel-invitation", "create", "create-role", "create-team",
  "delete", "delete-role", "get-full-organization", "get-invitation", "invite-member", "leave",
  "list-invitations", "list-members", "list-user-invitations", "reject-invitation", "remove-member",
  "remove-team", "remove-team-member", "update", "update-member-role", "update-role", "update-team",
].map((path) => `/organization/${path}`)

/** Between deleting an account and after: the shared organizations it leaves. */
const leaving = new Map<string, string[]>()

function createAuth() {
  const baseURL = required("BETTER_AUTH_URL").replace(/\/$/, "")
  // Signing in and the consent page are pages of the Even web app.
  const authUiUrl = required("APP_WEB_URL").replace(/\/$/, "")
  const cookieDomain = process.env.AUTH_COOKIE_DOMAIN

  return betterAuth({
    appName: "Evido",
    baseURL,
    secret: required("BETTER_AUTH_SECRET"),
    trustedOrigins: trustedOrigins(),
    database: prismaAdapter(authDb(), { provider: "postgresql" }),
    disabledPaths: ["/token", ...ORGANIZATION_WRITES],
    advanced: cookieDomain
      ? { crossSubDomainCookies: { enabled: true, domain: cookieDomain } }
      : undefined,
    plugins: [
      jwt(),
      // The desktop app can't keep a cookie for the API, so it sends the session as a bearer token.
      bearer(),
      // Organizations: who works together, and who pays. Members and invitations are
      // changed through the API's own routes (apps/api/src/todo/workspaces-server.ts),
      // which know the rules for personal organizations; here the active one is chosen.
      organization({
        schema: {
          organization: {
            additionalFields: { personal: { type: "boolean", defaultValue: false, input: false } },
          },
        },
      }),
      desktopSignIn(),
      mcp({
        loginPage: `${authUiUrl}/login`,
        consentPage: `${authUiUrl}/connect`,
        resource: `${baseURL}/mcp`,
        scopes: MCP_SCOPES,
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        accessTokenExpiresIn: 300,
      }),
      // Subscriptions through Stripe, once its keys are set.
      ...(billingConfigured() ? [billingPlugin()] : []),
    ],
    user: {
      changeEmail: { enabled: true },
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          leaving.set(user.id, await endSubscriptions(user))
        },
        // The shared organizations they were in have one seat fewer now.
        afterDelete: async (user) => {
          const organizations = leaving.get(user.id) ?? []
          leaving.delete(user.id)
          for (const id of organizations) await syncSeats(id).catch((error) => console.error("Seat sync failed", error))
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      // The web apps send Accept-Language with the chosen UI language.
      sendResetPassword: async ({ user, url }, request) =>
        queueEmail(
          authEmails.resetPassword(user.email, url, pickLanguage(request?.headers.get("accept-language")))
        ),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }, request) =>
        queueEmail(
          authEmails.verify(user.email, url, pickLanguage(request?.headers.get("accept-language")))
        ),
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
        "/request-password-reset": { window: 60, max: 3 },
        "/change-email": { window: 60, max: 3 },
        "/delete-user": { window: 60, max: 5 },
        "/send-verification-email": { window: 60, max: 3 },
        "/desktop/code": { window: 60, max: 10 },
        "/desktop/token": { window: 60, max: 10 },
      },
    },
  })
}

let instance: ReturnType<typeof createAuth> | undefined
export const getAuth = () => (instance ??= createAuth())
export type Auth = ReturnType<typeof getAuth>
export type Session = NonNullable<
  Awaited<ReturnType<Auth["api"]["getSession"]>>
>
