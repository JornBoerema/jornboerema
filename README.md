# Evido

Monorepo (Turborepo + pnpm) voor de Evido-apps. Alle apps delen één account (Better Auth), één database (Prisma op Neon), één API (Hono) en één design system (shadcn/ui, preset `b1HXwyUHA`).

## Structuur

```
apps/
  api/          Hono API (Node): /api/auth/*, todo-endpoints, /mcp, OAuth-discovery
  todo-web/     Even doen — Vite + React SPA (react-router, TanStack Query)
packages/
  ui/           shadcn/ui componenten + globals.css (design tokens) — gedeeld door alle React-apps
  db/           Prisma schema, migraties en client
  auth/         Better Auth server-config (`@evido/auth/server`) en React-client (`@evido/auth/client`)
  email/        Resend + e-mailteksten
  todo-core/    Todo-domein: types, zod-validatie, sortering, optimistic updates (API + alle todo-clients)
```

Gepland: todo-desktop (Tauri 2 + React), todo-mobile (Expo), screenshot-desktop, mail, password manager. Desktop-apps hergebruiken de Vite-code en `@evido/ui`; Expo gebruikt `@evido/todo-core` en `@evido/auth`.

## Starten

Vereist Node 22.12+ en pnpm 11.

```bash
pnpm install
cp .env.example .env                       # vul in, zie hieronder
cp apps/todo-web/.env.example apps/todo-web/.env
pnpm db:deploy                             # migraties toepassen
pnpm dev:todo                              # API op :4000, web op :3000
```

### Omgevingsvariabelen (`.env` in de root)

| Variabele | Waarvoor |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** connection string (`-pooler` host, `sslmode=require`) |
| `DATABASE_URL_UNPOOLED` | Neon **directe** connection string, voor migraties |
| `BETTER_AUTH_URL` | Publieke origin van de API, lokaal `http://localhost:4000` |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` |
| `TRUSTED_ORIGINS` | Web-apps die de API met cookies mogen aanroepen (komma-gescheiden) |
| `AUTH_UI_URL` | Web-app met login- en toestemmingsscherm (OAuth/MCP) |
| `TODO_WEB_URL` | Origin van de todo-webapp (links in uitnodigingsmails) |
| `AUTH_COOKIE_DOMAIN` | Alleen productie: bv. `.evido.nl`, zodat sessies over subdomeinen gedeeld worden |
| `RESEND_API_KEY`, `EMAIL_FROM` | Resend; afzender moet bij een geverifieerd domein horen |
| `ABLY_API_KEY` | Optioneel realtime; zonder Ably synchroniseren clients elke 60 s |

`apps/todo-web/.env` bevat alleen `VITE_API_URL` (publiek).

## Auth-architectuur

- De API is de enige Better Auth-server. Web-apps praten er rechtstreeks mee met `credentials: "include"`; CORS staat alleen `TRUSTED_ORIGINS` toe en schrijfverzoeken controleren de `Origin`.
- Lokaal delen `localhost:3000` en `localhost:4000` dezelfde site, dus cookies werken. In productie draaien API en apps op subdomeinen van één domein (bv. `api.evido.nl`, `todo.evido.nl`) met `AUTH_COOKIE_DOMAIN`.
- Tauri en Expo krijgen later Better Auth's bearer/expo-plugin.
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
pnpm db:migrate     # schema gewijzigd → nieuwe migratie maken (dev)
pnpm db:deploy      # migraties toepassen (Neon/productie)
pnpm db:studio
```

Tabel- en kolomnamen zijn gelijk aan de oude "Even doen"-app, dus bestaande data kan met `pg_dump --data-only` worden overgezet.

## UI-componenten toevoegen

```bash
cd apps/todo-web && pnpm dlx shadcn@latest add <component>
```

Componenten komen in `packages/ui/src/components` en worden geïmporteerd als `@evido/ui/components/<naam>`.

## Deployen op Vercel

Twee Vercel-projecten uit deze repo, op subdomeinen van hetzelfde domein (nodig voor de gedeelde login-cookie), bijvoorbeeld:

| Project | Root Directory | Domein |
| --- | --- | --- |
| `evido-api` | `apps/api` | `api.jornboerema.nl` |
| `evido-todo` | `apps/todo-web` | `app.jornboerema.nl` |

Build- en routing-instellingen staan in `apps/*/vercel.json`. De API wordt met tsup gebundeld en draait als één Vercel Function (`apps/api/api/index.js`); de web-app is een statische Vite-build met een SPA-fallback.

**Environment variables — `evido-api`**

| Variabele | Waarde |
| --- | --- |
| `DATABASE_URL` | Neon pooled connection string (productie) |
| `BETTER_AUTH_URL` | `https://api.jornboerema.nl` |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` (productie-geheim) |
| `TRUSTED_ORIGINS` | `https://app.jornboerema.nl` |
| `AUTH_UI_URL` | `https://app.jornboerema.nl` |
| `TODO_WEB_URL` | `https://app.jornboerema.nl` |
| `AUTH_COOKIE_DOMAIN` | `.jornboerema.nl` |
| `RESEND_API_KEY`, `EMAIL_FROM` | zoals lokaal |
| `ABLY_API_KEY` | optioneel |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` (gebruikt de pnpm-versie uit `packageManager`) |

**Environment variables — `evido-todo`**

| Variabele | Waarde |
| --- | --- |
| `VITE_API_URL` | `https://api.jornboerema.nl` |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` |

Database-migraties draaien niet tijdens de build. Voer ze lokaal uit tegen de productiedatabase vóór je deployt: `pnpm db:deploy` (met de directe URL in `DATABASE_URL_UNPOOLED`).

Gebruik voor productie een eigen database of Neon-branch. Better Auth versleutelt zijn signeersleutels met `BETTER_AUTH_SECRET`; een database delen met een ander geheim geeft fouten. Preview-deployments op `*.vercel.app` kunnen niet inloggen, omdat de cookie aan het eigen domein gebonden is.

## Controles

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
