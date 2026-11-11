import { useEffect, useSyncExternalStore } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { normalizeSidebar, type SidebarLayout } from "@evido/mail-core/sidebar"
import { api, errorText } from "@/lib/api"

const REMOTE_IMAGES_KEY = "evido.mail.remote-images"
const listeners = new Set<() => void>()

function readRemoteImages() {
  try {
    return localStorage.getItem(REMOTE_IMAGES_KEY) === "always"
  } catch {
    return false
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener("storage", listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

export function setAlwaysShowImages(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(REMOTE_IMAGES_KEY, "always")
    else localStorage.removeItem(REMOTE_IMAGES_KEY)
  } catch {
    // Storage can be blocked; the safe default of hiding images then stays.
  }
  listeners.forEach((listener) => listener())
  pushPreference({ remoteImages: enabled })
}

/** Off unless chosen, because loading a remote image tells the sender you opened the mail. */
export function useAlwaysShowImages() {
  return useSyncExternalStore(subscribe, readRemoteImages)
}

const NOTIFY_KEY = "evido.mail.notifications"

function readNotify() {
  try {
    return localStorage.getItem(NOTIFY_KEY) === "on"
  } catch {
    return false
  }
}

export function setNotifyNewMail(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(NOTIFY_KEY, "on")
    else localStorage.removeItem(NOTIFY_KEY)
  } catch {
    // Without storage the setting can't be kept; notifications then stay off.
  }
  listeners.forEach((listener) => listener())
}

/** Per device, since each browser grants its own permission. */
export function useNotifyNewMail() {
  return useSyncExternalStore(subscribe, readNotify)
}

const SUMMARIES_KEY = "evido.mail.summaries"

function readSummaries() {
  try {
    return localStorage.getItem(SUMMARIES_KEY) !== "off"
  } catch {
    return true
  }
}

export function setSummaries(enabled: boolean) {
  try {
    if (enabled) localStorage.removeItem(SUMMARIES_KEY)
    else localStorage.setItem(SUMMARIES_KEY, "off")
  } catch {
    // Storage can be blocked; summaries then stay on.
  }
  listeners.forEach((listener) => listener())
  pushPreference({ summaries: enabled })
}

/** On unless turned off: the conversation is sent to a language model to sum it up. */
export function useSummaries() {
  return useSyncExternalStore(subscribe, readSummaries)
}

const CODES_KEY = "evido.mail.codes"

function readCodes() {
  try {
    return localStorage.getItem(CODES_KEY) !== "off"
  } catch {
    return true
  }
}

export function setFindCodes(enabled: boolean) {
  try {
    if (enabled) localStorage.removeItem(CODES_KEY)
    else localStorage.setItem(CODES_KEY, "off")
  } catch {
    // Storage can be blocked; codes then keep showing.
  }
  listeners.forEach((listener) => listener())
  pushPreference({ codes: enabled })
}

/** On unless turned off: sign-in codes shown ready to copy. */
export function useFindCodes() {
  return useSyncExternalStore(subscribe, readCodes)
}

const WRITING_KEY = "evido.mail.ai-writing"

function readWriting() {
  try {
    return localStorage.getItem(WRITING_KEY) !== "off"
  } catch {
    return true
  }
}

export function setAiWriting(enabled: boolean) {
  try {
    if (enabled) localStorage.removeItem(WRITING_KEY)
    else localStorage.setItem(WRITING_KEY, "off")
  } catch {
    // Storage can be blocked; the button then stays.
  }
  listeners.forEach((listener) => listener())
  pushPreference({ aiWriting: enabled })
}

/** On unless turned off: a button that has a language model write the message. */
export function useAiWriting() {
  return useSyncExternalStore(subscribe, readWriting)
}

const PARCELS_KEY = "evido.mail.parcels"

function readParcels() {
  try {
    return localStorage.getItem(PARCELS_KEY) !== "off"
  } catch {
    return true
  }
}

export function setParcels(enabled: boolean) {
  try {
    if (enabled) localStorage.removeItem(PARCELS_KEY)
    else localStorage.setItem(PARCELS_KEY, "off")
  } catch {
    // Storage can be blocked; the account still keeps the choice.
  }
  listeners.forEach((listener) => listener())
  pushPreference({ parcels: enabled })
}

/** On unless turned off: parcels from shipping mail, in their own list and above the mail. */
export function useParcels() {
  return useSyncExternalStore(subscribe, readParcels)
}

const UNSUBSCRIBE_KEY = "evido.mail.unsubscribe"

function readUnsubscribe() {
  try {
    return localStorage.getItem(UNSUBSCRIBE_KEY) !== "off"
  } catch {
    return true
  }
}

export function setUnsubscribe(enabled: boolean) {
  try {
    if (enabled) localStorage.removeItem(UNSUBSCRIBE_KEY)
    else localStorage.setItem(UNSUBSCRIBE_KEY, "off")
  } catch {
    // Storage can be blocked; the account still keeps the choice.
  }
  listeners.forEach((listener) => listener())
  pushPreference({ unsubscribe: enabled })
}

/** On unless turned off: an Unsubscribe button beside mail from a mailing list. */
export function useUnsubscribe() {
  return useSyncExternalStore(subscribe, readUnsubscribe)
}

const SENDERS_KEY = "evido.mail.senders"

function readSenders() {
  try {
    return localStorage.getItem(SENDERS_KEY) !== "off"
  } catch {
    return true
  }
}

export function setSenders(enabled: boolean) {
  try {
    if (enabled) localStorage.removeItem(SENDERS_KEY)
    else localStorage.setItem(SENDERS_KEY, "off")
  } catch {
    // Storage can be blocked; the account still keeps the choice.
  }
  listeners.forEach((listener) => listener())
  pushPreference({ senders: enabled })
}

/** On unless turned off: Tidy up, the inbox per sender. */
export function useSenders() {
  return useSyncExternalStore(subscribe, readSenders)
}

const INVOICES_KEY = "evido.mail.invoices"

function readInvoices() {
  try {
    return localStorage.getItem(INVOICES_KEY) !== "off"
  } catch {
    return true
  }
}

export function setInvoices(enabled: boolean) {
  try {
    if (enabled) localStorage.removeItem(INVOICES_KEY)
    else localStorage.setItem(INVOICES_KEY, "off")
  } catch {
    // Storage can be blocked; the account still keeps the choice.
  }
  listeners.forEach((listener) => listener())
  pushPreference({ invoices: enabled })
}

/** On unless turned off: invoices and payments from mail, in their own list and above the mail. */
export function useInvoices() {
  return useSyncExternalStore(subscribe, readInvoices)
}

const TODOS_KEY = "evido.mail.todos"

function readTodos() {
  try {
    return localStorage.getItem(TODOS_KEY) !== "off"
  } catch {
    return true
  }
}

export function setTodos(enabled: boolean) {
  try {
    if (enabled) localStorage.removeItem(TODOS_KEY)
    else localStorage.setItem(TODOS_KEY, "off")
  } catch {
    // Storage can be blocked; the account still keeps the choice.
  }
  listeners.forEach((listener) => listener())
  pushPreference({ todos: enabled })
}

/** On unless turned off: make a task in Even doen from a mail. */
export function useTodos() {
  return useSyncExternalStore(subscribe, readTodos)
}

const PINS_KEY = "evido.mail.pins"

function readPins() {
  try {
    return localStorage.getItem(PINS_KEY) !== "off"
  } catch {
    return true
  }
}

export function setPins(enabled: boolean) {
  try {
    if (enabled) localStorage.removeItem(PINS_KEY)
    else localStorage.setItem(PINS_KEY, "off")
  } catch {
    // Storage can be blocked; the account still keeps the choice.
  }
  listeners.forEach((listener) => listener())
  pushPreference({ pins: enabled })
}

/** On unless turned off: pinning conversations to the top of the inbox. */
export function usePins() {
  return useSyncExternalStore(subscribe, readPins)
}

const SIDEBAR_KEY = "evido.mail.sidebar"
// One parsed layout per stored text, so the store hands out the same object until it changes.
let sidebarCache: { raw: string | null; layout: SidebarLayout } | null = null

function readSidebar(): SidebarLayout {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(SIDEBAR_KEY)
  } catch {
    // Blocked storage: the default.
  }
  if (sidebarCache?.raw === raw) return sidebarCache.layout
  let parsed: unknown = null
  try {
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    // Unreadable: the default.
  }
  sidebarCache = { raw, layout: normalizeSidebar(parsed) }
  return sidebarCache.layout
}

