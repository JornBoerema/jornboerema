import { describe, expect, it } from "vitest"
import { findShipment, findShipmentInThread, looksLikeShipment, statusOf } from "../src/shipments"

const mail = (over: Partial<Parameters<typeof findShipment>[0]>) => ({
  subject: "",
  fromName: null,
  fromEmail: null,
  html: null,
  text: null,
  ...over,
})

describe("looksLikeShipment", () => {
  it.each([
    ["a carrier", { fromEmail: "noreply@notificatie.postnl.nl", subject: "Hallo" }],
    ["a shop's subject", { fromEmail: "service@coolblue.nl", subject: "Je bestelling is onderweg" }],
    ["an English subject", { fromEmail: "orders@shop.com", subject: "Your package has shipped" }],
  ])("is true for %s", (_name, input) => expect(looksLikeShipment(input)).toBe(true))

  it.each([
    ["a newsletter", { fromEmail: "news@shop.com", subject: "50% korting dit weekend" }],
    ["Amazon about something else", { fromEmail: "store-news@amazon.nl", subject: "Aanbevolen voor jou" }],
  ])("is false for %s", (_name, input) => expect(looksLikeShipment(input)).toBe(false))
})

describe("findShipment", () => {
  it("reads PostNL's own mail", () => {
    const found = findShipment(
      mail({
        subject: "Je pakket van Coolblue is onderweg",
        fromEmail: "noreply@notificatie.postnl.nl",
        html: `<p>Je pakket van Coolblue is onderweg.</p><a href="https://jouw.postnl.nl/track-and-trace/3SCBLU1234567890-NL-1234AB">Volg je pakket</a>`,
      })
    )
    expect(found).toEqual({
      carrier: "postnl",
      trackingCode: "3SCBLU1234567890",
      trackingUrl: "https://jouw.postnl.nl/track-and-trace/3SCBLU1234567890-NL-1234AB",
      merchant: "Coolblue",
      status: "in_transit",
    })
  })

  it("reads a shop's mail with a DHL link", () => {
    const found = findShipment(
      mail({
        subject: "Je bestelling is verzonden",
        fromName: "Zalando",
        fromEmail: "info@service-mail.zalando.nl",
        html: `<a href="https://www.dhl.com/nl-nl/home/tracking/tracking-parcel.html?submit=1&amp;tracking-id=JVGL06123456789012345">Track &amp; trace</a>`,
      })
    )
    expect(found?.carrier).toBe("dhl")
    expect(found?.trackingCode).toBe("JVGL06123456789012345")
    expect(found?.merchant).toBe("Zalando")
    expect(found?.status).toBe("in_transit")
  })

  it("builds a link from a printed code", () => {
    const found = findShipment(
      mail({ subject: "Verzonden", fromName: "Shop", fromEmail: "a@shop.nl", text: "Je trackingnummer is 1Z999AA10123456784." })
    )
    expect(found?.carrier).toBe("ups")
    expect(found?.trackingUrl).toBe("https://www.ups.com/track?tracknum=1Z999AA10123456784")
  })

  it("follows a shop's wrapped tracking link", () => {
    const found = findShipment(
      mail({
        subject: "Je pakket komt eraan",
        fromName: "bol",
        fromEmail: "noreply@bol.com",
        html: `<a href="https://click.bol.com/abc?x=1">Volg je pakket</a><a href="https://bol.com/unsubscribe">Afmelden</a>`,
      })
    )
    expect(found?.trackingUrl).toBe("https://click.bol.com/abc?x=1")
    expect(found?.carrier).toBeNull()
  })

  it("ignores an order confirmation without tracking", () => {
    expect(findShipment(mail({ subject: "Bedankt voor je bestelling", fromEmail: "a@shop.nl", text: "We gaan aan de slag." }))).toBeNull()
  })
})

describe("statusOf", () => {
  it.each([
    ["Je pakket is bezorgd", "delivered"],
    ["Je pakket wordt vandaag bezorgd", "out_for_delivery"],
    ["Your package was delivered", "delivered"],
    ["Your package will be delivered today", "out_for_delivery"],
    ["Je pakket ligt klaar bij het PostNL-punt", "pickup"],
    ["We konden je pakket niet bezorgen", "problem"],
    ["Je pakket is aangemeld", "announced"],
    ["Je bestelling is verzonden", "in_transit"],
  ])("%s", (subject, status) => expect(statusOf(subject, "")).toBe(status))
})

describe("findShipmentInThread", () => {
  it("keeps the link from the first mail and the status from the last", () => {
    const found = findShipmentInThread([
      mail({
        subject: "Je pakket is onderweg",
        fromEmail: "noreply@postnl.nl",
        html: `<a href="https://jouw.postnl.nl/track-and-trace/3SABCD123456789">Volg</a>`,
      }),
      mail({ subject: "Je pakket is bezorgd", fromEmail: "noreply@postnl.nl", text: "Je zending 3SABCD123456789 is bezorgd." }),
    ])
    expect(found?.status).toBe("delivered")
    expect(found?.trackingUrl).toContain("3SABCD123456789")
  })
})

describe("carriers' own habits", () => {
  it("takes a link whose text is the code", () => {
    const found = findShipment(
      mail({
        subject: "We bezorgen je pakket vandaag",
        fromEmail: "noreply@nl.dragonflyinternational.com",
        html: `<a href="https://notifications.nl.dragonflyinternational.com/x">AMZNL000009193730</a>`,
      })
    )
    expect(found).toMatchObject({ carrier: "dragonfly", trackingCode: "AMZNL000009193730", status: "out_for_delivery" })
  })

  it("reads Trunkrs' code from the subject", () => {
    const found = findShipment(
      mail({ subject: "[420986074] Je pakket van Lotgenootje is aangemeld", fromEmail: "noreply@trunkrs.nl", text: "Hoi!" })
    )
    expect(found).toMatchObject({ carrier: "trunkrs", trackingCode: "420986074", merchant: "Lotgenootje", status: "announced" })
  })

  it("follows bol's 'Waar is mijn pakket?'", () => {
    const found = findShipment(
      mail({ subject: "Je pakket is bezorgd!", fromName: "bol", fromEmail: "noreply@bol.com", html: `<a href="https://link.bol.com/abc">Waar is mijn pakket?</a>` })
    )
    expect(found).toMatchObject({ trackingUrl: "https://link.bol.com/abc", status: "delivered" })
  })

  it("ties Amazon's mails together by order number", () => {
    const found = findShipment(
      mail({
        subject: "Onderweg voor bezorging: Bestelnummer 405-0838423-3833942",
        fromEmail: "verzending@amazon.nl",
        html: `<a href="https://www.amazon.nl/gp/your-account/ship-track?orderId=405">Volg je pakket</a>`,
      })
    )
    expect(found).toMatchObject({ carrier: "amazon", trackingCode: "405-0838423-3833942", status: "out_for_delivery" })
  })
})
