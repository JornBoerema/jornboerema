import { Button } from "@evido/ui/components/button"
import { Alert, AlertTitle, AlertDescription } from "@evido/ui/components/alert"
import { useI18n } from "@/i18n"

export function PageError({ onRetry }: { onRetry: () => void }) {
  const t = useI18n().t.common.pageError
  return (
    <main className="mx-auto flex max-w-lg flex-col gap-5 p-8">
      <Alert variant="destructive">
        <AlertTitle>{t.title}</AlertTitle>
        <AlertDescription>{t.description}</AlertDescription>
      </Alert>
      <Button onClick={onRetry}>{t.retry}</Button>
    </main>
  )
}
