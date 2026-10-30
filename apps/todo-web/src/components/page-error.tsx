import { Button } from "@evido/ui/components/button"
import { Alert, AlertTitle, AlertDescription } from "@evido/ui/components/alert"

export function PageError({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="mx-auto flex max-w-lg flex-col gap-5 p-8">
      <Alert variant="destructive">
        <AlertTitle>Je lijsten konden niet worden geladen</AlertTitle>
        <AlertDescription>
          Probeer het over een moment opnieuw. Je opgeslagen taken blijven bewaard.
        </AlertDescription>
      </Alert>
      <Button onClick={onRetry}>Opnieuw proberen</Button>
    </main>
  )
}
