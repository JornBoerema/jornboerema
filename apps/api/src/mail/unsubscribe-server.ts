import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { withAccessToken } from "./accounts-server"
import { readConversation, type Conversation } from "./threads-server"

export class NothingToUnsubscribeError extends Error {}

/** Done: the list was asked to let go. Or a page the reader has to finish on. */
export type UnsubscribeResult = { done: true; via: "one-click" | "mail" } | { done: false; url: string }

const TIMEOUT_MS = 10_000

/** Loopback, private, link-local and other addresses that aren't the public internet. */
function isPrivate(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    )
  }
  const v6 = address.toLowerCase()
  if (v6.startsWith("::ffff:")) return isPrivate(v6.slice(7))
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80")
}

/**
 * RFC 8058's one-click: a single POST. The address comes out of a stranger's
 * mail, so only https to the public internet, no redirects followed, and a time limit.
 */
async function postOneClick(href: string) {
  const url = new URL(href)
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Not a plain https link")
  const addresses = await lookup(url.hostname, { all: true })
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivate(address)))
    throw new Error("Not on the public internet")
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Even mailen (unsubscribe)" },
    body: "List-Unsubscribe=One-Click",
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  // A redirect to a "you're unsubscribed" page counts; an error doesn't.
  if (response.status >= 400) throw new Error(`The list answered ${response.status}`)
}

/**
 * Leaves the mailing list a message came from, as its own headers say, read
 * here from the provider: the browser only names the message. One-click
 * first, then a message to the list's unsubscribe mailbox from the account
 * the mail came to; failing both, the page for the reader to finish on.
 */
export async function unsubscribeFrom(conversation: Conversation, messageId: string): Promise<UnsubscribeResult> {
  const { messages } = await readConversation(conversation, { includeHidden: conversation.hidden })
  const message = messages.find((item) => item.id === messageId)
  const unsubscribe = message?.unsubscribe
  if (!unsubscribe) throw new NothingToUnsubscribeError()

  if (unsubscribe.oneClick && unsubscribe.url) {
    try {
      await postOneClick(unsubscribe.url)
      return { done: true, via: "one-click" }
    } catch (error) {
      console.warn("One-click unsubscribe failed", error)
    }
  }
  if (unsubscribe.mailto) {
    const { address, subject, body } = unsubscribe.mailto
    await withAccessToken(conversation.account, (provider, token) =>
      provider.send(token, {
        from: { name: conversation.account.displayName ?? null, email: conversation.account.email },
        to: [{ name: null, email: address }],
        cc: [],
        bcc: [],
        subject,
        text: body,
        attachments: [],
      })
    )
    return { done: true, via: "mail" }
  }
  if (unsubscribe.url) return { done: false, url: unsubscribe.url }
  throw new NothingToUnsubscribeError()
}
