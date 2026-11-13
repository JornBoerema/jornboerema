# Even, native

The Even desktop app (`apps/desktop`, Tauri) rebuilt one to one in Rust with
[GPUI](https://gpui.rs) (through `gpui-kit`): the same window, apps, screens,
words and shortcuts, drawn natively instead of in a webview. It sits next to
the Tauri app and replaces nothing: nothing outside this folder changes for it.

```sh
cargo run --release          # from apps/even-native
EVEN_API_URL=http://localhost:4000 EVEN_AUTH_URL=http://localhost:3005 cargo run
```

Needs the Metal toolchain once: `xcodebuild -downloadComponent MetalToolchain`.

## How it is put together

| File | What |
| --- | --- |
| `src/main.rs` | Starts GPUI, loads Inter, opens the window on `Shell`. |
| `src/shell.rs` | `apps/desktop/src`: sign-in screen, app rail, ⌘1–3, the one settings window (account, appearance, about, plus every app's pages). |
| `src/window.rs` | `apps/desktop/src-tauri`: the window's size and place between launches, the window buttons, the top strip that drags it, closing that hides, the menu bar. |
| `src/updates.rs` | Updates as the Tauri app has them, on the native app's own channel (see below). |
| `src/app.rs` | `EvenApp`: what an app gives the shell (its screen, settings pages, `AppEvent`). |
| `src/ui.rs` | `packages/ui`: buttons, floating panel, sidebar rows, settings sections, select, tooltip, toast. |
| `src/theme.rs` | The design tokens of `packages/ui/src/styles/globals.css`, light and dark; `hi("mail-01")` is the web's `Mail01Icon`. |
| `src/i18n.rs` | English and Dutch: `t("Sign out", "Uitloggen")`, words next to the screen that shows them. |
| `src/editor.rs` | `RichEditor`: the web's tiptap editors (notes, descriptions, mail) as one contenteditable page in a system webview; the page is `assets/editor/`. `EVEN_EDITOR_DEMO=markdown\|html` shows it alone, `node scripts/editor-test.mjs` tests its converters. |
| `src/prefs.rs` | What the web keeps in localStorage. |
| `src/api.rs` | The Even API with the session token: `get_json`, `post_json`, `patch_json`, `put_json`, `delete`. Blocking: call on `cx.background_executor()`. |
| `src/mail/` | Even mailen (`apps/mail-web`). |
| `src/todo/` | Even doen (`apps/todo-web`). |
| `src/notes/` | Even noteren (`apps/notes-web`). |
| `src/workspace/` | What Even doen and Even noteren share: the realtime channel, and the web's Dialog, DropdownMenu panel, Alert, Input and brand. |

## The window, the app and updates

The window (`src/window.rs`) opens as the Tauri app's does: 1360 by 860 the
first time, never under 1040 by 600, and after that at the size (in points)
and place it had, maximized or full screen if it was; that is kept in
`window.json` next to the session. The window buttons sit where Tauri puts
them, its top 52 points drag it and a double-click there zooms it, except on a
button or a field. Closing the window (⌘W) hides Even and the Dock icon brings
it back. The menu bar is Tauri's default one in the app's language, with the
settings added.

`scripts/bundle.sh` builds the release binary and puts it in
`target/bundle/Even Native.app`: called Even, with the Tauri app's icon
(`assets/app/Even.icns`, made from `apps/desktop/src-tauri/icons/icon.png`) and
the id `nl.jornboerema.even-native`, so it can be installed beside the Tauri
app and keeps its own session and cache. It is signed ad hoc, enough to run on
this Mac; it is not notarized and nothing publishes it. From the bundle macOS
shows new mail as system notifications (it asks for permission at the first
one); from `cargo run` there is no bundle id and they are quietly left out.

Updates (`src/updates.rs`) work as in the Tauri app: a look ten seconds after
launch and every hour, the download in the background, then "Restart to
update" on the rail and in About, where "Check for updates" looks at once. The
native app has its own channel, apart from the Tauri app's `even-updates`:
`latest.json` (Tauri's shape) on the `even-native-updates` release, or wherever
`EVEN_UPDATE_URL` points. Nothing is published there and `PUBLIC_KEY` in
`src/updates.rs` is empty, so every check says "Up to date" until a minisign
key is set and a release exists; a development build and `cargo run` never
update. `EVEN_UPDATE_DEBUG=ready` pretends version 9.9.9 is ready (its button
does nothing) and `EVEN_SHELL_DEBUG=tip` or `update-tip` shows a rail tooltip,
both for `scripts/shot.sh`; `EVEN_SETTINGS=about` opens the About page.

## Rules for porting a screen

- The web app is the specification. Read the component and its CSS, then build
  the same thing: the same sizes, spacing, radii, colours (by token, through
  `theme::…`), icons (`theme::hi`), words in both languages, shortcuts and
  behaviour. Where the web file is, say so in the Rust file's comment.
- Icons: `node scripts/icons.mjs SomeNewIcon` adds a Hugeicon to `assets/hi`
  (every icon the web sources name is already there).
- Fields, menus, dialogs, switches, checkboxes: `gpui_kit::component` (it has
  Even's colours). A select is `ui::select`, never a system dropdown.
- The API is blocking (`ureq`): run calls on the background executor and come
  back with `cx.spawn`. On `api::Unauthorized`, `cx.emit(AppEvent::SignedOut)`.
  Change the screen first and the server after it (optimistic), as the web does.
- An app's API types and calls live in its own module (`src/todo/api.rs`),
  built on `Client::get_json` and friends.
- Nothing outside `apps/even-native` changes: the API, the web apps and the
  Tauri app stay as they are.
- Look at the result with `scripts/shot.sh out.png 6 todo` (after `cargo
  build`): it runs the app behind the other windows and saves a picture of its
  window. Never click or type on the screen to test: the user works on this Mac.
- `cargo check` must pass and `cargo test` stay green.

## Even mailen, so far

The frame, the sidebar and every list of `apps/mail-web` (`pages/inbox.tsx`):
the places in the order the account arranged them (arranged in place, synced
through `/api/mail/preferences`), the collapsed strip (⌘B), mailboxes, unread
counts; conversations with selection, quick actions on hover, pins, what is
back from snooze, moves with Undo, snoozing with the when-picker, the mailbox
filter, emptying the trash; drafts, parcels, invoices, snoozed, scheduled and
Tidy up with its sender pane; the ⌘K spotlight, the shortcuts on ?, the empty
pane, toasts and new-mail notifications. English and Dutch, light and dark.

The open conversation (`pages/conversation.tsx`; `src/mail/reader.rs` and
`reader/`): GPUI draws the toolbar (star, spam, the moves, snooze, unread,
pin, make a task) and the dialogs (a task in Even doen, leaving a mailing
list, "not recognised well"); everything that scrolls under the toolbar is
one page in a system webview (`reader/page.rs`, `assets/reader/`), written
with the web's own tokens and sizes: the subject, the cards above the mail
(parcel, invoice with Moneybird, tasks made from it, sign-in code or
summary), each message newest first with long threads folded, the images
notice, translation, unsubscribe, quoted mail tucked away, attachment chips
(saved to Downloads), suggested replies and the bar to answer with. Mail is
sanitized with ammonia and sits in its own contained shadow root, behind a
content policy that runs only our own script; remote images wait until asked
for, `cid:` images are inlined, links open in the browser. The page tells
the app what was clicked (`email::parse_message`) and the app fills the
page's slots as answers arrive (`reader/extras.rs`). A SQLite cache next to
the session (deleted on sign-out) shows the last mail at once. The webview
is a system view above everything GPUI draws: tooltips (also the toolbar's)
and the Moneybird menu are drawn in the page itself, and it hides under a
spotlight or dialog and leaves room for toasts.

`EVEN_MAIL_DEBUG` shows states that otherwise need a click, for
`scripts/shot.sh` (comma separated): `collapsed`, `expanded`, `more`,
`editor`, `spotlight`, `shortcuts`, `snooze`, `confirm`, `toast`, `select`,
`open` (a conversation already read, so looking changes nothing; with any
debug state set, opening a conversation never marks it read), `sender`,
and a list: `drafts`, `parcels`, `invoices`, `snoozed`, `scheduled`,
`senders`, `starred`, `sent`, `archive`, `spam`, `trash`. For the reader:
`long` (opens the read conversation with the most messages), `files` (the
first read one with an attachment), `cards` (every card and the suggested
replies with made-up content), `todo`, `unsubscribe` (its question, with a
made-up list), `tip` (a toolbar tooltip), `pending` (while it is fetched).
With any debug state the models are left alone (no summary, no suggested
replies) unless `ai` is added. `EVEN_LANG=en|nl` shows the app in a language
for a look, without keeping it as the choice.

New mail arrives over the user's realtime channel (`mail:<userId>`, the
listener of `src/workspace/realtime.rs`), with a round every minute for when
that line is down. What the app sends is built apart from sending it
(`mail/api.rs`, `mail/compose/wire.rs`) and held in the tests against the
API's schemas, written out in `src/mail/schema.rs`. Quitting sends what was
still waiting (a move, a message in its undo moment, a draft) before the app
is gone.

Writing mail (`src/mail/compose.rs` and `src/mail/compose/`): the new
message and an opened draft in the reading pane, reply, reply all and forward
under a conversation, with the mailbox to send from, recipients as badges with
suggested contacts, the rich body (the shared editor in mail mode, with the
web's format menu on the selection), signatures, attachments uploaded in
chunks, inline pictures, drafts saved while writing, replies kept on this Mac
per conversation, undo send, Send later, scheduled mail opened as a draft
again, and writing with AI as the words arrive. Its debug states are
prefilled and save, upload, ask and send nothing: `compose`, `compose-empty`,
`copies`, `suggest`, `attachments`, `ai-line`, `ai-writing`, `saved`, `from`,
`signature`, `send-later`, `when-send`, `draft-opening`, `draft-failed`, and
under a conversation `reply`, `reply-all`, `forward`, `reply-ai`.

Its pages in the settings window (`src/mail/settings_pages.rs`,
`settings_signatures.rs`): mailboxes, signatures (written in the shared
editor), notifications, AI, sidebar, features and privacy, and its part of the
shared connections page. `EVEN_SETTINGS=connections` or
`EVEN_SETTINGS=mail:signatures` opens the settings at a page (`<page>` for a
shared one, `<app>:<page>` for an app's own); with it, `EVEN_MAIL_DEBUG` also
takes `settings-colors`, `settings-disconnect`, `settings-signature`,
`settings-delete-signature` and `settings-moneybird`.

## Even doen, so far

Everything the Tauri app's lists do: the workspace switcher, the sidebar with
lists and boards (new, rename with a double-click, drag to reorder, delete,
share by link), the overview, simple lists (add, the checkbox's three steps,
rename, reorder, delete, clear done) and boards (columns and list view,
filters, cards dragged between statuses, a new issue with files, the open
issue with sub-issues, attachments and properties), the spotlight (⌘K), and
its pages in the settings window. Changes show at once and save one by one;
the user's realtime channel reloads the lists when something changed elsewhere.
An issue's description is the shared rich text editor
(`src/todo/description.rs`), as tall as its text; a note's text is one too
(`src/notes/body.rs`), scrolling under its title, with the blocks "/" offers.
Both are system webviews: they go off the screen while a menu, a dialog or
the settings lie over them.
`EVEN_TODO_SHOW=board|board-list|issue|new-issue|new-list|spotlight|settings,<page>`
opens a screen for `scripts/shot.sh` without a click (`issue-delete`: with the
delete question; `EVEN_TODO_MENU=status|issue-options|workspace|list|filter`
opens a menu, `EVEN_TODO_SCROLL=<points>` scrolls the open issue).
`EVEN_NOTES_SHOW=note|options|workspaces|spotlight|new|delete|share|rename|conflict|offline`
(comma separated) does the same for Even noteren (`delete-tab`: the delete
question after a Tab).
`EVEN_TODO_SHOW=sample,<screen>` shows a made-up workspace instead of the
user's own (`src/todo/sample.rs`: a simple list, a board, projects, members
with and without a picture, files on an issue, a long description), in memory
only: nothing is read from or sent to the API. Its screens: `list`,
`edit-task`, `rename`, `delete-list`, `delete-task`, `clear-done`, `share`
(`share-new`: no link yet), `board`, `board-list`, `issue`, `issue-delete`,
`viewer` (a picture full screen), `drop` (the "drop files" cover),
`new-issue`, and `settings,<page>[,project|new-project|delete-project|delete-status|gone]`;
`EVEN_TODO_MENU` also takes `status-color`, `status-options`, `project-color`,
`editing-color` and `invite-role` for the settings pages, and
`EVEN_TODO_SCROLL` scrolls the list, the overview or the board's list view
when no issue is open. `EVEN_LANG=en|nl` and `EVEN_THEME=light|dark` pick the
language and the theme for the run. `EVEN_LOG_WRITES=1` names
every change either app sends on stderr, `EVEN_LOG_WRITES=block` refuses them:
opening a note or an issue must send none.