/** Arranges the sidebar, or with null puts the default back; follows the account to other devices. */
export function setSidebar(layout: SidebarLayout | null) {
  try {
    if (layout) localStorage.setItem(SIDEBAR_KEY, JSON.stringify(layout))
    else localStorage.removeItem(SIDEBAR_KEY)
  } catch {
    // Storage can be blocked; the account still keeps it.
  }
  listeners.forEach((listener) => listener())
  pushPreference({ sidebar: layout })
}

/** The sidebar as the user arranged it: which places, in what order, under More or hidden. */
export function useSidebarLayout() {
  return useSyncExternalStore(subscribe, readSidebar)
}

/** What this browser has arranged, if anything, for the first device to bring along. */
function readSidebarSaved(): SidebarLayout | null {
  try {
    return localStorage.getItem(SIDEBAR_KEY) ? readSidebar() : null
  } catch {
    return null
  }
}

const DELIVERED_KEY = "evido.mail.parcels-delivered"

function readShowDelivered() {
  try {
    return localStorage.getItem(DELIVERED_KEY) === "show"
  } catch {
    return false
  }
}

export function setShowDelivered(show: boolean) {
  try {
    if (show) localStorage.setItem(DELIVERED_KEY, "show")
    else localStorage.removeItem(DELIVERED_KEY)
  } catch {
    // Without storage the filter only lasts this visit.
  }
  listeners.forEach((listener) => listener())
}

