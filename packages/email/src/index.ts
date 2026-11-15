import { Resend } from "resend"
import { emailHtml } from "./html"

export type Email = {
  to: string
  subject: string
  text: string
  /** The label of the button a link line of `text` becomes in the HTML part. */
  button?: string
  language?: "en" | "nl"
}

let client: Resend | undefined

export async function sendEmail({ to, subject, text, button, language }: Email) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
    throw new Error("Configureer RESEND_API_KEY en EMAIL_FROM.")
  client ??= new Resend(process.env.RESEND_API_KEY)
  const { error } = await client.emails.send({
    from: process.env.EMAIL_FROM,
    to,
    // Answers reach a person instead of the no-reply address.
    replyTo: process.env.EMAIL_REPLY_TO ?? "support@jornboerema.nl",
    subject,
    text,
    html: emailHtml({ text, button, language }),
  })
  if (error) throw new Error(`E-mail kon niet worden verzonden: ${error.name}`)
}

/** Fire-and-forget: a failed mail must never fail the request that triggered it. */
export function queueEmail(email: Email) {
  void sendEmail(email).catch((error) =>
    console.error("E-mail verzenden mislukt", error)
  )
}

export * from "./templates"
