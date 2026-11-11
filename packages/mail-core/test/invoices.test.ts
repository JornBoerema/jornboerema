import { describe, expect, it } from "vitest"
import { findInvoice, looksLikeInvoice } from "../src/invoices"

const mail = (over: Partial<Parameters<typeof findInvoice>[0]>) => ({
  subject: "",
  fromName: null,
  fromEmail: null,
  html: null,
  text: null,
  ...over,
})

describe("looksLikeInvoice", () => {
  it.each([
    ["a Dutch invoice", { fromEmail: "facturen@kpn.nl", subject: "Je factuur van november" }],
    ["a receipt", { fromEmail: "no-reply@vercel.com", subject: "Your receipt from Vercel #1234" }],
    ["Stripe", { fromEmail: "invoice+statements@stripe.com", subject: "Hello" }],
    ["a Tikkie", { fromEmail: "noreply@tikkie.me", subject: "Jan stuurt je een Tikkie" }],
  ])("is true for %s", (_name, input) => expect(looksLikeInvoice(input)).toBe(true))

  it("is false for a newsletter", () =>
    expect(looksLikeInvoice({ fromEmail: "news@shop.nl", subject: "Nieuw binnen: wintercollectie" })).toBe(false))
})

describe("findInvoice", () => {
  it("reads a Dutch invoice to pay", () => {
    const found = findInvoice(
      mail({
        subject: "Factuur 2026-0412 van Studio Noord",
        fromName: "Studio Noord Administratie",
        fromEmail: "administratie@studionoord.nl",
        text: "Beste Jorn,\nHierbij de factuur.\nSubtotaal € 100,00\nBTW € 21,00\nTotaal te betalen: € 121,00\nGraag betalen vóór 25-11-2026.",
      })
    )
    expect(found).toEqual({
      vendor: "Studio Noord",
      amountCents: 12100,
      currency: "EUR",
      dueDate: "2026-11-25",
      invoiceNumber: "2026-0412",
      payUrl: null,
      status: "due",
      overdue: false,
    })
  })

  it("reads an English receipt", () => {
    const found = findInvoice(
      mail({
        subject: "Your receipt from Vercel",
        fromName: "Vercel",
        fromEmail: "no-reply@vercel.com",
        text: "Receipt #2345-6789\nPro plan $20.00\nAmount paid $20.00\nThanks for your payment.",
      })
    )
    expect(found).toMatchObject({ vendor: "Vercel", amountCents: 2000, currency: "USD", status: "paid", invoiceNumber: "2345-6789" })
  })

  it("knows a direct debit is collected without you", () => {
    const found = findInvoice(
      mail({ subject: "Je factuur staat klaar", fromName: "Ziggo", fromEmail: "factuur@ziggo.nl", text: "Het bedrag van € 64,95 wordt rond 28 november automatisch afgeschreven." })
    )
    expect(found).toMatchObject({ status: "auto", amountCents: 6495 })
  })

  it("finds the pay link of a payment request", () => {
    const found = findInvoice(
      mail({
        subject: "Jan stuurt je een Tikkie",
        fromName: "Tikkie",
        fromEmail: "noreply@tikkie.me",
        html: `<p>Jan vraagt € 12,50 voor pizza.</p><a href="https://tikkie.me/pay/abc123">Betalen</a>`,
      })
    )
    expect(found).toMatchObject({ status: "due", amountCents: 1250, payUrl: "https://tikkie.me/pay/abc123" })
  })

  it("marks a reminder as overdue and a failure as failed", () => {
    expect(findInvoice(mail({ subject: "Herinnering: factuur 991 staat nog open", fromEmail: "a@b.nl", text: "Openstaand bedrag € 50,00" }))).toMatchObject({ overdue: true, status: "due" })
    expect(findInvoice(mail({ subject: "Payment failed", fromEmail: "billing@x.com", text: "We could not charge $9.99 to your card." }))).toMatchObject({ status: "failed", amountCents: 999 })
  })

  it.each([
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["12,5", 1250],
    ["1.500", 150000],
  ])("reads € %s as %i cents", (raw, cents) => {
    expect(findInvoice(mail({ subject: "Factuur", fromEmail: "a@b.nl", text: `Totaal € ${raw}` }))?.amountCents).toBe(cents)
  })

  it("leaves mail about money without an amount or attachment alone", () => {
    expect(findInvoice(mail({ subject: "Je factuur komt eraan", fromEmail: "a@b.nl", text: "Binnenkort." }))).toBeNull()
  })
})

describe("money mail without an amount", () => {
  it("still counts a failed payment", () => {
    expect(findInvoice(mail({ subject: "Action required: Payment failed", fromName: "Railway", fromEmail: "billing@railway.app", text: "Update your card." }))).toMatchObject({ status: "failed", amountCents: null })
  })

  it("knows a SEPA debit is collected", () => {
    expect(findInvoice(mail({ subject: "Debit initiated by OpenAI Ireland Limited", fromEmail: "notifications@stripe.com", text: "Amount €23.00" }))).toMatchObject({ status: "auto", amountCents: 2300 })
  })
})

it("reads a payment not yet received as overdue, and ignores product news from a billing company", () => {
  expect(
    findInvoice(mail({ subject: "De betaling voor uw Azure-abonnement is nog niet ontvangen", fromName: "Microsoft Azure", fromEmail: "azure-noreply@microsoft.com", text: "Betaal uw openstaande saldo." }))
  ).toMatchObject({ status: "due", overdue: true })
  expect(findInvoice(mail({ subject: "[Reminder] Workbench will be enabled", fromEmail: "notifications@stripe.com", text: "New features." }))).toBeNull()
})

it("doesn't take a limit for an invoice", () => {
  expect(
    findInvoice(
      mail({
        subject: "Betalingen met creditcards aangevraagd",
        fromName: "Team Mollie",
        fromEmail: "noreply@mollie.com",
        text: "We hebben betalingen met creditcards aangevraagd. Per transactie kunnen je klanten maximaal € 10.000,00 besteden.",
      })
    )
  ).toBeNull()
})

it.each([
  ["Payment Success", "Your payment of €49.90", "paid"],
  ["Credit note from Anthropic for invoice 12", "Amount €180.00", "paid"],
  ["Je abonnement wordt binnenkort verlengd", "Je betaalt € 4,99", "auto"],
  ["Dit is de factuur voor je bestelling 100336018", "Totaal € 129,00", "paid"],
])("reads %j as %s", (subject, text, status) => {
  expect(findInvoice(mail({ subject, fromEmail: "a@shop.nl", text, hasAttachments: true }))?.status).toBe(status)
})
