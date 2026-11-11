import { defineConfig } from "@trigger.dev/sdk"

// Delayed runs that wake snoozed mail and send scheduled mail at their moment.
// Project "Even" in the Bijvoorbeeld Zo organisation on cloud.trigger.dev.
export default defineConfig({
  project: "proj_hkbrnayjaordsvwxcdbe",
  dirs: ["./trigger"],
  maxDuration: 120,
  retries: {
    enabledInDev: true,
    default: { maxAttempts: 3, factor: 2, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, randomize: true },
  },
})
