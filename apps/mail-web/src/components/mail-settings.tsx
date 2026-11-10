import { useState } from "react"
import { Mail01Icon, PaintBoardIcon, SecurityCheckIcon, SignatureIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { LANGUAGE_NAMES, LANGUAGES } from "@evido/i18n"
import type { LanguagePreference } from "@evido/i18n/react"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@evido/ui/components/select"
import { SettingsDialog, SettingsRow, SettingsSection } from "@evido/ui/components/settings-dialog"
import { Switch } from "@evido/ui/components/switch"
import { useTheme, type Theme } from "@evido/ui/lib/theme"
import { useI18n } from "@/i18n"
import { setAlwaysShowImages, useAlwaysShowImages } from "@/lib/preferences"
import { SignatureSettings } from "@/components/signature-settings"
import { AccountsPage } from "@/pages/accounts"

function AppearanceSettings() {
  const { theme, setTheme } = useTheme()
  const { t, preference, setPreference } = useI18n()
  const s = t.appearance
  return (
    <SettingsSection title={s.theme} description={s.deviceOnly}>
      <SettingsRow title={s.colorScheme} htmlFor="theme-select" description={s.colorSchemeHelp}>
        <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          <SelectTrigger id="theme-select" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              <SelectItem value="light">{s.light}</SelectItem>
              <SelectItem value="dark">{s.dark}</SelectItem>
              <SelectItem value="system">{s.system}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow title={s.language} htmlFor="language-select" description={s.languageHelp}>
        <Select value={preference} onValueChange={(value) => setPreference(value as LanguagePreference)}>
          <SelectTrigger id="language-select" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              <SelectItem value="auto">{s.automatic}</SelectItem>
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

function PrivacySettings() {
  const t = useI18n().t.privacy
  const alwaysShow = useAlwaysShowImages()
  return (
    <SettingsSection title={t.images} description={t.deviceOnly}>
      <SettingsRow title={t.alwaysShow} htmlFor="always-show-images" description={t.alwaysShowHelp}>
        <Switch id="always-show-images" checked={alwaysShow} onCheckedChange={setAlwaysShowImages} />
      </SettingsRow>
    </SettingsSection>
  )
}

export function MailSettings({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useI18n().t.shell
  const [page, setPage] = useState("mailboxes")
  const pages = [
    {
      id: "mailboxes",
      label: t.mailboxes,
      icon: <HugeiconsIcon icon={Mail01Icon} strokeWidth={1.75} aria-hidden="true" />,
    },
    {
      id: "signatures",
      label: t.signatures,
      icon: <HugeiconsIcon icon={SignatureIcon} strokeWidth={1.75} aria-hidden="true" />,
    },
    {
      id: "appearance",
      label: t.appearance,
      icon: <HugeiconsIcon icon={PaintBoardIcon} strokeWidth={1.75} aria-hidden="true" />,
    },
    {
      id: "privacy",
      label: t.privacy,
      icon: <HugeiconsIcon icon={SecurityCheckIcon} strokeWidth={1.75} aria-hidden="true" />,
    },
  ]
  return (
    <SettingsDialog
      open={open}
      onOpenChange={onOpenChange}
      pages={pages}
      activePage={page}
      onActivePageChange={setPage}
      labels={{
        title: t.settings,
        description: t.settingsDescription,
        search: t.searchSettings,
        noResults: t.noSettings,
        close: t.close,
      }}
    >
      {page === "mailboxes" && <AccountsPage />}
      {page === "signatures" && <SignatureSettings />}
      {page === "appearance" && <AppearanceSettings />}
      {page === "privacy" && <PrivacySettings />}
    </SettingsDialog>
  )
}
