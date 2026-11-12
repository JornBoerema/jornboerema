-- Every existing workspace gets Linear's default board statuses.
INSERT INTO "workspace_statuses" ("id", "workspace_id", "name", "category", "color", "position")
SELECT gen_random_uuid()::text, w."id", d."name", d."category"::"StatusCategory", d."color", d."position"
FROM "workspaces" w
CROSS JOIN (VALUES
  ('Backlog', 'backlog', '#95a2b3', 0),
  ('Todo', 'unstarted', '#a1a1aa', 1),
  ('In Progress', 'started', '#f2c94c', 2),
  ('In Review', 'started', '#4cb782', 3),
  ('Done', 'completed', '#5e6ad2', 4),
  ('Canceled', 'canceled', '#95a2b3', 5)
) AS d("name", "category", "color", "position")
WHERE NOT EXISTS (SELECT 1 FROM "workspace_statuses" s WHERE s."workspace_id" = w."id");
