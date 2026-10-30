import { waitUntil } from "@vercel/functions"

/**
 * Run work after responding. Failures are logged, never surfaced to the client.
 * On Vercel, waitUntil keeps the function alive until the work is done.
 */
export function defer(work: () => Promise<unknown>) {
  waitUntil(work().catch((error) => console.error("Achtergrondtaak mislukt", error)))
}
