import { useState } from "react";
import { useSearchParams } from "react-router";
import { authClient } from "@/lib/auth-client";
import { Button } from "@evido/ui/components/button";
import { useI18n } from "@/i18n";
export function OAuthConsent({ clientName }: { clientName: string }) {
  const { t: all } = useI18n();
  const t = all.auth.consent;
  const [params] = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function decide(accept: boolean) {
    setPending(true);
    setError("");
    try {
      const result = await authClient.oauth2.consent({ accept });
      if (result.error) {
        setError(t.failed);
        setPending(false);
        return;
      }
      // Better Auth follows the signed provider redirect automatically.
    } catch {
      setError(all.common.noConnection);
      setPending(false);
    }
  }
  return (
    <section className="w-full max-w-sm space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t.description(clientName)}
        </p>
      </div>
      <ul className="list-disc space-y-2 pl-5 text-sm">
        {(params.get("scope") ?? "")
          .split(" ")
          .filter(Boolean)
          .map((scope) => (
            <li key={scope}>{t.scopes[scope] ?? scope}</li>
          ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => decide(false)}
        >
          {all.common.cancel}
        </Button>
        <Button disabled={pending} onClick={() => decide(true)}>
          {t.allow}
        </Button>
      </div>
    </section>
  );
}
