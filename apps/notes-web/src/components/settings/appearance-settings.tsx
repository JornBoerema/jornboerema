import { LANGUAGE_NAMES, LANGUAGES } from "@evido/i18n"
import type { LanguagePreference } from "@evido/i18n/react"
import { useTheme, type Theme } from "@evido/ui/lib/theme"
import { SettingsRow, SettingsSection } from "@evido/ui/components/settings-dialog"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@evido/ui/components/select"
import { Monitor, Moon, Sun } from "@/components/icons"
import { useI18n } from "@/i18n"

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme()
  const { t, preference, setPreference } = useI18n()
  const s = t.settings.appearance
  const themes = [
    { value: "light", label: s.light, icon: Sun },
    { value: "dark", label: s.dark, icon: Moon },
    { value: "system", label: s.system, icon: Monitor },
  ] as const
  return (
    <SettingsSection title={s.theme} description={s.deviceOnly}>
      <SettingsRow title={s.colorScheme} htmlFor="theme-select" description={s.colorSchemeHelp}>
        <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          <SelectTrigger id="theme-select" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              {themes.map(({ value, label, icon: Icon }) => (
                <SelectItem key={value} value={value}>
                  <Icon aria-hidden="true" />
                  {label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow title={s.language} htmlFor="language-select" description={s.languageHelp}>
        <Select
          value={preference}
          onValueChange={(value) => setPreference(value as LanguagePreference)}
        >
          <SelectTrigger id="language-select" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              <SelectItem value="auto">{s.automatic}</SelectItem>
              {/* Language names stay in their own language. */}
              {LANGUAGES.map((language) => (
                <SelectItem key={language} value={language} lang={language}>
                  {LANGUAGE_NAMES[language]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsRow>
    </SettingsSection>
  )
}
