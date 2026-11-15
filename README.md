# Even

Monorepo (Turborepo + pnpm) voor de Even-apps. Alle apps delen één account (Better Auth), één database (Prisma op Neon), één API (Hono) en één design system (shadcn/ui, preset `b1HXwyUHA`).

## Structuur

```
apps/
  api/          Hono API (Node): /api/auth/*, todo- en mail-endpoints
  app-web/      app.jornboerema.nl — de Even web-app: mail, taken en notities (/mail, /todo, /notes), inloggen en het accountportaal
  mail-web/     Even mailen — geen eigen site; `./embed` wordt door de schil geladen
  todo-web/     Even doen — idem
  notes-web/    Even noteren — idem
  desktop/      Even voor macOS en Windows (Tauri 2): dezelfde schil als app-web
  home/         jornboerema.nl — de website, privacy, voorwaarden, download en /admin
  capture-desktop/  Even vastleggen — screenshot-app (Tauri 2 + React) voor macOS en Windows
packages/
  ui/           shadcn/ui componenten + globals.css (design tokens) — gedeeld door alle React-apps
  shell/        De Even-schil: balk met apps en één instellingenvenster, gebruikt door app-web en desktop
  db/           Prisma schema, migraties en client
  auth/         Better Auth server-config (`@even/auth/server`) en React-client (`@even/auth/client`)
  email/        Resend + e-mailteksten
  todo-core/    Todo-domein: types, zod-validatie, sortering, optimistic updates (API + alle todo-clients)
  mail-core/    Mail-domein: Gmail en Outlook achter één provider-interface, token-versleuteling
```

Gepland: todo-desktop (Tauri 2 + React), todo-mobile (Expo), screenshot-desktop, password manager. Desktop-apps hergebruiken de Vite-code en `@even/ui`; Expo gebruikt `@even/todo-core` en `@even/auth`.

## Starten

Vereist Node 22.12+ en pnpm 11.

```bash
pnpm install
cp .env.example .env                       # vul in, zie hieronder
pnpm db:deploy                             # migraties toepassen
pnpm dev:app                               # API op :4000, de web-app op :3007
```

### Omgevingsvariabelen (`.env` in de root)

| Variabele | Waarvoor |
| --- | --- |
| `DATABASE_URL` | Neon-branch `dev`, **pooled** (`-pooler` host, `sslmode=require`) |
| `DATABASE_URL_UNPOOLED` | Neon-branch `dev`, **direct**, voor migraties |
| `PROD_DATABASE_URL_UNPOOLED` | Neon-branch `production`, direct. Alleen voor `pnpm db:deploy:prod` |
| `BETTER_AUTH_URL` | Publieke origin van de API, lokaal `http://localhost:4000` |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` |
| `MAIL_TOKEN_KEY` | Versleutelt mailbox-tokens (`openssl rand -hex 32`). Kwijt = alle mailboxen opnieuw koppelen |
| `GOOGLE_MAIL_CLIENT_ID`, `GOOGLE_MAIL_CLIENT_SECRET` | Google OAuth-client, redirect `<API>/api/mail/callback/gmail` |
| `MICROSOFT_MAIL_CLIENT_ID`, `MICROSOFT_MAIL_CLIENT_SECRET` | Entra-app (elke organisatie + persoonlijk), redirect `<API>/api/mail/callback/outlook` |
| `AUTH_COOKIE_DOMAIN` | Alleen productie: bv. `.jornboerema.nl`, zodat sessies over subdomeinen gedeeld worden |
| `PASSKEY_RP_ID` | Optioneel: domein waar passkeys bij horen. Standaard `AUTH_COOKIE_DOMAIN` zonder punt, anders de host van `APP_WEB_URL`. Niet meer wijzigen zodra er passkeys zijn |
| `RESEND_API_KEY`, `EMAIL_FROM` | Resend; afzender moet bij een geverifieerd domein horen |
| `NEON_REALTIME_SECRET`, `NEON_REALTIME_URL` | Optioneel realtime via Neon Realtime (live query op `realtime_pings`); zonder synchroniseren clients elke 60 s |

De web-app heeft geen eigen `.env` nodig: lokaal praat hij met `http://localhost:4000`, een productie-build met `https://api.jornboerema.nl` (zie `apps/app-web/vite.config.ts`).

## Even vastleggen (screenshots)

Vereist Rust (`rustup`). Starten: `pnpm dev:capture`. De app staat alleen in de menubalk (macOS) of het systeemvak (Windows).

