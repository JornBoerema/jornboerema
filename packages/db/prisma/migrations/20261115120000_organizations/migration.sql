-- Workspaces become organizations (Better Auth organization plugin). Renamed in
-- place, so every list, note, status and project keeps its organization.

ALTER TABLE "workspaces" RENAME TO "organizations";
ALTER TABLE "organizations" RENAME CONSTRAINT "workspaces_pkey" TO "organizations_pkey";
ALTER TABLE "organizations" ADD COLUMN "slug" TEXT;
UPDATE "organizations" SET "slug" = "id";
ALTER TABLE "organizations" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
ALTER TABLE "organizations" ADD COLUMN "logo" TEXT;
ALTER TABLE "organizations" ADD COLUMN "metadata" TEXT;
ALTER TABLE "organizations" ADD COLUMN "personal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN "stripe_customer_id" TEXT;

ALTER TABLE "workspace_members" RENAME TO "members";
ALTER TABLE "members" RENAME CONSTRAINT "workspace_members_pkey" TO "members_pkey";
ALTER TABLE "members" RENAME COLUMN "workspace_id" TO "organization_id";
ALTER TABLE "members" RENAME CONSTRAINT "workspace_members_workspace_id_fkey" TO "members_organization_id_fkey";
ALTER TABLE "members" RENAME CONSTRAINT "workspace_members_user_id_fkey" TO "members_user_id_fkey";
ALTER INDEX "workspace_members_workspace_user_unique" RENAME TO "members_organization_user_unique";
ALTER INDEX "workspace_members_user_idx" RENAME TO "members_user_idx";

ALTER TABLE "workspace_invitations" RENAME TO "invitations";
ALTER TABLE "invitations" RENAME CONSTRAINT "workspace_invitations_pkey" TO "invitations_pkey";
ALTER TABLE "invitations" RENAME COLUMN "workspace_id" TO "organization_id";
ALTER TABLE "invitations" RENAME CONSTRAINT "workspace_invitations_workspace_id_fkey" TO "invitations_organization_id_fkey";
ALTER TABLE "invitations" RENAME CONSTRAINT "workspace_invitations_invited_by_id_fkey" TO "invitations_invited_by_id_fkey";
ALTER INDEX "workspace_invitations_workspace_email_unique" RENAME TO "invitations_organization_email_unique";
ALTER INDEX "workspace_invitations_token_hash_key" RENAME TO "invitations_token_hash_key";
ALTER TABLE "invitations" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending';
UPDATE "invitations" SET "status" = 'accepted' WHERE "accepted_at" IS NOT NULL;

ALTER TABLE "session" ADD COLUMN "active_organization_id" TEXT;

-- Each user's first organization that has only them in it, and that they own,
-- becomes their personal one. Whoever has none gets one the next time they come by.
UPDATE "organizations" SET "personal" = true
WHERE "id" IN (
  SELECT DISTINCT ON (m."user_id") m."organization_id"
  FROM "members" m
  WHERE m."role" = 'owner'
    AND (SELECT count(*) FROM "members" o WHERE o."organization_id" = m."organization_id") = 1
  ORDER BY m."user_id", m."created_at", m."id"
);

-- A subscription a user took out goes to their personal organization, with their Stripe customer.
UPDATE "organizations" o SET "stripe_customer_id" = u."stripe_customer_id"
FROM "members" m JOIN "user" u ON u."id" = m."user_id"
WHERE m."organization_id" = o."id" AND o."personal" AND u."stripe_customer_id" IS NOT NULL;
UPDATE "subscription" s SET "reference_id" = m."organization_id"
FROM "members" m JOIN "organizations" o ON o."id" = m."organization_id" AND o."personal"
WHERE s."reference_id" = m."user_id";
