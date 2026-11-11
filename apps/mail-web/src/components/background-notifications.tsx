import { useMemo } from "react"
import { useI18n } from "@/i18n"
import { authClient } from "@/lib/auth-client"
import { useAccounts, useMailRealtime, useUnread } from "@/lib/mail"
import { useNewMailNotifications } from "@/lib/notifications"

const ignore = () => {}

function Watch({ userId }: { userId: string }) {
  const { t } = useI18n()
  const accounts = useAccounts()
  const hasActive = (accounts.data?.accounts ?? []).some((account) => account.status === "active")
  const unread = useUnread(hasActive)
  useMailRealtime(userId)
  const texts = useMemo(
    () => ({ newMail: t.notifications.newMail, unknownSender: t.inbox.unknownSender, noSubject: t.inbox.noSubject }),
    [t]
  )
  // The desktop notification can't say it was clicked; clicking it brings Even forward.
  useNewMailNotifications(unread.data?.latest, texts, ignore, { always: true })
  return null
}

/**
 * New-mail notifications while mail is out of view in the desktop app, where
 * another app is open and the mail screens (and their effects) are paused.
 */
export function BackgroundNotifications() {
  const { data } = authClient.useSession()
  return data ? <Watch userId={data.user.id} /> : null
}
