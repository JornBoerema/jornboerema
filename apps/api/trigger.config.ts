import { defineConfig } from "@trigger.dev/sdk"

// Delayed runs that wake snoozed mail and send scheduled mail at their moment.
// Project "Even" on cloud.trigger.dev.
export default defineConfig({
  project: "proj_mcjbcbpxlwywjneryfhr",
  dirs: ["./trigger"],
  maxDuration: 120,
  retries: {
    enabledInDev: true,
    default: { maxAttempts: 3, factor: 2, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, randomize: true },
  },
})
