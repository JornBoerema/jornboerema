import type { en } from "./en"

export const nl: typeof en = {
  editor: {
    copy: "Kopiëren",
    copied: "Gekopieerd naar het klembord",
    save: "Opslaan",
    saved: (path) => `Opgeslagen in ${path}`,
    close: "Sluiten",
    loading: "Screenshot laden…",
    failed: "Er ging iets mis. Probeer het opnieuw.",
    size: (width, height) => `${width} × ${height}`,
    fileName: (stamp) => `Screenshot ${stamp}.png`,
  },
  permission: {
    title: "Schermopname toestaan",
    body: "Even vastleggen heeft toestemming nodig om je scherm op te nemen voor screenshots. Zet het aan in Systeeminstellingen en probeer het daarna opnieuw.",
    open: "Open Systeeminstellingen",
    later: "Niet nu",
  },
}
