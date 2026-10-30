import { z } from "zod";

export type WorkspaceRole = "owner" | "admin" | "member";
export type WorkspaceSummary = {
  id: string;
  name: string;
  role: WorkspaceRole;
  memberCount: number;
};
export type WorkspaceMembers = {
  members: { id: string; userId: string; name: string; email: string; role: WorkspaceRole }[];
  invitations: { id: string; email: string; role: WorkspaceRole; expiresAt: string }[];
};

export const roleLabels: Record<"en" | "nl", Record<WorkspaceRole, string>> = {
  en: { owner: "Owner", admin: "Admin", member: "Member" },
  nl: { owner: "Eigenaar", admin: "Beheerder", member: "Lid" },
};
/** Owners and admins manage members and workspace settings. */
export const canManageWorkspace = (role: WorkspaceRole) => role !== "member";

const id = z.string().uuid();
const name = z.string().trim().min(1, "workspace_name_required").max(60);
// Ownership is never handed out through invitations or role changes.
const assignableRole = z.enum(["admin", "member"]);
export const workspaceCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create"), id, name }),
  z.object({ type: z.literal("rename"), workspaceId: id, name }),
  z.object({ type: z.literal("delete"), workspaceId: id }),
  z.object({ type: z.literal("leave"), workspaceId: id }),
  z.object({
    type: z.literal("invite"),
    workspaceId: id,
    email: z.string().trim().toLowerCase().email("invalid_email").max(254),
    role: assignableRole,
  }),
  z.object({ type: z.literal("update-member"), workspaceId: id, memberId: id, role: assignableRole }),
  z.object({ type: z.literal("remove-member"), workspaceId: id, memberId: id }),
  z.object({ type: z.literal("revoke-invite"), workspaceId: id, invitationId: id }),
]);
export type WorkspaceCommand = z.infer<typeof workspaceCommand>;
