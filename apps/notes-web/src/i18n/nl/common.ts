import type { common as en } from "../en/common"

// Dutch texts for the "common" namespace; typed against the English keys.
export const common: typeof en = {
  loading: "Laden",
  noConnection: "Er is geen verbinding. Probeer het opnieuw.",
  tryAgain: "Probeer opnieuw.",
  pleaseWait: "Even geduld…",
  cancel: "Annuleren",
  toYourLists: "Naar je notities",
  pageError: {
    title: "Je notities konden niet worden geladen",
    description: "Probeer het over een moment opnieuw. Je opgeslagen notities blijven bewaard.",
    retry: "Opnieuw proberen",
  },
  sharedList: {
    title: "Gedeelde notitie",
    unavailableTitle: "Deze link is niet meer beschikbaar",
    unavailableDescription: "Vraag de eigenaar om een nieuwe link naar de notitie.",
  },
}
