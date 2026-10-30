import { Skeleton } from "@evido/ui/components/skeleton"

export function PageLoading() {
  return (
    <main aria-label="Laden" className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </main>
  )
}
