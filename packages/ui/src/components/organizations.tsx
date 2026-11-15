import { createContext, useContext } from "react"

/** An organization the user is in, as the rail's picker lists it. */
export type OrganizationSummary = {
  id: string
  name: string
  role: "owner" | "admin" | "member"
  memberCount: number
  /** The user's own organization: only them. */
  personal: boolean
}

type OrganizationsState = {
  organizations: OrganizationSummary[]
  /** The one the apps show; chosen in the rail, kept on the session so every device follows. */
  active: OrganizationSummary
  select: (id: string) => void
  /** After an organization was made, renamed or left: read the list again. */
  refresh: () => Promise<void>
}

const OrganizationsContext = createContext<OrganizationsState | null>(null)

/** Set by the Even shell around every app. */
export const OrganizationsProvider = OrganizationsContext.Provider

/** The organizations and the active one; null outside the Even shell (shared links, invitations). */
export const useOrganizations = () => useContext(OrganizationsContext)
