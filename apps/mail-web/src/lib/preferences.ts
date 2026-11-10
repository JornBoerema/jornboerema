import { useSyncExternalStore } from "react"

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
}

/** On unless turned off: the conversation is sent to a language model to sum it up. */
export function useSummaries() {
  return useSyncExternalStore(subscribe, readSummaries)
}
