-- Statuses get one free order per workspace (no longer grouped by category)
-- and a default folded state for a board's list view.
ALTER TABLE "workspace_statuses" ADD COLUMN "collapsed" BOOLEAN NOT NULL DEFAULT false;

-- New default: in progress on top, then todo, backlog, and finished work folded at the bottom.
UPDATE "workspace_statuses" s
SET "position" = o."rank" - 1,
    "collapsed" = s."category" IN ('completed', 'canceled')
FROM (
  SELECT "id", row_number() OVER (
    PARTITION BY "workspace_id"
    ORDER BY CASE "category"
      WHEN 'started' THEN 0 WHEN 'unstarted' THEN 1 WHEN 'backlog' THEN 2
      WHEN 'completed' THEN 3 ELSE 4 END,
      "position", "id"
  ) AS "rank"
  FROM "workspace_statuses"
) o
WHERE s."id" = o."id";
