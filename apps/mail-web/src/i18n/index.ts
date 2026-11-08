import { createI18n } from "@evido/i18n/react"
import { en } from "./en"
import { nl } from "./nl"

export const { I18nProvider, useI18n } = createI18n({ en, nl })
