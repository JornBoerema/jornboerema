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

The open conversation is still the first version: HTML in a system webview
(sanitized with ammonia, behind a content policy that runs only our own
script, remote images blocked until asked for, `cid:` images inlined, links
opened in the browser, quoted mail folded away, attachments saved to
Downloads), with a plain-text reply and compose. A SQLite cache next to the
session (deleted on sign-out) shows the last mail at once. The webview is a
system view above everything GPUI draws, so it hides under a spotlight or
dialog and leaves room for toasts.

`EVEN_MAIL_DEBUG` shows states that otherwise need a click, for
`scripts/shot.sh` (comma separated): `collapsed`, `expanded`, `more`,
`editor`, `spotlight`, `shortcuts`, `snooze`, `confirm`, `toast`, `select`,
`open` (a conversation already read, so looking changes nothing), `sender`,
and a list: `drafts`, `parcels`, `invoices`, `snoozed`, `scheduled`,
`senders`, `starred`, `sent`, `archive`, `spam`, `trash`.

## Even doen, so far

Everything the Tauri app's lists do: the workspace switcher, the sidebar with
lists and boards (new, rename with a double-click, drag to reorder, delete,
share by link), the overview, simple lists (add, the checkbox's three steps,
rename, reorder, delete, clear done) and boards (columns and list view,
filters, cards dragged between statuses, a new issue with files, the open
issue with sub-issues, attachments and properties), the spotlight (⌘K), and
its pages in the settings window. Changes show at once and save one by one;
the user's realtime channel reloads the lists when something changed elsewhere.
An issue's description is its markdown in a plain field for now
(`src/todo/description.rs`), until the shared editor takes its place.
`EVEN_TODO_SHOW=board|board-list|issue|new-issue|new-list|spotlight|settings,<page>`
opens a screen for `scripts/shot.sh` without a click.
