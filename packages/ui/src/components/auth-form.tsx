import { useEffect, useRef, useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import {
  ArrowLeft02Icon,
  ArrowRight02Icon,
  FingerPrintIcon,
  Loading03Icon,
  Mail01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { webUrl, type EvenAuthClient, type SocialProvider } from "@even/auth/client"
import { PROVIDER_NAMES, ProviderLogo, useSocialProviders } from "@even/ui/components/social-providers"
import { Alert, AlertDescription, AlertTitle } from "@even/ui/components/alert"
import { Button } from "@even/ui/components/button"
import { Checkbox } from "@even/ui/components/checkbox"
import { CodeInput } from "@even/ui/components/code-input"
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
  passkey: { signIn: string; failed: string };
  twoFactor: {
    title: string;
    description: string;
    backupTitle: string;
    backupDescription: string;
    code: string;
    backupCode: string;
    trustDevice: string;
    verify: string;
    useBackup: string;
    useApp: string;
    invalidCode: string;
    locked: string;
    expired: string;
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


function errorMessage(t: AuthTexts, code?: string) {
  if (code === "INVALID_EMAIL_OR_PASSWORD") return t.errors.invalidCredentials;
  if (code === "EMAIL_NOT_VERIFIED") return t.errors.emailNotVerified;
  if (code === "TOO_MANY_REQUESTS") return t.errors.tooManyRequests;
  if (code === "INVALID_TOKEN" || code === "TOKEN_EXPIRED") return t.errors.invalidToken;
  if (code === "PASSWORD_TOO_SHORT") return t.errors.passwordTooShort;
  if (code === "INVALID_CODE" || code === "INVALID_BACKUP_CODE") return t.twoFactor.invalidCode;
  if (code === "ACCOUNT_TEMPORARILY_LOCKED") return t.twoFactor.locked;
  return t.errors.generic;
}

/** Some client errors carry no code. */
const errorCode = (error: object) => ("code" in error && typeof error.code === "string" ? error.code : "");

/** The browser closed its passkey prompt, or another prompt replaced it: nothing to say. */
// A cancelled prompt is a NotAllowedError, which arrives as the passthrough code.
export const PASSKEY_DISMISSED = new Set(["AUTH_CANCELLED", "ERROR_CEREMONY_ABORTED", "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY"]);

const passkeysSupported = () =>
  typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";

/** The second step after the password: a code from the authenticator app, or a backup code. */
type Step = "credentials" | "totp" | "backup";
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
  const [passkeyPending, setPasskeyPending] = useState(false);
  const [step, setStep] = useState<Step>("credentials");
  const [code, setCode] = useState("");
  const secondStepForm = useRef<HTMLFormElement>(null);
  const alive = useRef(true);
  const providers = useSocialProviders(authClient, mode === "login" || mode === "register");
  const socialError = params.get("social") ? params.get("error") : null;
  const token = params.get("token");
  const invalidReset = mode === "reset" && (!token || !!params.get("error"));
  const canUsePasskey = mode === "login" && passkeysSupported();

  /** Signed in: on to where they were going. */
  function finish() {
    // The OAuth client follows the provider's signed continuation redirect.
    if (new URLSearchParams(window.location.search).has("client_id")) return;
    if (/^https?:\/\//.test(returnTo)) window.location.assign(returnTo);
    else navigate(returnTo);
  }

  // The browser offers saved passkeys in the e-mail field's suggestions.
  useEffect(() => {
    alive.current = true;
    if (!canUsePasskey) return;
    let cancelled = false;
    void (async () => {
      const available = await window.PublicKeyCredential.isConditionalMediationAvailable?.().catch(() => false);
      if (!available || cancelled) return;
      const result = await authClient.signIn.passkey({ autoFill: true }).catch(() => null);
      if (!cancelled && alive.current && result?.data) finish();
    })();
    return () => {
      cancelled = true;
      alive.current = false;
    };
    // Once per page: a new ceremony would cancel the one the browser holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUsePasskey]);

  async function signInWithPasskey() {
    if (busy) return;
    setError("");
    setPasskeyPending(true);
    try {
      const result = await authClient.signIn.passkey();
      if (result?.error) {
        if (!PASSKEY_DISMISSED.has(errorCode(result.error))) setError(t.passkey.failed);
        return;
      }
      finish();
    } catch {
      setError(t.noConnection);
    } finally {
      setPasskeyPending(false);
    }
  }

  async function verifySecondStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    const data = new FormData(event.currentTarget);
    const entered = step === "totp" ? code : String(data.get("code") ?? "").trim();
    const trustDevice = data.get("trust") === "on";
    if (step === "totp" && entered.length < 6) return;
    setPending(true);
    try {
      const result =
        step === "totp"
          ? await authClient.twoFactor.verifyTotp({ code: entered, trustDevice })
          : await authClient.twoFactor.verifyBackupCode({ code: entered, trustDevice });
      if (result.error) {
        // A wrong code: the boxes empty and take focus for the next try.
        setCode("");
        setTimeout(() => document.getElementById("code")?.focus(), 0);
        // The ten minutes to enter a code are over, or too many tries: start again.
        if (result.error.code === "INVALID_TWO_FACTOR_COOKIE" || result.error.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE") {
          setStep("credentials");
          setError(t.twoFactor.expired);
        } else setError(errorMessage(t, result.error.code));
        return;
      }
      finish();
    } catch {
      setError(t.noConnection);
    } finally {
      setPending(false);
    }
  }

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
      // Two-factor is on: the password was right, now the code.
      if (mode === "login" && result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect) {
        setCode("");
        setStep("totp");
        return;
      }
      if (mode === "register" || mode === "forgot") setSent(true);
      else if (mode === "reset") navigate(authHref("/login?passwordReset=1"));
      else finish();
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
  const busy = pending || !!socialPending || passkeyPending;
  if (step !== "credentials")
    return (
      <section className="auth-form">
        <div className="flex flex-col gap-2">
          <h1>{step === "totp" ? t.twoFactor.title : t.twoFactor.backupTitle}</h1>
          <p className="text-muted-foreground">
            {step === "totp" ? t.twoFactor.description : t.twoFactor.backupDescription}
          </p>
        </div>
        <form ref={secondStepForm} key={step} onSubmit={verifySecondStep} className="flex flex-col gap-5">
          <FieldGroup>
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor="code">{step === "totp" ? t.twoFactor.code : t.twoFactor.backupCode}</FieldLabel>
              {step === "totp" ? (
                <CodeInput
                  id="code"
                  value={code}
                  onChange={(value) => {
                    setCode(value);
                    if (value) setError("");
                  }}
                  // Six digits in: on its way, no button needed.
                  onComplete={() => secondStepForm.current?.requestSubmit()}
                  disabled={pending}
                  invalid={!!error}
                  autoFocus
                />
              ) : (
                <Input
                  id="code"
                  name="code"
                  autoFocus
                  required
                  autoComplete="off"
                  maxLength={32}
                  spellCheck={false}
                  disabled={pending}
                  aria-invalid={!!error}
                />
              )}
            </Field>
            <Field orientation="horizontal">
              <Checkbox id="trust" name="trust" disabled={pending} />
              <FieldLabel htmlFor="trust" className="font-normal">
                {t.twoFactor.trustDevice}
              </FieldLabel>
            </Field>
          </FieldGroup>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? (
              <HugeiconsIcon icon={Loading03Icon} {...ICON} className="animate-spin" data-icon="inline-start" />
            ) : null}
            {t.twoFactor.verify}
            {!pending && <HugeiconsIcon icon={ArrowRight02Icon} {...ICON} data-icon="inline-end" />}
          </Button>
        </form>
        <p className="auth-switch">
          <button
            type="button"
            className="form-link"
            disabled={pending}
            onClick={() => {
              setError("");
              setCode("");
              setStep(step === "totp" ? "backup" : "totp");
            }}
          >
            {step === "totp" ? t.twoFactor.useBackup : t.twoFactor.useApp}
          </button>
        </p>
        <p className="auth-switch">
          <button
            type="button"
            className="form-link"
            disabled={pending}
            onClick={() => {
              setError("");
              setStep("credentials");
            }}
          >
            {t.switch.backToSignIn}
          </button>
        </p>
      </section>
    );
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
        {(providers.length > 0 || canUsePasskey) && (
          <div className="flex flex-col gap-3">
            {canUsePasskey && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => void signInWithPasskey()}>
                <HugeiconsIcon
                  icon={passkeyPending ? Loading03Icon : FingerPrintIcon}
                  {...ICON}
                  className={passkeyPending ? "animate-spin" : undefined}
                  data-icon="inline-start"
                />
                {t.passkey.signIn}
              </Button>
            )}
            {/* Side by side, logo only: the page fits without scrolling. */}
            {providers.length > 0 && (
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${providers.length}, minmax(0, 1fr))` }}>
                {providers.map((provider) => {
                  const label = t.social.continueWith.replace("{provider}", PROVIDER_NAMES[provider]);
                  return (
                    <Button
                      key={provider}
                      type="button"
                      variant="outline"
                      disabled={busy}
                      aria-label={label}
                      title={label}
                      onClick={() => signInWith(provider)}
                    >
                      {socialPending === provider ? (
                        <HugeiconsIcon icon={Loading03Icon} {...ICON} className="animate-spin" />
                      ) : (
                        <ProviderLogo provider={provider} />
                      )}
                    </Button>
                  );
                })}
              </div>
            )}
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
                  // "webauthn": the browser also suggests saved passkeys here.
                  autoComplete={mode === "login" ? "email webauthn" : "email"}
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
