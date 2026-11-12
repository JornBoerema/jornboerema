import type { BetterAuthPlugin } from "better-auth"
import { createAuthEndpoint, sessionMiddleware } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { generateRandomString } from "better-auth/crypto"
import * as z from "zod"

/** How long the browser's one-time code is good for. */
const CODE_TTL_MS = 2 * 60 * 1000

/** base64url, no padding: the PKCE (RFC 7636) encoding. */
function base64Url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

const sha256 = async (value: string) =>
  base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))

const identifier = async (code: string) => `desktop-sign-in:${await sha256(code)}`

/** A PKCE value: 43 to 128 unreserved characters. */
const pkceValue = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/)

/**
 * Signs the desktop app in through the browser. The account site, already
 * signed in there, asks for a one-time code bound to the app's PKCE challenge
 * and hands it to the app on 127.0.0.1. The app trades code and verifier for a
 * session of its own; the bearer plugin returns it as `set-auth-token`.
 */
export const desktopSignIn = () =>
  ({
    id: "desktop-sign-in",
    endpoints: {
      createDesktopCode: createAuthEndpoint(
        "/desktop/code",
        {
          method: "POST",
          body: z.object({ challenge: pkceValue }),
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const code = generateRandomString(32)
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: await identifier(code),
            value: JSON.stringify({ userId: ctx.context.session.user.id, challenge: ctx.body.challenge }),
            expiresAt: new Date(Date.now() + CODE_TTL_MS),
          })
          return ctx.json({ code })
        }
      ),
      exchangeDesktopCode: createAuthEndpoint(
        "/desktop/token",
        {
          method: "POST",
          body: z.object({ code: z.string().min(1).max(128), verifier: pkceValue }),
        },
        async (ctx) => {
          const invalid = () => ctx.error("BAD_REQUEST", { message: "Invalid or expired code" })
          // Consumed on first use, right or wrong: a code is never tried twice.
          const stored = await ctx.context.internalAdapter.consumeVerificationValue(
            await identifier(ctx.body.code)
          )
          if (!stored || stored.expiresAt < new Date()) throw invalid()
          const { userId, challenge } = JSON.parse(stored.value) as { userId: string; challenge: string }
          if ((await sha256(ctx.body.verifier)) !== challenge) throw invalid()
          const user = await ctx.context.internalAdapter.findUserById(userId)
          if (!user) throw invalid()
          const session = await ctx.context.internalAdapter.createSession(user.id)
          await setSessionCookie(ctx, { session, user })
          return ctx.json({ user: { id: user.id, email: user.email, name: user.name } })
        }
      ),
    },
  }) satisfies BetterAuthPlugin
