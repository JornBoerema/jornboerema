import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"

const VERSION = "v1"

/** MAIL_TOKEN_KEY is 32 random bytes as hex (`openssl rand -hex 32`). */
export function parseTokenKey(hex: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("MAIL_TOKEN_KEY must be 64 hex characters")
  return Buffer.from(hex, "hex")
}

/**
 * AES-256-GCM. `context` is authenticated but not stored: a sealed value only
 * opens for the row it was written for, so ciphertext cannot be moved between
 * accounts by someone who can write to the database.
 */
export function sealToken(plaintext: string, key: Buffer, context: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(Buffer.from(context))
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return [VERSION, iv, ciphertext, cipher.getAuthTag()]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".")
}

export function openToken(sealed: string, key: Buffer, context: string): string {
  const [version, iv, ciphertext, tag] = sealed.split(".")
  if (version !== VERSION || !iv || !ciphertext || !tag) throw new Error("Malformed sealed token")
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"))
  decipher.setAAD(Buffer.from(context))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("base64url")

/** The state value leaves through the browser; only its hash is stored. */
export const hashState = sha256

export function createOAuthState() {
  const verifier = randomBytes(32).toString("base64url")
  return {
    state: randomBytes(32).toString("base64url"),
    codeVerifier: verifier,
    codeChallenge: sha256(verifier),
  }
}

/** The value Graph echoes back. Derived, so no per-account secret has to be stored. */
export const webhookClientState = (secret: string, accountId: string) =>
  createHmac("sha256", secret).update(accountId).digest("base64url")

export function secretsMatch(given: string, expected: string) {
  const a = createHash("sha256").update(given).digest()
  const b = createHash("sha256").update(expected).digest()
  return timingSafeEqual(a, b)
}
