import { createI18n } from "@evido/i18n/react"
import { en } from "./en"
import { nl } from "./nl"

export type TodoMessages = typeof en

/**
 * `const { t, locale } = useI18n()` then `t.auth.login.title`.
 * Texts live per namespace in ./en/*.ts (source) and ./nl/*.ts (typed
 * against English, so missing keys fail the typecheck).
 */
export const { I18nProvider, useI18n } = createI18n<TodoMessages>({ en, nl })