/** Parcels that arrived stay out of the list unless asked for; remembered per browser, as a view. */
export function useShowDelivered() {
  return useSyncExternalStore(subscribe, readShowDelivered)
}

/** The settings that follow the account; notifications stay per browser. */
type AccountPreferences = {
  summaries: boolean
  codes: boolean
  aiWriting: boolean
  remoteImages: boolean
  parcels: boolean
  unsubscribe: boolean
  senders: boolean
  invoices: boolean
  todos: boolean
  pins: boolean
  sidebar: SidebarLayout | null
}

const PREFERENCES_URL = "/api/mail/preferences"

function localPreferences(): AccountPreferences {
  return {
    summaries: readSummaries(),
    codes: readCodes(),
    aiWriting: readWriting(),
    remoteImages: readRemoteImages(),
    parcels: readParcels(),
    unsubscribe: readUnsubscribe(),
    senders: readSenders(),
    invoices: readInvoices(),
    todos: readTodos(),
    pins: readPins(),
    sidebar: readSidebarSaved(),
  }
}

/** Mirrors the account's choice in this browser, which keeps the app quick to start. */
function applyLocally(preferences: AccountPreferences) {
  const set = (key: string, value: string | null) => {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  }
  try {
    set(SUMMARIES_KEY, preferences.summaries ? null : "off")
    set(CODES_KEY, preferences.codes ? null : "off")
    set(WRITING_KEY, preferences.aiWriting ? null : "off")
    set(REMOTE_IMAGES_KEY, preferences.remoteImages ? "always" : null)
    // Older accounts saved before this setting existed have it on.
    set(PARCELS_KEY, preferences.parcels === false ? "off" : null)
    set(UNSUBSCRIBE_KEY, preferences.unsubscribe === false ? "off" : null)
    set(SENDERS_KEY, preferences.senders === false ? "off" : null)
    set(INVOICES_KEY, preferences.invoices === false ? "off" : null)
    set(TODOS_KEY, preferences.todos === false ? "off" : null)
    set(PINS_KEY, preferences.pins === false ? "off" : null)
    set(SIDEBAR_KEY, preferences.sidebar ? JSON.stringify(preferences.sidebar) : null)
  } catch {
    // Blocked storage: the account still has them; this browser uses the defaults.
  }
  listeners.forEach((listener) => listener())
}

function pushPreference(change: Partial<AccountPreferences>) {
  void api(PREFERENCES_URL, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change),
  }).catch((error: unknown) => toast.error(errorText(error)))
}

/**
 * Loads the account's settings, and again when the tab comes back into view,
 * so a change on another device shows here too. An account without saved
 * settings takes this browser's.
 */
export function usePreferencesSync() {
  const remote = useQuery({
    queryKey: ["mail-preferences"],
    queryFn: () => api<{ preferences: AccountPreferences | null }>(PREFERENCES_URL),
    staleTime: 0,
    refetchOnWindowFocus: true,
  })
  const preferences = remote.data?.preferences
  // Every answer counts, even one equal to the last: a change made here since may differ from it.
  const fetchedAt = remote.dataUpdatedAt
  useEffect(() => {
    if (!fetchedAt) return
    if (preferences) applyLocally(preferences)
    else pushPreference(localPreferences())
  }, [fetchedAt])
}
