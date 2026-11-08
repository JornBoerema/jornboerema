import { createHash, randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"
import { createOAuthState, openToken, parseTokenKey, sealToken } from "../src/secrets"

const key = randomBytes(32)

describe("sealToken", () => {
  it("round-trips and never contains the plaintext", () => {
    const sealed = sealToken("refresh-token", key, "user:gmail:1")
    expect(sealed).not.toContain("refresh-token")
    expect(openToken(sealed, key, "user:gmail:1")).toBe("refresh-token")
  })

  it("uses a fresh IV per call", () => {
    expect(sealToken("x", key, "c")).not.toBe(sealToken("x", key, "c"))
  })

  it("refuses a value moved to another account", () => {
    const sealed = sealToken("refresh-token", key, "user-a:gmail:1")
    expect(() => openToken(sealed, key, "user-b:gmail:1")).toThrow()
  })

  it("refuses a tampered value and a wrong key", () => {
    const [v, iv, data, tag] = sealToken("refresh-token", key, "c").split(".")
    const flipped = Buffer.from(data!, "base64url")
    flipped[0] = flipped[0]! ^ 1
    expect(() => openToken([v, iv, flipped.toString("base64url"), tag].join("."), key, "c")).toThrow()
    expect(() => openToken(sealToken("x", key, "c"), randomBytes(32), "c")).toThrow()
  })
})

describe("parseTokenKey", () => {
  it("accepts 32 hex bytes only", () => {
    expect(parseTokenKey("ab".repeat(32))).toHaveLength(32)
    expect(() => parseTokenKey("abc")).toThrow()
  })
})

describe("createOAuthState", () => {
  it("derives the challenge as base64url SHA-256 of the verifier", () => {
    const { codeVerifier, codeChallenge } = createOAuthState()
    expect(codeChallenge).toBe(createHash("sha256").update(codeVerifier).digest("base64url"))
  })
})
