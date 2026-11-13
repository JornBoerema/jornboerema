import { createSign } from "node:crypto"
import { connect, constants, type ClientHttp2Session } from "node:http2"
import { getDb } from "@evido/db"
import { pickLanguage } from "@evido/i18n"

/**
 * New-mail notifications for the iPhone and iPad app, sent through Apple's push
 * service (APNs). Off until its key is set: APNS_KEY (the .p8 file's text),
 * APNS_KEY_ID, APNS_TEAM_ID and APNS_BUNDLE_ID.
 *
 * A notification carries who the mail is from and its subject, the same line
 * the inbox shows, and passes through Apple on its way to the device. Nothing
 * about the mail is kept here.
 */
const HOSTS = { sandbox: "https://api.sandbox.push.apple.com", production: "https://api.push.apple.com" } as const
export const PUSH_ENVIRONMENTS = ["sandbox", "production"] as const
export type PushEnvironment = (typeof PUSH_ENVIRONMENTS)[number]

/** More new mail than this at once is one summary notification instead. */
const MAX_SEPARATE = 3
/** Older than this is not news: a first sync or a catch-up doesn't ring for it. */
const FRESH_MS = 15 * 60 * 1000
/** Apple accepts a provider token for an hour; a new one is made well before. */
const TOKEN_MS = 45 * 60 * 1000
const SEND_TIMEOUT_MS = 8000

function config() {
  const key = process.env.APNS_KEY?.replace(/\\n/g, "\n").trim()
  const keyId = process.env.APNS_KEY_ID?.trim()
  const teamId = process.env.APNS_TEAM_ID?.trim()
  const topic = process.env.APNS_BUNDLE_ID?.trim()
  return key && keyId && teamId && topic ? { key, keyId, teamId, topic } : null
}

export const pushEnabled = () => config() !== null

const base64Url = (value: string | Buffer) => Buffer.from(value).toString("base64url")

let cached: { token: string; madeAt: number } | null = null

/** The signed token that tells Apple which developer is sending (ES256, RFC 7519). */
function providerToken({ key, keyId, teamId }: NonNullable<ReturnType<typeof config>>) {
  if (cached && Date.now() - cached.madeAt < TOKEN_MS) return cached.token
  const head = base64Url(JSON.stringify({ alg: "ES256", kid: keyId }))
  const claims = base64Url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }))
  const signature = createSign("SHA256").update(`${head}.${claims}`).sign({ key, dsaEncoding: "ieee-p1363" })
  cached = { token: `${head}.${claims}.${base64Url(signature)}`, madeAt: Date.now() }
  return cached.token
}

export type PushMessage = {
  title: string
  /** A second line in bold, as mail apps show the subject. */
  subtitle?: string
  body: string
  /** Notifications of one mailbox stack together on the lock screen. */
  group: string
  /** The conversation to open when tapped; absent for a summary. */
  thread?: string
}

type Sent = { token: string; status: number; reason?: string }

/** One request on an open connection. Apple only speaks HTTP/2. */
function post(session: ClientHttp2Session, token: string, headers: Record<string, string>, body: string) {
  return new Promise<Sent>((resolve) => {
    const request = session.request({
      [constants.HTTP2_HEADER_METHOD]: "POST",
      [constants.HTTP2_HEADER_PATH]: `/3/device/${token}`,
      ...headers,
    })
    let status = 0
    let answer = ""
    const timer = setTimeout(() => request.close(constants.NGHTTP2_CANCEL), SEND_TIMEOUT_MS)
    request.setEncoding("utf8")
    request.on("response", (response) => (status = Number(response[constants.HTTP2_HEADER_STATUS])))
    request.on("data", (chunk: string) => (answer += chunk))
    request.on("error", () => undefined)
    request.on("close", () => {
      clearTimeout(timer)
      let reason: string | undefined
      try {
        reason = (JSON.parse(answer) as { reason?: string }).reason
      } catch {
        // A delivered notification answers with nothing.
      }
      resolve({ token, status, reason })
    })
    request.end(body)
  })
}

/** The tokens Apple no longer knows: the app was removed, or the token replaced. */
const isGone = (sent: Sent) =>
  sent.status === 410 || (sent.status === 400 && (sent.reason === "BadDeviceToken" || sent.reason === "DeviceTokenNotForTopic"))

