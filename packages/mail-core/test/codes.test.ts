import { describe, expect, it } from "vitest"
import { findOneTimeCode } from "../src/codes"

describe("one-time codes", () => {
  it("finds codes in common phrasings", () => {
    expect(findOneTimeCode("Je verificatiecode", "Gebruik 482913 om in te loggen.")).toBe("482913")
    expect(findOneTimeCode("Sign in to GitHub", "Your verification code is: 123-456")).toBe("123-456")
    expect(findOneTimeCode("", "Your one-time passcode\n\n  K7Q2ZP\n\nIt expires in 10 minutes.")).toBe("K7Q2ZP")
    expect(findOneTimeCode("Bestätigungscode", "Ihr Code lautet 7731")).toBe("7731")
    expect(findOneTimeCode("Security alert", "Enter 991 204 to continue")).toBe("991 204")
    expect(findOneTimeCode("Je inlogcode", "Je code is 381920. Hij verloopt over 10 minuten.")).toBe("381920")
    expect(findOneTimeCode("Login", "Code: 5521, valid for 5 minutes")).toBe("5521")
  })

  it("ignores numbers that aren't codes", () => {
    expect(findOneTimeCode("Je bestelling", "Bestelnummer 186427 is verzonden. Totaal €12,50.")).toBeNull()
    expect(findOneTimeCode("Code of conduct update", "Effective from 2026, see section 12.4.")).toBeNull()
    expect(findOneTimeCode("Login reminder", "Meeting at 10:30 in room 4521B")).toBeNull()
    expect(findOneTimeCode("Invoice", "Amount 1250 due")).toBeNull()
    expect(findOneTimeCode("Your login", "Version 2.4.1381 was installed")).toBeNull()
    expect(findOneTimeCode("Your code", "Use discount BLACKFRIDAY at checkout")).toBeNull()
  })
})
