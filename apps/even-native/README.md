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
Esc close.

Not yet: writing and replying, search, the other sidebar views (parcels,
invoices, senders).
