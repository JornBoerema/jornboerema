import { useEffect, useState } from "react"
import type { EvenAuthClient, SocialProvider } from "@even/auth/client"

export const PROVIDER_NAMES: Record<SocialProvider, string> = {
  google: "Google",
  microsoft: "Microsoft",
  apple: "Apple",
};

/** The providers' own marks, as their brand guidelines ask. */
export function ProviderLogo({ provider }: { provider: SocialProvider }) {
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
export function useSocialProviders(client: EvenAuthClient, enabled: boolean) {
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
