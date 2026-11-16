import { createI18n } from "@even/i18n/react"
import { en } from "./en"
import { nl } from "./nl"

export const { I18nProvider, useI18n } = createI18n({ en, nl })
