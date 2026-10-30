import { Link } from "react-router";
import { useNavigate, useSearchParams } from "react-router";
import { useState } from "react";
import { ArrowLeft, ArrowRight, LoaderCircle, Mail } from "@/components/icons";
import { invitationReturnTo } from "@evido/todo-core/sharing";
import { authClient } from "@/lib/auth-client";
import { webUrl } from "@/lib/api";
import { Button } from "@evido/ui/components/button";
import { Input } from "@evido/ui/components/input";
import { Checkbox } from "@evido/ui/components/checkbox";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@evido/ui/components/field";
import { Alert, AlertTitle, AlertDescription } from "@evido/ui/components/alert";

type Mode = "login" | "register" | "forgot" | "reset";
const copy = {
  login: {
    title: "Welkom terug",
    description: "Log in en ga verder met je lijsten.",
    action: "Inloggen",
  },
  register: {
    title: "Maak ruimte in je hoofd",
    description: "Maak een account aan voor je eigen takenlijsten.",
    action: "Account aanmaken",
  },
  forgot: {
    title: "Wachtwoord vergeten?",
    description: "We sturen je een link om een nieuw wachtwoord te kiezen.",
    action: "Verstuur herstellink",
  },
  reset: {
    title: "Een nieuw wachtwoord",
    description: "Kies een nieuw wachtwoord voor je account.",
    action: "Wachtwoord opslaan",
  },
};
function errorMessage(code?: string) {
  if (code === "INVALID_EMAIL_OR_PASSWORD")
    return "Je e-mailadres of wachtwoord klopt niet.";
  if (code === "EMAIL_NOT_VERIFIED")
    return "Bevestig eerst je e-mailadres. We hebben je een nieuwe bevestigingslink gestuurd.";
  if (code === "TOO_MANY_REQUESTS")
    return "Te veel pogingen. Wacht even en probeer het opnieuw.";
  if (code === "INVALID_TOKEN" || code === "TOKEN_EXPIRED")
    return "Deze link is ongeldig of verlopen. Vraag een nieuwe link aan.";
  if (code === "PASSWORD_TOO_SHORT")
    return "Gebruik minstens 8 tekens voor je wachtwoord.";
  return "Dit is niet gelukt. Controleer je gegevens en probeer het opnieuw.";
}
export function AuthForm({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = invitationReturnTo(params.get("returnTo"));
  const authHref = (path: string) =>
    returnTo === "/"
      ? path
      : `${path}${path.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(returnTo)}`;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const token = params.get("token");
  const invalidReset = mode === "reset" && (!token || !!params.get("error"));
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    if (
      (mode === "register" || mode === "reset") &&
      password !== data.get("confirm")
    ) {
      setError("De wachtwoorden komen niet overeen.");
      return;
    }
    setPending(true);
    try {
      const result =
        mode === "login"
          ? await authClient.signIn.email({
              email,
              password,
              // Off: a browser-session cookie that ends when the browser closes.
              rememberMe: data.get("remember") === "on",
              callbackURL: webUrl(returnTo),
            })
          : mode === "register"
            ? await authClient.signUp.email({
                name: String(data.get("name")).trim(),
                email,
                password,
                callbackURL: webUrl(returnTo),
              })
            : mode === "forgot"
              ? await authClient.requestPasswordReset({
                  email,
                  redirectTo: webUrl("/wachtwoord-herstellen"),
                })
              : await authClient.resetPassword({
                  newPassword: password,
                  token: token!,
                });
      if (result.error) {
        setError(errorMessage(result.error.code));
        return;
      }
      // The OAuth client follows the provider's signed continuation redirect.
      if (
        mode === "login" &&
        new URLSearchParams(window.location.search).has("client_id")
      )
        return;
      if (mode === "register" || mode === "forgot") setSent(true);
      else {
        navigate(mode === "reset" ? authHref("/inloggen?hersteld=1") : returnTo);
      }
    } catch {
      setError("Er is geen verbinding. Probeer het opnieuw.");
    } finally {
      setPending(false);
    }
  }
  if (sent)
    return (
      <section className="auth-form">
        <Mail className="size-7 text-primary" aria-hidden="true" />
        <h1>Bekijk je inbox</h1>
        <p className="text-muted-foreground">
          {mode === "register"
            ? "Als dit adres nog niet geregistreerd is, ontvang je een link om je account te bevestigen. Daarna kun je meteen beginnen."
            : "Als er een account met dit e-mailadres bestaat, ontvang je een herstellink. De link is één uur geldig."}
        </p>
        <p className="text-sm text-muted-foreground">
          Niets ontvangen? Kijk ook in je spamfolder.
        </p>
        <Button asChild variant="outline">
          <Link to={authHref("/inloggen")}>
            <ArrowLeft data-icon="inline-start" />
            Terug naar inloggen
          </Link>
        </Button>
      </section>
    );
  return (
    <section className="auth-form">
      <div className="flex flex-col gap-2">
        <h1>{copy[mode].title}</h1>
        <p className="text-muted-foreground">{copy[mode].description}</p>
      </div>
      {params.get("hersteld") && (
        <Alert>
          <AlertTitle>Wachtwoord gewijzigd</AlertTitle>
          <AlertDescription>
            Je kunt inloggen met je nieuwe wachtwoord.
          </AlertDescription>
        </Alert>
      )}
      {params.get("error") && mode === "login" && (
        <Alert variant="destructive">
          <AlertTitle>Bevestigingslink verlopen</AlertTitle>
          <AlertDescription>
            Log hieronder in om een nieuwe bevestigingslink te ontvangen.
          </AlertDescription>
        </Alert>
      )}
      {invalidReset ? (
        <Alert variant="destructive">
          <AlertTitle>Deze link is ongeldig of verlopen</AlertTitle>
          <AlertDescription>
            <Link to="/wachtwoord-vergeten" className="underline">
              Vraag een nieuwe herstellink aan.
            </Link>
          </AlertDescription>
        </Alert>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-5">
          <FieldGroup>
            {mode === "register" && (
              <Field>
                <FieldLabel htmlFor="name">Naam</FieldLabel>
                <Input
                  id="name"
                  name="name"
                  autoComplete="name"
                  placeholder="Je naam"
                  maxLength={100}
                  required
                  disabled={pending}
                />
              </Field>
            )}
            {mode !== "reset" && (
              <Field>
                <FieldLabel htmlFor="email">E-mailadres</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="jij@voorbeeld.nl"
                  required
                  maxLength={254}
                  disabled={pending}
                />
              </Field>
            )}
            {mode !== "forgot" && (
              <Field>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel htmlFor="password">Wachtwoord</FieldLabel>
                  {mode === "login" && (
                    <Link className="form-link" to="/wachtwoord-vergeten">
                      Vergeten?
                    </Link>
                  )}
                </div>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  required
                  minLength={8}
                  maxLength={128}
                  disabled={pending}
                />
                {mode !== "login" && (
                  <FieldDescription>Minstens 8 tekens.</FieldDescription>
                )}
              </Field>
            )}
            {mode === "login" && (
              <Field orientation="horizontal">
                <Checkbox id="remember" name="remember" defaultChecked disabled={pending} />
                <FieldLabel htmlFor="remember" className="font-normal">
                  Ingelogd blijven
                </FieldLabel>
              </Field>
            )}
            {(mode === "register" || mode === "reset") && (
              <Field
                data-invalid={error === "De wachtwoorden komen niet overeen."}
              >
                <FieldLabel htmlFor="confirm">Herhaal wachtwoord</FieldLabel>
                <Input
                  id="confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  disabled={pending}
                  aria-invalid={error === "De wachtwoorden komen niet overeen."}
                />
              </Field>
            )}
          </FieldGroup>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : null}
            {copy[mode].action}
            {!pending && <ArrowRight data-icon="inline-end" />}
          </Button>
        </form>
      )}
      <p className="auth-switch">
        {mode === "login" ? (
          <>
            Nog geen account?{" "}
            <Link to={authHref("/registreren")}>Maak een account aan</Link>
          </>
        ) : mode === "register" ? (
          <>
            Al een account? <Link to={authHref("/inloggen")}>Inloggen</Link>
          </>
        ) : (
          <Link to={authHref("/inloggen")}>Terug naar inloggen</Link>
        )}
      </p>
    </section>
  );
}
