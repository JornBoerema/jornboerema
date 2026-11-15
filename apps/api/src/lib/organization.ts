import type { Context } from "hono"
import { getDb } from "@even/db"
import { ensurePersonalOrganization } from "../todo/workspaces-server"
import type { AppEnv } from "./session"

/** Which organization the app shows, sent by the Even shell with every mail request. */
export const ORGANIZATION_HEADER = "X-Even-Organization"

/**
 * The organization a request works in: the one the client names, else the one
 * active on the session, else the user's personal one. Only ever one they are in.
 */
export function activeOrganization(c: Context<AppEnv>): Promise<string> {
  // Asked by the access check and the route alike: once per request.
  let found = resolved.get(c.req.raw)
  if (!found) {
    found = resolve(c)
    resolved.set(c.req.raw, found)
  }
  return found
}

const resolved = new WeakMap<Request, Promise<string>>()

async function resolve(c: Context<AppEnv>) {
  const session = c.get("session")
  const userId = session.user.id
  const asked = [
    c.req.header(ORGANIZATION_HEADER),
    (session.session as { activeOrganizationId?: string | null }).activeOrganizationId,
  ].filter((id): id is string => Boolean(id))
  for (const organizationId of new Set(asked)) {
    const member = await getDb().member.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true },
    })
    if (member) return organizationId
  }
  return ensurePersonalOrganization(userId)
}
