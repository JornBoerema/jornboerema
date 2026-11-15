import { useEffect, useState } from "react"
import { isDesktop } from "@even/auth/client"
import { AboutSettings, useAboutPage } from "@even/ui/components/desktop-app"
import {
  Mail01Icon,
  Notification03Icon,
  PaintBoardIcon,
  PuzzleIcon,
  Plug01Icon,
  SecurityCheckIcon,
  SignatureIcon,
  SparklesIcon,
  UserCircleIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { LANGUAGE_NAMES, LANGUAGES } from "@even/i18n"
import type { LanguagePreference } from "@even/i18n/react"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@even/ui/components/select"
import { DesktopSettingsPages, useDesktopSettings } from "@even/ui/components/desktop-settings"
import {
  SettingsDialog,
  SettingsRow,
  SettingsSection,
  type SettingsPage,
} from "@even/ui/components/settings-dialog"
import { Switch } from "@even/ui/components/switch"
import { useTheme, type Theme } from "@even/ui/lib/theme"
import { useI18n } from "@/i18n"
import { notificationsSupported } from "@/lib/notifications"
import {
  setAlwaysShowImages,
  setNotifyNewMail,
  setAiWriting,
  setFindCodes,
  setSummaries,
  setReplySuggestions,
  useReplySuggestions,
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
import { ConnectionSettings } from "@/components/connection-settings"
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
  const replies = useReplySuggestions()
  return (
    <SettingsSection title={t.title} description={t.saved}>
      <SettingsRow title={t.summaries} htmlFor="mail-summaries" description={t.summariesHelp}>
        <Switch id="mail-summaries" checked={summaries} onCheckedChange={setSummaries} />
      </SettingsRow>
      <SettingsRow title={t.replies} htmlFor="mail-reply-suggestions" description={t.repliesHelp}>
        <Switch id="mail-reply-suggestions" checked={replies} onCheckedChange={setReplySuggestions} />
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
/** The first page, unless a connect flow just returned here: then its result, under its page. */
/** The settings page a link asks for: after connecting a mailbox or a service, or from an e-mail. */
export function linkedSettingsPage() {
  const params = new URLSearchParams(window.location.search)
  if (params.get("settings") === "account") return "account"
  if (params.get("settings") === "connections") return "connections"
  return params.has("connected") || params.has("error") ? "mailboxes" : "account"
}

export function MailSettings({
  open,
  onOpenChange,
  user,
  sharedOnly = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: { name: string; email: string }
  /**
   * Only the pages every app shares (account, appearance, about): for someone who
   * can't use Even mailen yet. In the desktop app and the web shell those pages come
   * from mail, so without them the settings would have no account page at all.
   */
  sharedOnly?: boolean
}) {
  const strings = useI18n().t
  const t = strings.shell
  const [page, setPage] = useState(linkedSettingsPage)
  // Every time the settings open, they start at the first page.
  useEffect(() => {
    if (open) setPage(linkedSettingsPage())
  }, [open])
  const about = useAboutPage()
  const desktop = useDesktopSettings("mail")
  // As in Even doen: the account first, then what belongs to this app.
  const allPages: SettingsPage[] = [
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
      id: "features",
      label: strings.features.title,
      group: t.mailGroup,
      icon: <HugeiconsIcon icon={PuzzleIcon} strokeWidth={1.75} aria-hidden="true" />,
    },
    {
      id: "connections",
      label: t.connections,
      // In the desktop app one page for every app's connections.
      group: desktop ? undefined : t.mailGroup,
      icon: <HugeiconsIcon icon={Plug01Icon} strokeWidth={1.75} aria-hidden="true" />,
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
  const pages = sharedOnly ? allPages.filter((p) => ["account", "appearance", "about"].includes(p.id)) : allPages
  const content = (id: string) => (
    <>
      {id === "account" && <AccountSettings user={user} />}
      {id === "mailboxes" && <AccountsPage />}
      {id === "signatures" && <SignatureSettings />}
      {id === "notifications" && <NotificationSettings />}
      {id === "ai" && <AiSettings />}
      {id === "features" && <FeatureSettings />}
      {id === "appearance" && <AppearanceSettings />}
      {id === "about" && <AboutSettings />}
      {id === "privacy" && <PrivacySettings />}
      {id === "connections" && <ConnectionSettings title={desktop ? "Even mailen" : undefined} />}
    </>
  )
  if (desktop) return <DesktopSettingsPages app="mail" pages={pages}>{content}</DesktopSettingsPages>
  // Standalone, someone without access has no settings to open.
  if (sharedOnly) return null
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
      {content(page)}
    </SettingsDialog>
  )
}
