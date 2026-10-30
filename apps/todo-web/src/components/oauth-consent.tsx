import { useState } from "react";
import { useSearchParams } from "react-router";
import { authClient } from "@/lib/auth-client";
import { Button } from "@evido/ui/components/button";
const permissions: Record<string, string> = {
  "todos:read": "Je lijsten en taken bekijken",
  "todos:write": "Lijsten en taken toevoegen, wijzigen en verwijderen",
  openid: "Je account herkennen",
  profile: "Je naam bekijken",
  email: "Je e-mailadres bekijken",
  offline_access: "Verbonden blijven totdat je de toegang intrekt",
};
export function OAuthConsent({ clientName }: { clientName: string }) {
  const [params] = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function decide(accept: boolean) {
    setPending(true);
    setError("");
    try {
      const result = await authClient.oauth2.consent({ accept });
      if (result.error) {
        setError(
          "Koppelen is niet gelukt. Start de koppeling opnieuw vanuit ChatGPT.",
        );
        setPending(false);
        return;
      }
      // Better Auth follows the signed provider redirect automatically.
    } catch {
      setError("Er is geen verbinding. Probeer opnieuw.");
      setPending(false);
    }
  }
  return (
    <section className="w-full max-w-sm space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Even doen koppelen</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Je geeft {clientName} toegang tot jouw account.
        </p>
      </div>
      <ul className="list-disc space-y-2 pl-5 text-sm">
        {(params.get("scope") ?? "")
          .split(" ")
          .filter(Boolean)
          .map((scope) => (
            <li key={scope}>{permissions[scope] ?? scope}</li>
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
          Annuleren
        </Button>
        <Button disabled={pending} onClick={() => decide(true)}>
          Toestaan
        </Button>
      </div>
    </section>
  );
}
