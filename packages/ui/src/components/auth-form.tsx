import { useEffect, useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import {
  ArrowLeft02Icon,
  ArrowRight02Icon,
  Loading03Icon,
  Mail01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { webUrl, type EvenAuthClient, type SocialProvider } from "@even/auth/client"
import { Alert, AlertDescription, AlertTitle } from "@even/ui/components/alert"
import { Button } from "@even/ui/components/button"
import { Checkbox } from "@even/ui/components/checkbox"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@even/ui/components/field"
import { Input } from "@even/ui/components/input"

export type AuthMode = "login" | "register" | "forgot" | "reset";

type FormCopy = { title: string; description: string; action: string };

/** Every app words its own pages; the form only needs these keys. */
export type AuthTexts = Record<AuthMode, FormCopy> & {
  noConnection: string;
  errors: {
    invalidCredentials: string;
    emailNotVerified: string;
    tooManyRequests: string;
    invalidToken: string;
    passwordTooShort: string;
    generic: string;
    passwordMismatch: string;
  };
  social: {
    divider: string;
    continueWith: string;
    accountNotLinked: string;
    failed: string;
  };
  sent: { title: string; register: string; forgot: string; spam: string };
  passwordChanged: { title: string; description: string };
  verificationExpired: { title: string; description: string };
  invalidReset: { title: string; action: string };
  fields: {
    name: string;
    namePlaceholder: string;
    email: string;
    emailPlaceholder: string;
    password: string;
    forgot: string;
    passwordHint: string;
    remember: string;
    confirm: string;
  };
  switch: {
    noAccount: string;
    createAccount: string;
    haveAccount: string;
    signIn: string;
    backToSignIn: string;
  };
};

const ICON = { strokeWidth: 2, "aria-hidden": true } as const;

const PROVIDER_NAMES: Record<SocialProvider, string> = {
  google: "Google",
  microsoft: "Microsoft",
  apple: "Apple",
};

/** The providers' own marks, as their brand guidelines ask. */
function ProviderLogo({ provider }: { provider: SocialProvider }) {
  if (provider === "google")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[18px]">
        <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z" />
        <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3.02c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24Z" />
        <path fill="#FBBC05" d="M5.29 14.28A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.28V6.61H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.39l4.01-3.11Z" />
        <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.28 6.61l4.01 3.11C6.23 6.88 8.88 4.77 12 4.77Z" />
      </svg>
    );
  if (provider === "microsoft")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[18px]">
        <path fill="#F25022" d="M1 1h10.5v10.5H1z" />
        <path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z" />
        <path fill="#00A4EF" d="M1 12.5h10.5V23H1z" />
        <path fill="#FFB900" d="M12.5 12.5H23V23H12.5z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[18px]" fill="currentColor">
      <path d="M16.37 12.74c-.03-2.65 2.16-3.92 2.26-3.98-1.23-1.8-3.15-2.05-3.83-2.08-1.63-.17-3.18.96-4.01.96-.83 0-2.1-.94-3.46-.91-1.78.03-3.42 1.03-4.34 2.62-1.85 3.21-.47 7.96 1.33 10.56.88 1.27 1.93 2.7 3.3 2.65 1.33-.05 1.83-.86 3.43-.86 1.6 0 2.05.86 3.46.83 1.43-.03 2.33-1.29 3.2-2.57 1.01-1.47 1.42-2.9 1.45-2.97-.03-.01-2.77-1.06-2.79-4.25ZM13.74 4.96c.73-.89 1.22-2.11 1.09-3.34-1.05.04-2.33.7-3.08 1.58-.67.78-1.27 2.03-1.11 3.23 1.18.09 2.37-.6 3.1-1.47Z" />
    </svg>
  );
}

