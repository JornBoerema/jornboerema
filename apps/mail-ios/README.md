# Even mailen for iPhone and iPad

Even mailen (`apps/mail-web`) as a native SwiftUI app. Mail only: unlike the
desktop app, the phone gets one app per Even app. It talks to the same API and
changes nothing outside this folder.

Open `EvenMail.xcodeproj` in Xcode (iOS 18 or later), pick your team under
Signing & Capabilities, and run. The bundle id is `nl.jornboerema.even.mail`.

## How it is put together

| File | What |
| --- | --- |
| `EvenMail/Core/Theme.swift` | The design tokens of `packages/ui/src/styles/globals.css` (light and dark), Inter, Hugeicons as `Icon("archive")`. |
| `EvenMail/Core/Prefs.swift` | Language and theme of this device; `t("Sign out", "Uitloggen")` keeps both languages next to the screen. |
| `EvenMail/Core/API.swift` | The Even API with the session token. |
| `EvenMail/Core/Auth.swift` | Sign-in through the account site in the browser (the desktop app's loopback + PKCE flow); the token lives in the keychain. |
| `EvenMail/Core/Push.swift` | Notifications for new mail: permission, this install's address for the API, and opening the conversation a tapped one is about. The API sends them (`apps/api/src/mail/push-server.ts`) once `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID` and `APNS_BUNDLE_ID` are set. |
| `EvenMail/Core/Store.swift` | Mailboxes, lists, actions with undo, sync. The screen changes first, the server after it, as on the web. |
| `EvenMail/Views/MailShell.swift` | Sidebar, list and reader: three columns on iPad, a stack on iPhone. |
| `EvenMail/Views/ThreadListView.swift` | A place's conversations: search, pull to refresh, swipe actions, pins. |
| `EvenMail/Views/ConversationView.swift` | Reading, summary or sign-in code, translation, suggested replies, attachments, reply bar. |
| `EvenMail/Views/EmailWebView.swift` | Untrusted mail HTML: scripts off, a strict content policy, nothing kept, links open in the browser. |
| `EvenMail/Views/ComposeView.swift` | New message, reply, forward, drafts, writing with AI, attachments, sending later. |
| `EvenMail/Views/ConversationExtras.swift` | Above a conversation: its parcel or invoice (pay, to Moneybird) and its tasks; the sheet that makes a task for Even doen. |
| `EvenMail/Views/PlaceViews.swift` | Parcels, invoices, scheduled mail and tidying up per sender. |
| `EvenMail/Views/Sheets.swift` | Picking a moment (snooze, send later) and settings. |

The web app is the specification: a screen says in its comment which web file
it follows. Words go in both languages. Icons and fonts come from
`apps/even-native/assets`; `scripts/assets.sh` rebuilds the asset catalog
(needs `rsvg-convert`).

## Trying it without an account

`scripts/shot.sh out.png [device-udid] [nl|en] [light|dark]` builds the app,
runs it in a simulator with made-up mail (`EVEN_DEMO=1`, nothing is asked of
the API) and saves a screenshot. `EVEN_SHOW=conversation|compose|reply|ai|attach|todo|snooze|settings|toast|places|parcels|invoices|senders`
opens a screen of the demo.

Other switches (scheme environment, or `SIMCTL_CHILD_…`): `EVEN_API_URL` and
`EVEN_AUTH_URL` for a local API, `EVEN_LANG`, `EVEN_THEME`, and
`EVEN_BLOCK_WRITES=1`, which answers everything but reading locally so a test
run can't change a real account.

## Not there yet

Live updates (the app looks again every 45 seconds while open instead), rich
text, selecting several conversations, emptying the trash, reporting a wrong
parcel or invoice, editing the sidebar and connecting a mailbox or Moneybird
(done on the web).
