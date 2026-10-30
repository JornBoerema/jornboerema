import { Resend } from "resend"

export type Email = { to: string; subject: string; text: string }

let client: Resend | undefined

export async function sendEmail({ to, subject, text }: Email) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
    throw new Error("Configureer RESEND_API_KEY en EMAIL_FROM.")
  client ??= new Resend(process.env.RESEND_API_KEY)
  const { error } = await client.emails.send({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    text,
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
