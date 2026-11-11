import { defineConfig } from "@trigger.dev/sdk"

// Delayed runs that wake snoozed mail and send scheduled mail at their moment.
// The project ref is set in .env (TRIGGER_PROJECT_REF) and in CI.
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_unset",
  dirs: ["./trigger"],
  maxDuration: 120,
  retries: {
    enabledInDev: true,
    default: { maxAttempts: 3, factor: 2, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, randomize: true },
  },
})
