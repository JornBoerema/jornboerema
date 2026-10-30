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

const options = [
  { value: "light", label: "Licht", icon: Sun },
  { value: "dark", label: "Donker", icon: Moon },
  { value: "system", label: "Systeem", icon: Monitor },
] as const

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme()
  return (
    <SettingsSection title="Thema" description="Geldt voor dit apparaat.">
      <SettingsRow
        title="Kleurenschema"
        htmlFor="theme-select"
        description="Systeem volgt automatisch de licht- of donkermodus van je apparaat."
      >
        <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          <SelectTrigger id="theme-select" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              {options.map(({ value, label, icon: Icon }) => (
                <SelectItem key={value} value={value}>
                  <Icon aria-hidden="true" />
                  {label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsRow>
    </SettingsSection>
  )
}
