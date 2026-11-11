import { useEffect, useState } from "react"
import { isDesktop } from "@evido/auth/client"
import { AboutSettings, useAboutPage } from "@evido/ui/components/desktop-app"
import {
  Mail01Icon,
  Notification03Icon,
  PaintBoardIcon,
  PuzzleIcon,
  SecurityCheckIcon,
  SignatureIcon,
  SparklesIcon,
  UserCircleIcon,
  LayoutLeftIcon,
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
import { Button } from "@evido/ui/components/button"
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
  setParcels,
  setInvoices,
  setTodos,
  setPins,
  setSenders,
  setUnsubscribe,
  useParcels,
  useInvoices,
  useTodos,
  usePins,
  useSenders,
  useUnsubscribe,
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
  // The desktop app asks the system for its permission, which takes a moment.
  useEffect(() => {
    if (!supported || !isDesktop()) return
    const timer = window.setTimeout(() => setPermission(Notification.permission), 500)
    return () => window.clearTimeout(timer)
  }, [supported])
  const blocked = permission === "denied"
  const desktop = isDesktop()
  return (
    <SettingsSection title={t.title} description={desktop ? t.desktop.deviceOnly : t.deviceOnly}>
      <SettingsRow
        title={t.toggle}
        htmlFor="notify-new-mail"
        description={
          !supported ? t.unsupported : blocked ? (desktop ? t.desktop.blocked : t.blocked) : desktop ? t.desktop.toggleHelp : t.toggleHelp
        }
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

/** Extras that can each be turned off, like Parcels. */
function FeatureSettings() {
  const t = useI18n().t.features
  const parcels = useParcels()
  const unsubscribe = useUnsubscribe()
  const senders = useSenders()
  const invoices = useInvoices()
  const todos = useTodos()
  const pins = usePins()
  return (
    <SettingsSection title={t.title} description={t.description}>
      <SettingsRow title={t.parcels} htmlFor="mail-parcels" description={t.parcelsHelp}>
        <Switch id="mail-parcels" checked={parcels} onCheckedChange={setParcels} />
      </SettingsRow>
      <SettingsRow title={t.invoices} htmlFor="mail-invoices" description={t.invoicesHelp}>
        <Switch id="mail-invoices" checked={invoices} onCheckedChange={setInvoices} />
      </SettingsRow>
      <SettingsRow title={t.pins} htmlFor="mail-pins" description={t.pinsHelp}>
        <Switch id="mail-pins" checked={pins} onCheckedChange={setPins} />
      </SettingsRow>
      <SettingsRow title={t.todos} htmlFor="mail-todos" description={t.todosHelp}>
        <Switch id="mail-todos" checked={todos} onCheckedChange={setTodos} />
      </SettingsRow>
      <SettingsRow title={t.senders} htmlFor="mail-senders" description={t.sendersHelp}>
        <Switch id="mail-senders" checked={senders} onCheckedChange={setSenders} />
      </SettingsRow>
      <SettingsRow title={t.unsubscribe} htmlFor="mail-unsubscribe" description={t.unsubscribeHelp}>
        <Switch id="mail-unsubscribe" checked={unsubscribe} onCheckedChange={setUnsubscribe} />
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

/** The sidebar is arranged in place; this only starts it. */
function SidebarSettings({ onArrange }: { onArrange: () => void }) {
  const strings = useI18n().t
  const t = strings.sidebarPage
  // Arranged in place, where the sidebar is open: only on wider screens.
  return (
    <SettingsSection title={strings.shell.sidebarPage}>
      <SettingsRow title={t.arrange} description={t.description}>
        <Button variant="outline" className="max-lg:hidden" onClick={onArrange}>
          {t.start}
        </Button>
      </SettingsRow>
    </SettingsSection>
  )
}

export function MailSettings({
  open,
  onOpenChange,
  user,
  onCustomizeSidebar,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: { name: string; email: string }
  /** Closes the settings and arranges the sidebar in place. */
  onCustomizeSidebar: () => void
}) {
  const strings = useI18n().t
  const t = strings.shell
  const [page, setPage] = useState(linkedPage)
  const about = useAboutPage()
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
      id: "sidebar",
      label: t.sidebarPage,
      group: t.mailGroup,
      icon: <HugeiconsIcon icon={LayoutLeftIcon} strokeWidth={1.75} aria-hidden="true" />,
    },
    {
      id: "features",
      label: strings.features.title,
      group: t.mailGroup,
      icon: <HugeiconsIcon icon={PuzzleIcon} strokeWidth={1.75} aria-hidden="true" />,
    },
    {
      id: "privacy",
      label: t.privacy,
      group: t.mailGroup,
      icon: <HugeiconsIcon icon={SecurityCheckIcon} strokeWidth={1.75} aria-hidden="true" />,
    },
    // Only in the desktop app: its version and updates.
    ...(about ? [about] : []),
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
      {page === "features" && <FeatureSettings />}
      {page === "sidebar" && <SidebarSettings onArrange={onCustomizeSidebar} />}
      {page === "appearance" && <AppearanceSettings />}
      {page === "about" && <AboutSettings />}
      {page === "privacy" && <PrivacySettings />}
    </SettingsDialog>
  )
}
