# Evido

Monorepo (Turborepo + pnpm) voor de Evido-apps. Alle apps delen één account (Better Auth), één database (Prisma op Neon), één API (Hono) en één design system (shadcn/ui, preset `b1HXwyUHA`).

## Structuur

```
apps/
  api/          Hono API (Node): /api/auth/*, todo-endpoints, /mcp, OAuth-discovery
  auth-web/     auth.jornboerema.nl — inloggen, registreren, wachtwoord herstellen, OAuth-toestemming en het accountportaal
  todo-web/     Even doen — Vite + React SPA (react-router, TanStack Query)
  home/         jornboerema.nl — minimale statische pagina met links naar de apps
  mail-web/     Even mailen — Vite + React SPA: Gmail- en Outlook-mailboxen koppelen
  capture-desktop/  Even vastleggen — screenshot-app (Tauri 2 + React) voor macOS en Windows
packages/
  ui/           shadcn/ui componenten + globals.css (design tokens) — gedeeld door alle React-apps
  db/           Prisma schema, migraties en client
  auth/         Better Auth server-config (`@evido/auth/server`) en React-client (`@evido/auth/client`)
  email/        Resend + e-mailteksten
  todo-core/    Todo-domein: types, zod-validatie, sortering, optimistic updates (API + alle todo-clients)
  mail-core/    Mail-domein: Gmail en Outlook achter één provider-interface, token-versleuteling
```

Gepland: todo-desktop (Tauri 2 + React), todo-mobile (Expo), screenshot-desktop, password manager. Desktop-apps hergebruiken de Vite-code en `@evido/ui`; Expo gebruikt `@evido/todo-core` en `@evido/auth`.

## Starten

Vereist Node 22.12+ en pnpm 11.

```bash
pnpm install
cp .env.example .env                       # vul in, zie hieronder
cp apps/todo-web/.env.example apps/todo-web/.env
cp apps/auth-web/.env.example apps/auth-web/.env
pnpm db:deploy                             # migraties toepassen
pnpm dev:todo                              # API op :4000, accountsite op :3005, web op :3000
```

### Omgevingsvariabelen (`.env` in de root)

