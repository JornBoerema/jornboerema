# Even, native

An experiment: the mail part of Even, drawn natively in Rust with
[GPUI](https://gpui.rs) (through `gpui-kit`) instead of a webview. It sits next
to `apps/desktop` (the Tauri app) and replaces nothing.

```sh
cargo run --release          # from apps/even-native
EVEN_API_URL=http://localhost:4000 EVEN_AUTH_URL=http://localhost:3005 cargo run
```

Needs the Metal toolchain once: `xcodebuild -downloadComponent MetalToolchain`.

What it does: sign in through the browser (the same PKCE flow as the Tauri app),
the folders, a virtualized conversation list that pages in as you scroll, and the
open conversation as HTML in a system webview: sanitized with ammonia, behind a
content policy that runs only our own script, remote images blocked until asked
for, `cid:` images inlined, links opened in the browser, the quote of earlier
mail under a reply folded away, attachments saved to Downloads with a click.
Keys: J/K or arrows, E archive, S star, Shift+U unread, # trash, Cmd+R refresh,
Esc close. It opens with the mail it saw last (a SQLite cache next to the
session, deleted on sign-out) and fetches fresh in the background.

Search: / or Cmd+F, type, Enter. The synced matches show at once, the mailboxes'
own search (through the text too) joins them; hits outside the synced inbox open
through the account's conversation endpoint, as in the web app. Esc goes back to
the folder.

Not yet: writing and replying, the other sidebar views (parcels, invoices, senders).
