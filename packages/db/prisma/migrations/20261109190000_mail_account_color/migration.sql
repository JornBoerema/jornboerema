-- AlterTable
ALTER TABLE "mail_accounts" ADD COLUMN     "color" INTEGER NOT NULL DEFAULT 0;

-- Give every existing mailbox its own colour, oldest first.
UPDATE "mail_accounts" AS account
SET "color" = ranked.position % 8
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "user_id" ORDER BY "created_at", "id") - 1 AS position
  FROM "mail_accounts"
) AS ranked
WHERE account."id" = ranked."id";
