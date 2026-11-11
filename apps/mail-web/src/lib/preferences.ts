import { useEffect, useSyncExternalStore } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
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
