import { Skeleton } from "@evido/ui/components/skeleton"
import { useI18n } from "@/i18n"

export function PageLoading() {
  const { t } = useI18n()
  return (
    <main aria-label={t.common.loading} className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </main>
  )
}
