import { getDb } from "@evido/db"
import { defer } from "./defer"

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

export type AiFeature = "summary" | "replies" | "write" | "translate"

/** What OpenRouter reports with an answer. `cost` is in US dollars. */
export type AiUsageReport = { prompt_tokens?: number; completion_tokens?: number; cost?: number }

/** This month's AI allowance is used up. */
export class AiBudgetError extends Error {}

/** US dollars one user may cost in AI per calendar month. AI_MONTHLY_LIMIT_USD changes it; 0 lifts it. */
const monthlyLimitMicros = () => {
  const dollars = Number(process.env.AI_MONTHLY_LIMIT_USD ?? 5)
  return Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 1_000_000) : 0
}

// Claude Haiku 5.5, per million tokens: what an answer costs when OpenRouter names no price.
const INPUT_MICROS_PER_TOKEN = 0.1
const OUTPUT_MICROS_PER_TOKEN = 0.5

const currentMonth = () => new Date().toISOString().slice(0, 7)

/** Whether the user spent their AI allowance for this month. */
export async function overAiBudget(userId: string) {
  const limit = monthlyLimitMicros()
  if (!limit) return false
  const spent = await getDb().aiUsage.aggregate({
    where: { userId, month: currentMonth() },
    _sum: { costMicros: true },
  })
  return (spent._sum.costMicros ?? 0) >= limit
}

/** Adds one answer to the user's month. Never fails the request it belongs to. */
export async function chargeAi(userId: string, feature: AiFeature, usage: AiUsageReport | undefined) {
  const inputTokens = Math.max(0, Math.round(usage?.prompt_tokens ?? 0))
  const outputTokens = Math.max(0, Math.round(usage?.completion_tokens ?? 0))
  const costMicros =
    typeof usage?.cost === "number" && usage.cost >= 0
      ? Math.round(usage.cost * 1_000_000)
      : Math.round(inputTokens * INPUT_MICROS_PER_TOKEN + outputTokens * OUTPUT_MICROS_PER_TOKEN)
  const month = currentMonth()
  try {
    await getDb().aiUsage.upsert({
      where: { userId_month_feature: { userId, month, feature } },
      create: { userId, month, feature, requests: 1, inputTokens, outputTokens, costMicros },
      update: {
        requests: { increment: 1 },
        inputTokens: { increment: inputTokens },
        outputTokens: { increment: outputTokens },
        costMicros: { increment: costMicros },
      },
    })
  } catch (error) {
    console.error("AI usage not recorded", error instanceof Error ? error.message : "unknown")
  }
}

/** For a streamed answer: recorded after the response, once the stream named its usage. */
export const chargeAiLater = (userId: string, feature: AiFeature, usage: AiUsageReport | undefined) =>
  defer(() => chargeAi(userId, feature, usage))

/**
 * Asks the model on a user's account. Refuses once their month is spent; the
 * caller records what the answer cost with chargeAi.
 */
export async function askModel(
  userId: string,
  key: string,
  payload: Record<string, unknown>,
  timeoutMs: number
) {
  if (await overAiBudget(userId)) throw new AiBudgetError()
  return fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://mail.jornboerema.nl",
      "X-Title": "Even mailen",
    },
    body: JSON.stringify({
      // Thinking first would spend the token budget before any answer is written.
      reasoning: { enabled: false },
      // Only providers that neither keep nor train on what they are sent.
      provider: { data_collection: "deny" },
      // The price of the answer comes back with it.
      usage: { include: true },
      ...payload,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
}
