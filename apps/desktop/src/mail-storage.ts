import { invoke } from "@tauri-apps/api/core"
import { setMailStorage, type MailStorage } from "@evido/mail-web/embed"

/**
 * Even mailen's cache in the app's own database (src-tauri/src/mail_cache.rs)
 * instead of the webview's localStorage: no size ceiling, nothing written on the
 * thread that draws, and room for the conversations that were opened.
 */
const storage: MailStorage = {
  getItem: (key) => invoke<string | null>("mail_cache_get", { key }),
  setItem: (key, value) => invoke("mail_cache_set", { key, value }),
  removeItem: (key) => invoke("mail_cache_remove", { key }),
  getThread: (userId, id) => invoke<string | null>("mail_cache_thread", { user: userId, id }),
  putThread: (userId, id, value) => invoke("mail_cache_put_thread", { user: userId, id, value }),
  clear: () => invoke("mail_cache_clear"),
}

export function keepMailOnDisk() {
  setMailStorage(storage)
}

/** Signed out: the mail of whoever used Even last leaves this computer. */
export const forgetMailOnDisk = () => invoke("mail_cache_clear").catch(() => {})