async function sendAll(environment: PushEnvironment, tokens: string[], messages: PushMessage[]) {
  const settings = config()
  if (!settings || tokens.length === 0 || messages.length === 0) return []
  const session = connect(HOSTS[environment])
  session.on("error", () => undefined)
  const headers = {
    authorization: `bearer ${providerToken(settings)}`,
    "apns-topic": settings.topic,
    "apns-push-type": "alert",
    "apns-priority": "10",
    // Mail that is a day old when the phone comes back online is no longer worth a ring.
    "apns-expiration": String(Math.floor(Date.now() / 1000) + 24 * 60 * 60),
  }
  try {
    return await Promise.all(
      tokens.flatMap((token) =>
        messages.map((message) =>
          post(
            session,
            token,
            headers,
            JSON.stringify({
              aps: {
                alert: { title: message.title, ...(message.subtitle && { subtitle: message.subtitle }), body: message.body },
                sound: "default",
                "thread-id": message.group,
              },
              ...(message.thread && { thread: message.thread }),
            })
          )
        )
      )
    )
  } finally {
    session.close()
  }
}

/** Sends to every device of a user, and forgets the ones Apple says are gone. */
export async function pushToUser(userId: string, messages: (language: string) => PushMessage[]) {
  if (!pushEnabled()) return
  const db = getDb()
  const devices = await db.mailPushDevice.findMany({ where: { userId } })
  if (devices.length === 0) return
  const gone = new Set<string>()
  for (const environment of PUSH_ENVIRONMENTS) {
    for (const language of new Set(devices.map((device) => device.language))) {
      const tokens = devices
        .filter((device) => device.environment === environment && device.language === language)
        .map((device) => device.token)
      for (const sent of await sendAll(environment, tokens, messages(language))) {
        if (isGone(sent)) gone.add(sent.token)
        else if (sent.status !== 200) console.error("Push failed", sent.status, sent.reason ?? "no answer")
      }
    }
  }
  if (gone.size > 0) await db.mailPushDevice.deleteMany({ where: { token: { in: [...gone] } } })
}

type NewMail = {
  id: string
  accountId: string
  subject: string
  snippet: string
  fromName: string | null
  fromEmail: string | null
  receivedAt: Date
  isRead: boolean
  folder: string
}

/** What rings: unread mail that just arrived in the inbox. */
export const isNews = (mail: NewMail, now = Date.now()) =>
  mail.folder === "inbox" && !mail.isRead && now - mail.receivedAt.getTime() < FRESH_MS

const WORDS = {
  en: { unknownSender: "Unknown sender", noSubject: "(no subject)", newMail: (count: number) => `${count} new messages` },
  nl: { unknownSender: "Onbekende afzender", noSubject: "(geen onderwerp)", newMail: (count: number) => `${count} nieuwe berichten` },
}

/** The notifications for a batch of new mail, as the web app words its own (`lib/notifications.ts`). */
export function newMailMessages(mail: NewMail[], language: string): PushMessage[] {
  const t = WORDS[language === "nl" ? "nl" : "en"]
  const sender = (item: NewMail) => item.fromName || item.fromEmail || t.unknownSender
  const newest = [...mail].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
  if (newest.length > MAX_SEPARATE) {
    const names = [...new Set(newest.map(sender))]
    return [
      {
        title: t.newMail(newest.length),
        body: names.slice(0, 3).join(", ") + (names.length > 3 ? "…" : ""),
        group: newest[0]!.accountId,
      },
    ]
  }
  // Sender, then the subject in bold, then how the mail begins: as Gmail's own notification reads.
  return newest.map((item) => ({
    title: sender(item),
    ...(item.snippet ? { subtitle: (item.subject || t.noSubject).slice(0, 200) } : {}),
    body: (item.snippet || item.subject || t.noSubject).slice(0, 400),
    group: item.accountId,
    thread: item.id,
  }))
}

/** Rings the user's devices for mail a sync just brought in. */
export async function pushNewMail(userId: string, mail: NewMail[]) {
  const news = mail.filter((item) => isNews(item))
  if (news.length === 0) return
  await pushToUser(userId, (language) => newMailMessages(news, language))
}

/** Remembers a device, or moves it to the user who signed in on it now. */
export async function registerDevice(
  userId: string,
  input: { token: string; environment: PushEnvironment },
  acceptLanguage: string | undefined
) {
  const language = pickLanguage(acceptLanguage)
  await getDb().mailPushDevice.upsert({
    where: { token: input.token },
    create: { token: input.token, userId, environment: input.environment, language },
    update: { userId, environment: input.environment, language },
  })
}

export async function forgetDevice(userId: string, token: string) {
  await getDb().mailPushDevice.deleteMany({ where: { userId, token } })
}
