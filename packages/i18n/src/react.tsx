import * as React from "react"
import { DEFAULT_LANGUAGE, isLanguage, LOCALES, type Language, type Messages } from "./index"

const STORAGE_KEY = "evido.language"
/** Sent in this window when the language changes: other apps in the same window follow. */
const CHANGE_EVENT = "evido:language"

/** "auto" follows the browser; otherwise the stored choice. */
export type LanguagePreference = Language | "auto"

function browserLanguage(): Language {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split("-")[0]
    if (isLanguage(base)) return base
  }
  return DEFAULT_LANGUAGE
}

function storedPreference(): LanguagePreference {
  const stored = localStorage.getItem(STORAGE_KEY)
  return isLanguage(stored) ? stored : "auto"
}

/** Current language outside React (e.g. for API request headers). */
export function currentLanguage(): Language {
  const preference = storedPreference()
  return preference === "auto" ? browserLanguage() : preference
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

/** The current language, following changes; for code outside an app's provider. */
export function useCurrentLanguage(): Language {
  return React.useSyncExternalStore(subscribe, currentLanguage)
}

type I18nState<M> = {
  t: M
  language: Language
  /** Locale for Intl formatting, e.g. "nl-NL". */
  locale: string
  preference: LanguagePreference
  setPreference: (preference: LanguagePreference) => void
}

/** Creates a provider and hook bound to one app's dictionaries. */
export function createI18n<M extends Messages>(dictionaries: Record<Language, M>) {
  const Context = React.createContext<I18nState<M> | undefined>(undefined)

  function I18nProvider({ children }: { children: React.ReactNode }) {
    const [preference, setPreferenceState] = React.useState<LanguagePreference>(storedPreference)
    const language = preference === "auto" ? browserLanguage() : preference

    React.useEffect(() => {
      document.documentElement.lang = language
    }, [language])

    React.useEffect(() => {
      // Other tabs changing the language.
      const onStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY) setPreferenceState(storedPreference())
      }
      // Another app in this window (the desktop app holds several).
      const onChange = () => setPreferenceState(storedPreference())
      window.addEventListener("storage", onStorage)
      window.addEventListener(CHANGE_EVENT, onChange)
      return () => {
        window.removeEventListener("storage", onStorage)
        window.removeEventListener(CHANGE_EVENT, onChange)
      }
    }, [])

    const setPreference = React.useCallback((next: LanguagePreference) => {
      if (next === "auto") localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, next)
      setPreferenceState(next)
      window.dispatchEvent(new Event(CHANGE_EVENT))
    }, [])

    const value = React.useMemo(
      () => ({
        t: dictionaries[language],
        language,
        locale: LOCALES[language],
        preference,
        setPreference,
      }),
      [language, preference, setPreference]
    )
    return <Context.Provider value={value}>{children}</Context.Provider>
  }

  function useI18n() {
    const context = React.useContext(Context)
    if (!context) throw new Error("useI18n must be used within an I18nProvider")
    return context
  }

  return { I18nProvider, useI18n }
}
