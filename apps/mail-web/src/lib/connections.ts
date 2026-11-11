import { isDesktop, webUrl } from "@evido/auth/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { ConnectionsView, MoneybirdExportView, MoneybirdThreadView } from "@evido/mail-core/connections"
import { api, errorText } from "@/lib/api"
import { conversationUrl } from "@/lib/mail"

export const CONNECTIONS_KEY = ["connections"]

export function useConnections(enabled = true) {
  return useQuery({
    queryKey: CONNECTIONS_KEY,
    queryFn: () => api<ConnectionsView>("/api/connections"),
    enabled,
    staleTime: 10 * 60_000,
  })
}

/** Moneybird when it is connected and usable, else null. */
export function useMoneybird(enabled = true) {
  const connection = useConnections(enabled).data?.connections.find((item) => item.provider === "moneybird")
  return connection?.status === "active" ? connection : null
}

export function useConnectMoneybird() {
  return useMutation({
    mutationFn: async () => {
      // Moneybird sends the browser back with a cookie session, which the
      // desktop app doesn't have, so it is connected on the web.
      if (isDesktop()) return { url: webUrl("/?settings=connections", "mail"), external: true }
      return api<{ url: string }>("/api/connections/moneybird/connect", { method: "POST" })
    },
    onSuccess: ({ url, external }: { url: string; external?: boolean }) =>
      external ? window.open(url, "_blank") : window.location.assign(url),
    onError: (error) => toast.error(errorText(error)),
  })
}

const moneybirdKey = (threadId: string) => ["mail-moneybird", threadId]

export function useMoneybirdThread(threadId: string, enabled: boolean) {
  return useQuery({
    queryKey: moneybirdKey(threadId),
    queryFn: () => api<MoneybirdThreadView>(conversationUrl(threadId, "/moneybird")),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
}

export type MoneybirdFile = { messageId: string; attachmentId: string; name: string; contentType: string; size: number }

export function useSendToMoneybird(threadId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: MoneybirdFile & { administrationId?: string; subject?: string }) =>
      api<{ export: MoneybirdExportView }>(conversationUrl(threadId, "/moneybird"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: ({ export: sent }) => {
      queryClient.setQueryData<MoneybirdThreadView>(moneybirdKey(threadId), (data) => ({
        exports: [sent, ...(data?.exports ?? []).filter((item) => item.attachmentKey !== sent.attachmentKey || item.administrationId !== sent.administrationId)],
        suggestedAdministrationId: sent.administrationId,
      }))
    },
  })
}
