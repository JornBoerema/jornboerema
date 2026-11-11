import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

/**
 * Reads mail not seen yet in the background, round after round, while the list
 * shows what is already known. Each round that found something refreshes the
 * list. True once everything is read (or reading failed: the list stays as is).
 */
export function useBackgroundScan(path: string, listKey: readonly unknown[], enabled: boolean) {
  const queryClient = useQueryClient()
  const scan = useQuery({
    queryKey: [...listKey, "scan"],
    queryFn: async () => {
      const result = await api<{ done: boolean; read: number }>(path, { method: "POST" })
      if (result.read > 0) void queryClient.invalidateQueries({ queryKey: listKey, exact: true })
      return result
    },
    enabled,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (query.state.data?.done === false ? 500 : false),
  })
  return scan.isError || scan.data?.done === true
}
