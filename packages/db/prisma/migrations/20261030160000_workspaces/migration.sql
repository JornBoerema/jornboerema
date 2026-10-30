-- Workspaces: every list belongs to a workspace; all members see its lists.
CREATE TYPE "WorkspaceRole" AS ENUM ('owner', 'admin', 'member');

CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_members" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_invitations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspace_invitations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workspace_members_user_idx" ON "workspace_members"("user_id");
CREATE UNIQUE INDEX "workspace_members_workspace_user_unique" ON "workspace_members"("workspace_id", "user_id");
CREATE UNIQUE INDEX "workspace_invitations_token_hash_key" ON "workspace_invitations"("token_hash");
CREATE UNIQUE INDEX "workspace_invitations_workspace_email_unique" ON "workspace_invitations"("workspace_id", "email");

ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing data: one "Persoonlijk" workspace per user that owns lists.
CREATE TEMP TABLE "_personal" AS
  SELECT DISTINCT "user_id", gen_random_uuid()::text AS "workspace_id" FROM "lists";
INSERT INTO "workspaces" ("id", "name") SELECT "workspace_id", 'Persoonlijk' FROM "_personal";
INSERT INTO "workspace_members" ("id", "workspace_id", "user_id", "role")
  SELECT gen_random_uuid()::text, "workspace_id", "user_id", 'owner' FROM "_personal";

ALTER TABLE "lists" ADD COLUMN "workspace_id" TEXT;
UPDATE "lists" SET "workspace_id" = p."workspace_id" FROM "_personal" p WHERE p."user_id" = "lists"."user_id";
ALTER TABLE "lists" ALTER COLUMN "workspace_id" SET NOT NULL;
CREATE INDEX "lists_workspace_idx" ON "lists"("workspace_id");
ALTER TABLE "lists" ADD CONSTRAINT "lists_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP TABLE "_personal";

-- The creator is informational now; deleting an account must not delete
-- lists it created in someone else's workspace.
ALTER TABLE "lists" DROP CONSTRAINT "lists_user_id_fkey";
ALTER TABLE "lists" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "lists" ADD CONSTRAINT "lists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Per-list e-mail sharing is replaced by workspace membership.
DROP TABLE "list_invitations";
DROP TABLE "list_members";

-- A workspace without an owner (e.g. the owner deleted their account) is
-- removed with its lists, like an owner's own lists were before.
CREATE FUNCTION "delete_ownerless_workspace"() RETURNS trigger AS $$
BEGIN
  DELETE FROM "workspaces" w
  WHERE w."id" = OLD."workspace_id"
    AND NOT EXISTS (
      SELECT 1 FROM "workspace_members" m
      WHERE m."workspace_id" = OLD."workspace_id" AND m."role" = 'owner'
    );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "workspace_members_owner_removed"
  AFTER DELETE OR UPDATE OF "role" ON "workspace_members"
  FOR EACH ROW WHEN (OLD."role" = 'owner')
  EXECUTE FUNCTION "delete_ownerless_workspace"();
