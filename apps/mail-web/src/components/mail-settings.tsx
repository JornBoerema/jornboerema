import { useState } from "react"
import {
  Mail01Icon,
  Notification03Icon,
  PaintBoardIcon,
  SecurityCheckIcon,
  SignatureIcon,
  SparklesIcon,
  UserCircleIcon,
} from "@hugeicons/core-free-icons"
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
import {
  SettingsDialog,
  SettingsRow,
  SettingsSection,
  type SettingsPage,
} from "@evido/ui/components/settings-dialog"
import { Switch } from "@evido/ui/components/switch"
import { useTheme, type Theme } from "@evido/ui/lib/theme"
import { useI18n } from "@/i18n"
import { notificationsSupported } from "@/lib/notifications"
import {
  setAlwaysShowImages,
  setNotifyNewMail,
  setAiWriting,
  setFindCodes,
  setSummaries,
  useAlwaysShowImages,
  useAiWriting,
  useFindCodes,
  useNotifyNewMail,
  useSummaries,
} from "@/lib/preferences"
import { AccountSettings } from "@/components/account-settings"
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

function NotificationSettings() {
  const t = useI18n().t.notifications
  const enabled = useNotifyNewMail()
  const supported = notificationsSupported()
  const [permission, setPermission] = useState(() => (supported ? Notification.permission : "denied"))
  const blocked = permission === "denied"
  return (
    <SettingsSection title={t.title} description={t.deviceOnly}>
      <SettingsRow
        title={t.toggle}
        htmlFor="notify-new-mail"
        description={!supported ? t.unsupported : blocked ? t.blocked : t.toggleHelp}
      >
        <Switch
          id="notify-new-mail"
          checked={enabled && permission === "granted"}
          disabled={!supported || blocked}
          onCheckedChange={async (on) => {
            if (!on) return setNotifyNewMail(false)
            // The browser only asks after a click, which this is.
            const answer = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission
            setPermission(answer)
            setNotifyNewMail(answer === "granted")
          }}
        />
      </SettingsRow>
    </SettingsSection>
  )
}

function PrivacySettings() {
  const t = useI18n().t.privacy
  const alwaysShow = useAlwaysShowImages()
  return (
    <SettingsSection title={t.images} description={t.saved}>
      <SettingsRow title={t.alwaysShow} htmlFor="always-show-images" description={t.alwaysShowHelp}>
        <Switch id="always-show-images" checked={alwaysShow} onCheckedChange={setAlwaysShowImages} />
      </SettingsRow>
    </SettingsSection>
  )
}

function AiSettings() {
  const t = useI18n().t.ai
  const summaries = useSummaries()
  const codes = useFindCodes()
  const writing = useAiWriting()
  return (
    <SettingsSection title={t.title} description={t.saved}>
      <SettingsRow title={t.summaries} htmlFor="mail-summaries" description={t.summariesHelp}>
        <Switch id="mail-summaries" checked={summaries} onCheckedChange={setSummaries} />
      </SettingsRow>
      <SettingsRow title={t.writing} htmlFor="mail-ai-writing" description={t.writingHelp}>
        <Switch id="mail-ai-writing" checked={writing} onCheckedChange={setAiWriting} />
      </SettingsRow>
      <SettingsRow title={t.codes} htmlFor="mail-codes" description={t.codesHelp}>
        <Switch id="mail-codes" checked={codes} onCheckedChange={setFindCodes} />
      </SettingsRow>
    </SettingsSection>
  )
}

/** The page a link back into the app asks for, such as after confirming a new email. */
function linkedPage() {
  return new URLSearchParams(window.location.search).get("settings") === "account" ? "account" : "mailboxes"
}

export function MailSettings({
  open,
  onOpenChange,
  user,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: { name: string; email: string }
}) {
  const t = useI18n().t.shell
  const [page, setPage] = useState(linkedPage)
  // As in Even doen: the account first, then what belongs to this app.
  const pages: SettingsPage[] = [
    {
      id: "account",
      label: t.accountPage,
      icon: <HugeiconsIcon icon={UserCircleIcon} strokeWidth={1.75} aria-hidden="true" />,
    },
    {
      id: "appearance",
      label: t.appearance,
      icon: <HugeiconsIcon icon={PaintBoardIcon} strokeWidth={1.75} aria-hidden="true" />,
    },
    {
      id: "mailboxes",
      label: t.mailboxes,
      group: t.mailGroup,
      icon: <HugeiconsIcon icon={Mail01Icon} strokeWidth={1.75} aria-hidden="true" />,
    },
    {
      id: "signatures",
      label: t.signatures,
      group: t.mailGroup,
      icon: <HugeiconsIcon icon={SignatureIcon} strokeWidth={1.75} aria-hidden="true" />,
    },
    {
      id: "notifications",
      label: t.notifications,
      group: t.mailGroup,
      icon: <HugeiconsIcon icon={Notification03Icon} strokeWidth={1.75} aria-hidden="true" />,
    },
    {
      id: "ai",
      label: t.ai,
      group: t.mailGroup,
      icon: <HugeiconsIcon icon={SparklesIcon} strokeWidth={1.75} aria-hidden="true" />,
    },
    {
      id: "privacy",
      label: t.privacy,
      group: t.mailGroup,
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
      {page === "account" && <AccountSettings user={user} />}
      {page === "mailboxes" && <AccountsPage />}
      {page === "signatures" && <SignatureSettings />}
      {page === "notifications" && <NotificationSettings />}
      {page === "ai" && <AiSettings />}
      {page === "appearance" && <AppearanceSettings />}
      {page === "privacy" && <PrivacySettings />}
    </SettingsDialog>
  )
}