/** Which provider buttons to show: the ones the API has keys for. */
function useSocialProviders(client: EvenAuthClient, enabled: boolean) {
  const [providers, setProviders] = useState<SocialProvider[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    client
      .$fetch<{ providers: SocialProvider[] }>("/sign-in/providers", { method: "GET" })
      .then(({ data }) => {
        if (current && data) setProviders(data.providers);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [client, enabled]);
  return providers;
}

function errorMessage(t: AuthTexts, code?: string) {
  if (code === "INVALID_EMAIL_OR_PASSWORD") return t.errors.invalidCredentials;
  if (code === "EMAIL_NOT_VERIFIED") return t.errors.emailNotVerified;
  if (code === "TOO_MANY_REQUESTS") return t.errors.tooManyRequests;
  if (code === "INVALID_TOKEN" || code === "TOKEN_EXPIRED") return t.errors.invalidToken;
  if (code === "PASSWORD_TOO_SHORT") return t.errors.passwordTooShort;
  return t.errors.generic;
}
/** Sign-in, sign-up and password recovery, shared by the Even web apps. */
export function AuthForm({
  mode,
  client: authClient,
  texts: t,
  returnTo = "/",
  legal,
}: {
  mode: AuthMode;
  client: EvenAuthClient;
  texts: AuthTexts;
  /** Where to continue after signing in: a path here, or an app's absolute URL. */
  returnTo?: string;
  /** Under the sign-up button: what making an account agrees to. */
  legal?: React.ReactNode;
}) {
  const copy = t;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const authHref = (path: string) =>
    returnTo === "/"
      ? path
      : `${path}${path.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(returnTo)}`;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [socialPending, setSocialPending] = useState<SocialProvider | null>(null);
  const providers = useSocialProviders(authClient, mode === "login" || mode === "register");
  const socialError = params.get("social") ? params.get("error") : null;
  const token = params.get("token");
  const invalidReset = mode === "reset" && (!token || !!params.get("error"));
  async function submit(event: FormEvent<HTMLFormElement>) {
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
      setError(t.errors.passwordMismatch);
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
                  redirectTo: webUrl("/reset-password"),
                })
              : await authClient.resetPassword({
                  newPassword: password,
                  token: token!,
                });
      if (result.error) {
        setError(errorMessage(t, result.error.code));
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
        if (mode === "reset") navigate(authHref("/login?passwordReset=1"));
        else if (/^https?:\/\//.test(returnTo)) window.location.assign(returnTo);
        else navigate(returnTo);
      }
    } catch {
      setError(t.noConnection);
    } finally {
      setPending(false);
    }
  }
  async function signInWith(provider: SocialProvider) {
    if (pending || socialPending) return;
    setError("");
    setSocialPending(provider);
    // A failed attempt comes back to this page, marked so it isn't read as an expired link.
    const back = new URL(window.location.href);
    back.searchParams.delete("error");
    back.searchParams.delete("error_description");
    back.searchParams.set("social", "1");
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: webUrl(returnTo),
        errorCallbackURL: back.toString(),
      });
      if (result.error) {
        setError(errorMessage(t, result.error.code));
        setSocialPending(null);
      }
      // Otherwise the browser is on its way to the provider.
    } catch {
      setError(t.noConnection);
      setSocialPending(null);
    }
  }
  const busy = pending || !!socialPending;
  if (sent)
    return (
      <section className="auth-form">
        <HugeiconsIcon icon={Mail01Icon} {...ICON} className="size-7 text-primary" />
        <h1>{t.sent.title}</h1>
        <p className="text-muted-foreground">
          {mode === "register" ? t.sent.register : t.sent.forgot}
        </p>
        <p className="text-sm text-muted-foreground">
          {t.sent.spam}
        </p>
        <Button asChild variant="outline">
          <Link to={authHref("/login")}>
            <HugeiconsIcon icon={ArrowLeft02Icon} {...ICON} data-icon="inline-start" />
            {t.switch.backToSignIn}
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
      {params.get("passwordReset") && (
        <Alert>
          <AlertTitle>{t.passwordChanged.title}</AlertTitle>
          <AlertDescription>{t.passwordChanged.description}</AlertDescription>
        </Alert>
      )}
      {socialError && (
        <Alert variant="destructive">
          <AlertDescription>
            {socialError === "account_not_linked" ? t.social.accountNotLinked : t.social.failed}
          </AlertDescription>
        </Alert>
      )}
      {params.get("error") && !socialError && mode === "login" && (
        <Alert variant="destructive">
          <AlertTitle>{t.verificationExpired.title}</AlertTitle>
          <AlertDescription>{t.verificationExpired.description}</AlertDescription>
        </Alert>
      )}
      {invalidReset ? (
        <Alert variant="destructive">
          <AlertTitle>{t.invalidReset.title}</AlertTitle>
          <AlertDescription>
            <Link to="/forgot-password" className="underline">
              {t.invalidReset.action}
            </Link>
          </AlertDescription>
        </Alert>
      ) : (
        <>
        {providers.length > 0 && (
          <div className="flex flex-col gap-3">
            {providers.map((provider) => (
              <Button
                key={provider}
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => signInWith(provider)}
              >
                {socialPending === provider ? (
                  <HugeiconsIcon icon={Loading03Icon} {...ICON} className="animate-spin" data-icon="inline-start" />
                ) : (
                  <ProviderLogo provider={provider} />
                )}
                {t.social.continueWith.replace("{provider}", PROVIDER_NAMES[provider])}
              </Button>
            ))}
            <div className="auth-divider" role="separator">
              <span>{t.social.divider}</span>
            </div>
          </div>
        )}
        <form onSubmit={submit} className="flex flex-col gap-5">
          <FieldGroup>
            {mode === "register" && (
              <Field>
                <FieldLabel htmlFor="name">{t.fields.name}</FieldLabel>
                <Input
                  id="name"
                  name="name"
                  autoComplete="name"
                  placeholder={t.fields.namePlaceholder}
                  maxLength={100}
                  required
                  disabled={pending}
                />
              </Field>
            )}
            {mode !== "reset" && (
              <Field>
                <FieldLabel htmlFor="email">{t.fields.email}</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder={t.fields.emailPlaceholder}
                  required
                  maxLength={254}
                  disabled={pending}
                />
              </Field>
            )}
            {mode !== "forgot" && (
              <Field>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel htmlFor="password">{t.fields.password}</FieldLabel>
                  {mode === "login" && (
                    <Link className="form-link" to="/forgot-password">
                      {t.fields.forgot}
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
                  <FieldDescription>{t.fields.passwordHint}</FieldDescription>
                )}
              </Field>
            )}
            {mode === "login" && (
              <Field orientation="horizontal">
                <Checkbox id="remember" name="remember" defaultChecked disabled={pending} />
                <FieldLabel htmlFor="remember" className="font-normal">
                  {t.fields.remember}
                </FieldLabel>
              </Field>
            )}
            {(mode === "register" || mode === "reset") && (
              <Field
                data-invalid={error === t.errors.passwordMismatch}
              >
                <FieldLabel htmlFor="confirm">{t.fields.confirm}</FieldLabel>
                <Input
                  id="confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  disabled={pending}
                  aria-invalid={error === t.errors.passwordMismatch}
                />
              </Field>
            )}
          </FieldGroup>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={busy}>
            {pending ? (
              <HugeiconsIcon icon={Loading03Icon} {...ICON} className="animate-spin" data-icon="inline-start" />
            ) : null}
            {copy[mode].action}
            {!pending && <HugeiconsIcon icon={ArrowRight02Icon} {...ICON} data-icon="inline-end" />}
          </Button>
          {mode === "register" && legal && <p className="auth-legal">{legal}</p>}
        </form>
        </>
      )}
      <p className="auth-switch">
        {mode === "login" ? (
          <>
            {t.switch.noAccount}{" "}
            <Link to={authHref("/signup")}>{t.switch.createAccount}</Link>
          </>
        ) : mode === "register" ? (
          <>
            {t.switch.haveAccount} <Link to={authHref("/login")}>{t.switch.signIn}</Link>
          </>
        ) : (
          <Link to={authHref("/login")}>{t.switch.backToSignIn}</Link>
        )}
      </p>
    </section>
  );
}
