/** The places in the mail sidebar a user can order, tuck under More, or hide. */
export const NAV_ITEMS = [
  "inbox",
  "starred",
  "parcels",
  "invoices",
  "snoozed",
  "drafts",
  "scheduled",
  "sent",
  "senders",
  "archive",
  "spam",
  "trash",
] as const

export type NavItem = (typeof NAV_ITEMS)[number]
export type NavSection = "main" | "more" | "hidden"
export type SidebarLayout = Record<NavSection, NavItem[]>

export const DEFAULT_SIDEBAR: SidebarLayout = {
  main: ["inbox", "starred", "parcels", "invoices", "snoozed", "drafts", "scheduled", "sent", "senders"],
  more: ["archive", "spam", "trash"],
  hidden: [],
}

const isNavItem = (value: unknown): value is NavItem => NAV_ITEMS.includes(value as NavItem)

/**
 * A saved layout made whole: unknown places dropped, each place once, places
 * added since (by a newer app) in their default section, and the inbox never
 * hidden, so there is always a way home.
 */
export function normalizeSidebar(raw: unknown): SidebarLayout {
  if (!raw || typeof raw !== "object") return DEFAULT_SIDEBAR
  const seen = new Set<NavItem>()
  const section = (key: NavSection): NavItem[] => {
    const list = (raw as Partial<Record<NavSection, unknown>>)[key]
    if (!Array.isArray(list)) return []
    return list.filter((item): item is NavItem => {
      if (!isNavItem(item) || seen.has(item)) return false
      seen.add(item)
      return true
    })
  }
  const layout: SidebarLayout = { main: section("main"), more: section("more"), hidden: section("hidden") }
  for (const key of ["main", "more", "hidden"] as const)
    for (const item of DEFAULT_SIDEBAR[key]) if (!seen.has(item)) layout[key].push(item)
  if (layout.hidden.includes("inbox")) {
    layout.hidden = layout.hidden.filter((item) => item !== "inbox")
    layout.main.unshift("inbox")
  }
  return layout
}