| Variabele | Waarvoor |
| --- | --- |
| `DATABASE_URL` | Neon-branch `dev`, **pooled** (`-pooler` host, `sslmode=require`) |
| `DATABASE_URL_UNPOOLED` | Neon-branch `dev`, **direct**, voor migraties |
| `PROD_DATABASE_URL_UNPOOLED` | Neon-branch `production`, direct. Alleen voor `pnpm db:deploy:prod` |
| `BETTER_AUTH_URL` | Publieke origin van de API, lokaal `http://localhost:4000` |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` |
| `TRUSTED_ORIGINS` | Web-apps die de API met cookies mogen aanroepen (komma-gescheiden) |
| `AUTH_UI_URL` | De accountsite (`apps/auth-web`): login, OAuth/MCP-toestemming en accountportaal; wordt automatisch vertrouwd |
| `TODO_WEB_URL` | Origin van de todo-webapp (links in uitnodigingsmails) |
| `MAIL_WEB_URL` | Origin van de mail-webapp (OAuth-callback keert hier terug); ook toevoegen aan `TRUSTED_ORIGINS` |
| `MAIL_TOKEN_KEY` | Versleutelt mailbox-tokens (`openssl rand -hex 32`). Kwijt = alle mailboxen opnieuw koppelen |
| `GOOGLE_MAIL_CLIENT_ID`, `GOOGLE_MAIL_CLIENT_SECRET` | Google OAuth-client, redirect `<API>/api/mail/callback/gmail` |
| `MICROSOFT_MAIL_CLIENT_ID`, `MICROSOFT_MAIL_CLIENT_SECRET` | Entra-app (elke organisatie + persoonlijk), redirect `<API>/api/mail/callback/outlook` |
| `AUTH_COOKIE_DOMAIN` | Alleen productie: bv. `.evido.nl`, zodat sessies over subdomeinen gedeeld worden |
| `RESEND_API_KEY`, `EMAIL_FROM` | Resend; afzender moet bij een geverifieerd domein horen |
| `ABLY_API_KEY` | Optioneel realtime; zonder Ably synchroniseren clients elke 60 s |

`apps/todo-web/.env` bevat alleen `VITE_API_URL` (publiek).

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
- Downloadpagina: `apps/capture-web` (statisch, EN/NL) op `capture.jornboerema.nl`. Vercel-project met Root Directory `apps/capture-web`.

## Auth-architectuur

- De API is de enige Better Auth-server. Web-apps praten er rechtstreeks mee met `credentials: "include"`; CORS staat alleen `TRUSTED_ORIGINS` toe en schrijfverzoeken controleren de `Origin`.
- Alle inlogschermen staan op de accountsite `auth.jornboerema.nl` (`apps/auth-web`, lokaal `:3005`). De apps hebben geen eigen loginformulier: hun `/login`, `/signup`, `/forgot-password` en `/reset-password` sturen door met `?returnTo=<app-URL>`. De accountsite stuurt alleen terug naar zichzelf en naar apps op hetzelfde domein (`isAllowedReturn` in `@evido/auth/client`).
- Lokaal delen alle `localhost`-poorten dezelfde cookie. In productie draaien API en apps op subdomeinen van één domein (`api.`, `auth.`, `todo.`, `mail.jornboerema.nl`) met `AUTH_COOKIE_DOMAIN`.
- Het accountportaal (`/` op de accountsite) beheert naam, e-mail, wachtwoord, ingelogde apparaten en account verwijderen. De instellingen van de apps linken ernaar.
- Desktop (Even): de knop "Inloggen via je browser" opent `auth.jornboerema.nl/desktop` met een PKCE-challenge en een poort op `127.0.0.1`. Na bevestigen stuurt de accountsite een eenmalige code (2 minuten geldig) naar de app, die hem met de verifier inwisselt via `POST /api/auth/desktop/token` (`packages/auth/src/desktop-sign-in.ts`). De app krijgt een eigen sessie als bearer-token.
- MCP: `${BETTER_AUTH_URL}/mcp`, OAuth met PKCE via de Better Auth MCP-plugin. Login en toestemming lopen via `AUTH_UI_URL`.

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

Componenten komen in `packages/ui/src/components` en worden geïmporteerd als `@evido/ui/components/<naam>`.

## Deployen op Vercel

Vercel-projecten uit deze repo, op subdomeinen van hetzelfde domein (nodig voor de gedeelde login-cookie), bijvoorbeeld:

| Project | Root Directory | Domein |
| --- | --- | --- |
| `evido-api` | `apps/api` | `api.jornboerema.nl` |
| `evido-auth` | `apps/auth-web` | `auth.jornboerema.nl` |
| `evido-todo` | `apps/todo-web` | `todo.jornboerema.nl` |
| `even-mailen` | `apps/mail-web` | `mail.jornboerema.nl` |
| `evido-home` | `apps/home` | `jornboerema.nl` (geen env vars nodig) |

Build- en routing-instellingen staan in `apps/*/vercel.json`. De API wordt met tsup gebundeld en draait als één Vercel Function (`apps/api/api/index.js`); de web-app is een statische Vite-build met een SPA-fallback.

**Environment variables — `evido-api`**

| Variabele | Waarde |
| --- | --- |
| `DATABASE_URL` | Neon pooled connection string (productie) |
| `BETTER_AUTH_URL` | `https://api.jornboerema.nl` |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` (productie-geheim) |
| `TRUSTED_ORIGINS` | `https://todo.jornboerema.nl` |
| `AUTH_UI_URL` | `https://auth.jornboerema.nl` |
| `TODO_WEB_URL` | `https://todo.jornboerema.nl` |
| `AUTH_COOKIE_DOMAIN` | `.jornboerema.nl` |
| `MAIL_WEB_URL` | `https://mail.jornboerema.nl` |
| `MAIL_TOKEN_KEY` | Zelfde waarde als elke omgeving op deze database; anders zijn tokens onleesbaar |
| `GOOGLE_MAIL_CLIENT_ID` / `_SECRET` | Google-client; redirect `https://api.jornboerema.nl/api/mail/callback/gmail` |
| `MICROSOFT_MAIL_CLIENT_ID` / `_SECRET` | Entra-app; redirect `https://api.jornboerema.nl/api/mail/callback/outlook` |
| `RESEND_API_KEY`, `EMAIL_FROM` | zoals lokaal |
| `ABLY_API_KEY` | optioneel |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` (gebruikt de pnpm-versie uit `packageManager`) |

**Environment variables — `evido-todo` en `evido-auth`**

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
