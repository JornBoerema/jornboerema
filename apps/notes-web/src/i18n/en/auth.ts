// English texts for the "auth" namespace. Keys are shared with ../nl/auth.ts.
export const auth = {
  layout: {
    homeLabel: "Even noteren, go to your notes",
    tagline: "Your notes, in every workspace.",
  },
  invitation: {
    pageTitle: "Workspace invitation",
    unavailableTitle: "Invitation not available",
    unavailableDescription: "This link has expired or was revoked. Ask the owner for a new invitation.",
    joinTitle: (workspace: string) => `Join ${workspace}`,
    invitedTitle: "You've been invited",
    joinDescription: (role: "admin" | "member") =>
      `You'll become ${role === "admin" ? "an admin" : "a member"} of this workspace and see all its notes.`,
    invitedDescription: (workspace: string) =>
      `You've been invited to the workspace ${workspace}. Create an account or sign in to accept the invitation.`,
    useInvitedEmail: "Use the email address the invitation was sent to.",
    createAccount: "Create account",
    haveAccount: "I already have an account",
    switchAccount: "Use a different account",
    accept: "Accept invitation",
  },
}