- ⌥⇧1 (macOS) / Ctrl+Shift+1 (Windows): screenshot van het scherm waar de muis staat → editor.
- ⌥⇧2 / Ctrl+Shift+2: gebied selecteren op een bevroren beeld (met kruisdraden en afmetingen) → editor. Esc of rechtermuisknop annuleert.
- ⌥⇧3 / Ctrl+Shift+3: venster kiezen; het venster onder de muis licht op, klik om het vast te leggen → editor. Op macOS wordt het zichtbare deel uit het bevroren scherm gesneden (de oude per-venster-API werkt niet meer op recente macOS); op Windows wordt het hele venster vastgelegd, ook bedekte delen.
- Sneltoetsen hierboven zijn de standaard; aan te passen in Instellingen.
- In de editor: tekengereedschap (pijl, rechthoek, ellips, lijn, pen, markeerstift, tekst, genummerde stappen, vervagen) met kleur/dikte, ⌘Z/⌘⇧Z. ⌘C/Ctrl+C kopieert en sluit, ⌘S/Ctrl+S slaat op, ⌘, opent Instellingen, Esc sluit.
- Geschiedenis (tray-menu → Geschiedenis…): elke screenshot blijft bewaard in de data-map van de app (`history/`, max. 500, oudste eerst weg), als grid per dag. Klik opent de editor; kopiëren, opslaan en verwijderen via hover. Kopieer of bewaar je een bewerkte versie, dan neemt de geschiedenis die over. Uit te zetten en te wissen in Instellingen.
- Instellingen (tray-menu, ⌘, of de app nog eens openen; verschijnt ook bij de eerste start): sneltoetsen, wat er na het vastleggen gebeurt (editor, kopiëren of direct opslaan; bij die laatste twee verschijnt rechtsonder een voorbeeldje dat na 5 s verdwijnt, klik erop om te bewerken), opslagmap, vragen waar op te slaan, openen bij inloggen, taal en weergave. Opgeslagen als `settings.json` in de config-map van de app (`~/Library/Application Support/nl.jornboerema.vastleggen` op macOS).
- macOS vraagt om toestemming voor Schermopname. Bij `pnpm dev:capture` hoort die toestemming bij de app waarin je het commando draait (Terminal, Zed, …); start die daarna opnieuw.
- Testen zonder sneltoets: `cd apps/capture-desktop/src-tauri && cargo test -- --ignored`.

### Release en downloadpagina

- Nieuwe versie: verhoog `version` in `apps/capture-desktop/src-tauri/tauri.conf.json` (en `package.json`), commit, en push een tag: `git tag capture-v0.2.0 && git push origin capture-v0.2.0`. GitHub Actions (`.github/workflows/capture-release.yml`) bouwt macOS (Apple Silicon en Intel) en Windows en publiceert een GitHub Release.
- Elke release heeft vaste downloadnamen (`Even-vastleggen-mac-apple-silicon.dmg`, `…-mac-intel.dmg`, `…-windows-setup.exe`) onder `releases/latest/download/`, plus `latest.json` voor de updater.
- Updates: de app zoekt 10 s na start en daarna elke 6 uur, downloadt op de achtergrond en installeert pas na "Herstarten om bij te werken" (tray of Instellingen).
- Update-bestanden zijn ondertekend met de sleutel in `~/.tauri/even-vastleggen.key` (GitHub-secret `TAURI_SIGNING_PRIVATE_KEY`). **Bewaar een back-up**: zonder die sleutel kunnen geïnstalleerde apps geen updates meer krijgen. De publieke sleutel staat in `tauri.conf.json`.
- Geen Apple Developer-account: macOS-gebruikers kiezen eenmalig "Open toch" in Privacy en beveiliging, Windows toont SmartScreen.
- Releases voor macOS zijn ondertekend met een eigen (self-signed) certificaat, `Even vastleggen (Jorn Boerema)`: `~/.tauri/even-vastleggen-signing.p12` + `.password`, als secrets `MACOS_SIGNING_P12` (base64) en `MACOS_SIGNING_PASSWORD`, gekozen via `tauri.macos-release.conf.json`. Gatekeeper vertrouwt het niet, maar omdat elke versie hetzelfde certificaat heeft blijft de Schermopname-toestemming na updates staan. **Bewaar ook hiervan een back-up**: een nieuw certificaat betekent één keer opnieuw toestemming geven. Lokale builds zijn ad-hoc ondertekend (`signingIdentity: "-"`).
- Downloadpagina: `jornboerema.nl/download` (in `apps/home`), samen met de Even-desktop-app.

## Auth-architectuur

- De API is de enige Better Auth-server. Web-apps praten er rechtstreeks mee met `credentials: "include"`; CORS staat alleen `TRUSTED_ORIGINS` toe en schrijfverzoeken controleren de `Origin`.
- Alle inlogschermen en het accountportaal zijn pagina's van de web-app `app.jornboerema.nl` (`apps/app-web/src/account`, lokaal `:3007`): `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/connect`, `/desktop` en `/account`. Wie uitgelogd een app opent, gaat naar `/login?returnTo=<adres>`. Na inloggen wordt alleen teruggestuurd naar de web-app zelf en naar de website op hetzelfde domein (`isAllowedReturn` in `@even/auth/client`).
- Lokaal delen alle `localhost`-poorten dezelfde cookie. In productie draaien de API en de web-app op subdomeinen van één domein (`api.` en `app.jornboerema.nl`) met `AUTH_COOKIE_DOMAIN`.
- Het accountportaal (`/account`) beheert naam, e-mail, wachtwoord, ingelogde apparaten en account verwijderen. De instellingen van de apps linken ernaar.
- Desktop (Even): de knop "Inloggen via je browser" opent `app.jornboerema.nl/desktop` met een PKCE-challenge en een poort op `127.0.0.1`. Na bevestigen stuurt die pagina een eenmalige code (2 minuten geldig) naar de app, die hem met de verifier inwisselt via `POST /api/auth/desktop/token` (`packages/auth/src/desktop-sign-in.ts`). De app krijgt een eigen sessie als bearer-token.

