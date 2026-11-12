import { useEffect, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { CheckmarkCircle02Icon, MailLock01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@evido/ui/components/empty"
import { Brand } from "@/components/brand"
import { useI18n } from "@/i18n"
import { api, errorText } from "@/lib/api"
import { signOut } from "@/lib/auth-client"
import { ACCESS_KEY as KEY } from "@/lib/cache"

type Access = { access: boolean; requested: boolean }

const ACCESS_QUERY = ["mail-access"]

/** Who was let in on this device, so the app opens at once while it is checked again. */
function rememberedFor(userId: string): Access | undefined {
  try {
    return localStorage.getItem(KEY) === userId ? { access: true, requested: false } : undefined
  } catch {
    return undefined
  }
}

function remember(userId: string, access: boolean) {
  try {
    if (access) localStorage.setItem(KEY, userId)
    else localStorage.removeItem(KEY)
  } catch {
    // Without storage the check just runs before the app shows.
  }
}

/**
 * Even mailen is invite-only for now. Signed-in users without access see why,
 * and can ask for it; the API refuses them either way.
 */
export function AccessGate({ user, children }: { user: { id: string; email: string }; children: ReactNode }) {
  const t = useI18n().t.access
  const queryClient = useQueryClient()
  const remembered = rememberedFor(user.id)
  const check = useQuery({
    queryKey: [...ACCESS_QUERY, user.id],
    queryFn: () => api<Access>("/api/access/mail"),
    initialData: remembered,
    // Remembered access is checked again right away, in the background.
    initialDataUpdatedAt: 0,
    staleTime: 60_000,
  })
  const access = check.data?.access
  useEffect(() => {
    if (access !== undefined) remember(user.id, access)
  }, [access, user.id])

  const request = useMutation({
    mutationFn: () => api<Access>("/api/access/mail/request", { method: "POST" }),
    onSuccess: (data) => queryClient.setQueryData([...ACCESS_QUERY, user.id], data),
    onError: (error) => toast.error(errorText(error)),
  })

  // Unreachable check: the app tries anyway, since the API refuses outsiders itself.
  if (access || (check.isError && !check.data)) return children
  if (!check.data) return null
  const requested = check.data.requested
  return (
    <div className="auth-layout">
      <header>
        <Brand />
      </header>
      <main className="auth-main">
        <Empty className="max-w-md">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={requested ? CheckmarkCircle02Icon : MailLock01Icon} strokeWidth={1.75} />
            </EmptyMedia>
            <EmptyTitle>{requested ? t.requestedTitle : t.title}</EmptyTitle>
            <EmptyDescription>{requested ? t.requestedBody : t.body(user.email)}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {!requested && (
              <Button disabled={request.isPending} onClick={() => request.mutate()}>
                {t.request}
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              {t.otherEmail}{" "}
              <button type="button" className="underline underline-offset-2" onClick={() => void signOut()}>
                {t.signOut}
              </button>
            </p>
          </EmptyContent>
        </Empty>
      </main>
    </div>
  )
}
