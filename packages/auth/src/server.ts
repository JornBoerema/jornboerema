import { betterAuth } from "better-auth"
import { jwt } from "better-auth/plugins"
import { mcp } from "@better-auth/mcp"
import { prismaAdapter } from "@better-auth/prisma-adapter"
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

/** Web origins (all Evido front-ends) that may call the API with credentials. */
export function trustedOrigins() {
  return (process.env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean)
}

function createAuth() {
  const baseURL = required("BETTER_AUTH_URL").replace(/\/$/, "")
  // The web app that hosts the login and OAuth consent screens.
  const authUiUrl = required("AUTH_UI_URL").replace(/\/$/, "")
  const cookieDomain = process.env.AUTH_COOKIE_DOMAIN

  return betterAuth({
    appName: "Evido",
    baseURL,
    secret: required("BETTER_AUTH_SECRET"),
    trustedOrigins: trustedOrigins(),
    database: prismaAdapter(authDb(), { provider: "postgresql" }),
    disabledPaths: ["/token"],
    advanced: cookieDomain
      ? { crossSubDomainCookies: { enabled: true, domain: cookieDomain } }
      : undefined,
    plugins: [
      jwt(),
      mcp({
        loginPage: `${authUiUrl}/login`,
        consentPage: `${authUiUrl}/connect`,
        resource: `${baseURL}/mcp`,
        scopes: MCP_SCOPES,
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        accessTokenExpiresIn: 300,
      }),
    ],
    user: {
      changeEmail: { enabled: true },
      deleteUser: { enabled: true },
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