## Workspaces (todo)

- Elke lijst hoort bij een workspace (bv. "Persoonlijk", "Werk"). Alle leden zien en beheren alle lijsten van die workspace.
- Rollen: **eigenaar** (alles, ook verwijderen), **beheerder** (leden uitnodigen/beheren, naam wijzigen) en **lid** (lijsten bewerken).
- Uitnodigen gaat per e-mail (7 dagen geldig). Accepteren vereist een bevestigd account op hetzelfde adres.
- Elke gebruiker heeft minstens één workspace; de eerste ("Persoonlijk") wordt automatisch gemaakt.
- Een workspace zonder eigenaar (bv. na het verwijderen van diens account) wordt door een databasetrigger opgeruimd.
- Losse lijsten kunnen nog via een openbare link gedeeld worden met mensen zonder account.

## Database

```bash
pnpm db:migrate       # schema gewijzigd → nieuwe migratie maken (dev-branch)
pnpm db:deploy        # migraties toepassen op de dev-branch
pnpm db:deploy:prod   # migraties toepassen op productie
pnpm db:studio
```

Lokaal werken alle apps op de Neon-branch `dev`, een kopie van `production`. De branch bevat echte accounts en mailtokens: acties op een gekoppelde mailbox vanuit de lokale app raken dus nog steeds die echte mailbox. Terugzetten naar de huidige productiestand kan in de Neon-console met *Reset from parent*.

Tabel- en kolomnamen zijn gelijk aan de oude "Even doen"-app, dus bestaande data kan met `pg_dump --data-only` worden overgezet.

## UI-componenten toevoegen

```bash
cd apps/todo-web && pnpm dlx shadcn@latest add <component>
```

Componenten komen in `packages/ui/src/components` en worden geïmporteerd als `@even/ui/components/<naam>`.

## Deployen op Vercel

Vercel-projecten uit deze repo, op subdomeinen van hetzelfde domein (nodig voor de gedeelde login-cookie), bijvoorbeeld:

| Project | Root Directory | Domein |
| --- | --- | --- |
| `even-api` | `apps/api` | `api.jornboerema.nl` |
| `even-app` | `apps/app-web` | `app.jornboerema.nl`: mail, taken en notities (`/mail`, `/todo`, `/notes`), inloggen en account |
| `even-home` | `apps/home` | `jornboerema.nl` (geen env vars nodig) |

Build- en routing-instellingen staan in `apps/*/vercel.json`. De API wordt met tsup gebundeld en draait als één Vercel Function (`apps/api/api/index.js`); de web-app is een statische Vite-build met een SPA-fallback.

**Environment variables — `even-api`**

| Variabele | Waarde |
| --- | --- |
| `DATABASE_URL` | Neon pooled connection string (productie) |
| `BETTER_AUTH_URL` | `https://api.jornboerema.nl` |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` (productie-geheim) |
| `APP_WEB_URL` | `https://app.jornboerema.nl` |
| `AUTH_COOKIE_DOMAIN` | `.jornboerema.nl` |
| `MAIL_TOKEN_KEY` | Zelfde waarde als elke omgeving op deze database; anders zijn tokens onleesbaar |
| `GOOGLE_MAIL_CLIENT_ID` / `_SECRET` | Google-client; redirect `https://api.jornboerema.nl/api/mail/callback/gmail` |
| `MICROSOFT_MAIL_CLIENT_ID` / `_SECRET` | Entra-app; redirect `https://api.jornboerema.nl/api/mail/callback/outlook` |
| `RESEND_API_KEY`, `EMAIL_FROM` | zoals lokaal |
| `NEON_REALTIME_SECRET`, `NEON_REALTIME_URL` | optioneel; van de productie-branch |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` (gebruikt de pnpm-versie uit `packageManager`) |

**Environment variables — `even-todo` en `even-auth`**

| Variabele | Waarde |
| --- | --- |
| `VITE_API_URL` | `https://api.jornboerema.nl` |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` |

Database-migraties draaien niet tijdens de build. Voer ze uit vóór je deployt: `pnpm db:deploy:prod` (gebruikt `PROD_DATABASE_URL_UNPOOLED`).

Gebruik voor productie een eigen database of Neon-branch. Better Auth versleutelt zijn signeersleutels met `BETTER_AUTH_SECRET`; een database delen met een ander geheim geeft fouten. Preview-deployments op `*.vercel.app` kunnen niet inloggen, omdat de cookie aan het eigen domein gebonden is.

## Controles

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
