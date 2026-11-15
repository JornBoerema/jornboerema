-- The trigger that removes an organization once its last owner leaves still
-- named the tables from before the rename to organizations (20261115120000),
-- so deleting an organization or one of its owners failed with
-- 'relation "workspaces" does not exist' (e.g. deleting an account).

CREATE OR REPLACE FUNCTION "delete_ownerless_workspace"() RETURNS trigger AS $$
BEGIN
  DELETE FROM "organizations" o
  WHERE o."id" = OLD."organization_id"
    AND NOT EXISTS (
      SELECT 1 FROM "members" m
      WHERE m."organization_id" = OLD."organization_id" AND m."role" = 'owner'
    );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
