-- Lists can be reordered in the sidebar; keep today's order (creation order).
ALTER TABLE "lists" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
UPDATE "lists" l SET "position" = o."position"
FROM (
  SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "workspace_id", "kind" ORDER BY "created_at", "id") - 1)::int AS "position"
  FROM "lists"
) o
WHERE o."id" = l."id";
