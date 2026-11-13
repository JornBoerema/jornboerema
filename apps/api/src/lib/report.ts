import * as Sentry from "@sentry/hono/node"

/**
 * For failures that are caught and answered politely, or happen after the
 * response: logged as before, and reported so they don't go unseen.
 */
export function report(where: string, error: unknown) {
  console.error(where, error instanceof Error ? error.message : "unknown")
  Sentry.captureException(error, { tags: { where } })
}
