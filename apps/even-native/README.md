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

Sign-in through the browser (the same PKCE flow as the Tauri app), the folders,
a virtualized conversation list that pages in as you scroll, and the open
conversation as HTML in a system webview: sanitized with ammonia, behind a
content policy that runs only our own script, remote images blocked until asked
for, `cid:` images inlined, links opened in the browser, the quote of earlier
mail under a reply folded away, attachments saved to Downloads with a click.
A SQLite cache next to the session (deleted on sign-out) shows the last mail at
once. Search (/ or ⌘F) through every mailbox. Plain-text reply and compose.
