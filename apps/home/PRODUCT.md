# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Dutch entrepreneurs, freelancers and small agencies who run their work mail on Outlook / Microsoft 365 and process a lot of it every day. They arrive from a LinkedIn post or a referral and want to know in seconds what this is, what it costs, and whether it is a serious, trustworthy party to hand their mailbox to.

## Product Purpose

Even is a family of small apps for everyday work, made in the Netherlands. The paid product is Even mailen: a fast mail app on top of the mailbox you already have. The website (jornboerema.nl) exists to turn a visitor into someone who starts the 14-day trial. First goal: 100 users.

## Positioning

- Outlook first. Most fast mail apps are built for Gmail; Dutch small business sits on Microsoft 365.
- Dutch: interface, support and invoice with VAT, from a Dutch sole proprietorship.
- European and private: the app runs in Frankfurt, the mailbox stays with Microsoft or Google, and no AI model is trained on your mail.
- One subscription, Even Pro, covers mail and later agenda and chat. Even doen (tasks) and Even noteren (notes) are free.
- "Even" is Dutch for "just a moment", which is how long each thing should take.

## Operating Context

The visitor is at a desk, mid-workday, usually with Outlook open in another tab. The app itself is keyboard-driven and runs in the browser, as a desktop app (macOS and Windows) and on iPhone/iPad.

## Capabilities and Constraints

Even mailen, real today: connects Outlook and Gmail mailboxes (several at once); keyboard shortcuts for everything; command search; AI summary of a conversation; reply suggestions; AI help with writing; translation; snooze; send later; unsubscribe button; turn a mail into a task; parcel tracking from mail; invoices from mail, optionally on to Moneybird; signatures.

- Outlook is open to everyone. Gmail is invite-only until Google's verification is done.
- Even Pro: 25 euro per month or 240 euro per year, VAT included. 14 days free trial.
- Even doen and Even noteren: free. Even plannen (agenda) and Even chatten: not built yet, "soon".
- Site is plain HTML and CSS in a Vite multi-page app (`apps/home`), with /privacy, /terms, /download and /admin beside it. Dutch and English; language follows the browser, with a switch.
- Domain stays jornboerema.nl for now; the site is for "Even", not for the person.
- The apps, sign-up, sign-in and the account all live on app.jornboerema.nl (mail at /mail).

## Brand Commitments

- Name: Even. Apps are "Even mailen", "Even doen", "Even noteren", "Even plannen", "Even chatten".
- The orange accent (#f07a2b) and the Even icon (orange rounded square with a pale dot, `public/icon.svg`) stay. Everything else of the old look may be replaced.
- Voice: plain, calm, a little dry. Not a standard SaaS template, not loud or hype, not corporate and stiff.

## Evidence on Hand

- The real app and its design tokens (`packages/ui/src/styles/globals.css`, `apps/mail-web/src/mail.css`).
- No customers, testimonials, press, benchmarks or user counts yet. Do not invent any.
- No screenshots or video yet. Any inbox shown on the site is an authored demonstration with made-up mail.
- Legal: sole proprietorship Jorn Boerema, Snellingerdijk 30, 8431 EN Oosterwolde, KvK 42064465, VAT NL005468091B10, support@jornboerema.nl.

## Product Principles

1. Mail sells; the rest comes along.
2. Show the app doing its job rather than describing it.
3. Say what it costs and who is behind it, plainly.
4. Promise nothing that is not built.
