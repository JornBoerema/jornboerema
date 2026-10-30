import { z } from "zod";

// Public links share one list with anyone holding the link, without an account.
export const shareRole = z.enum(["viewer", "editor"]);
const id = z.string().uuid();
export const sharingCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("enable-link"), listId: id, role: shareRole }),
  z.object({ type: z.literal("revoke-link"), listId: id }),
]);
export type SharingCommand = z.infer<typeof sharingCommand>;
export type SharingData = {
  link: { token: string; role: "viewer" | "editor" } | null;
};
export function invitationReturnTo(value: string | null) {
  return value && /^\/uitnodiging\/[A-Za-z0-9_-]{43}$/.test(value)
    ? value
    : "/";
}
