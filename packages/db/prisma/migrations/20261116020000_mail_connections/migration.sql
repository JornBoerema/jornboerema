-- Mailboxes per organization. A mailbox (tokens, sync, messages) now exists once per
-- provider account; mail_connections put it in a user's list within an organization.
-- The same address in two accounts or organizations is synced one time.

-- 1. Every user with a mailbox gets a personal organization, where their mailboxes go.
CREATE TEMP TABLE missing_personal AS
SELECT user_id, gen_random_uuid()::text AS organization_id
FROM (SELECT DISTINCT user_id FROM "mail_accounts") owners
WHERE NOT EXISTS (
  SELECT 1 FROM "members" m JOIN "organizations" o ON o.id = m.organization_id
  WHERE o.personal AND m.user_id = owners.user_id
);
INSERT INTO "organizations" ("id", "name", "slug", "personal")
SELECT organization_id, 'Personal', organization_id, true FROM missing_personal;
INSERT INTO "members" ("id", "organization_id", "user_id", "role")
SELECT gen_random_uuid()::text, organization_id, user_id, 'owner' FROM missing_personal;

-- 2. Connections: each existing mailbox in its owner's personal organization.
CREATE TABLE "mail_connections" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "color" INTEGER NOT NULL DEFAULT 0,
    "signature_new_id" TEXT,
    "signature_reply_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_connections_pkey" PRIMARY KEY ("id")
);

-- The oldest copy of a mailbox stays; later copies of the same provider account fold into it.
CREATE TEMP TABLE mailbox_keep AS
SELECT a.id AS account_id,
  first_value(a.id) OVER (PARTITION BY a.provider, a.provider_account_id ORDER BY a.created_at, a.id) AS keep_id
FROM "mail_accounts" a;

INSERT INTO "mail_connections" ("id", "account_id", "user_id", "organization_id", "color", "signature_new_id", "signature_reply_id", "created_at")
SELECT gen_random_uuid()::text, k.keep_id, a.user_id, m.organization_id, a.color, a.signature_new_id, a.signature_reply_id, a.created_at
FROM "mail_accounts" a
JOIN mailbox_keep k ON k.account_id = a.id
JOIN "members" m ON m.user_id = a.user_id
JOIN "organizations" o ON o.id = m.organization_id AND o.personal
ON CONFLICT DO NOTHING;

-- 3. What hung on a later copy moves to the one that stays, unless it already has it.
DROP INDEX "mail_pins_thread_key";
CREATE UNIQUE INDEX "mail_pins_user_thread_key" ON "mail_pins"("user_id", "account_id", "thread_id");

UPDATE "mail_pins" p SET account_id = k.keep_id FROM mailbox_keep k
WHERE p.account_id = k.account_id AND k.account_id <> k.keep_id
  AND NOT EXISTS (SELECT 1 FROM "mail_pins" q WHERE q.user_id = p.user_id AND q.account_id = k.keep_id AND q.thread_id = p.thread_id);
UPDATE "mail_snoozes" s SET account_id = k.keep_id FROM mailbox_keep k
WHERE s.account_id = k.account_id AND k.account_id <> k.keep_id
  AND NOT EXISTS (SELECT 1 FROM "mail_snoozes" q WHERE q.account_id = k.keep_id AND q.thread_id = s.thread_id);
UPDATE "mail_scheduled_sends" s SET account_id = k.keep_id FROM mailbox_keep k
WHERE s.account_id = k.account_id AND k.account_id <> k.keep_id
  AND NOT EXISTS (SELECT 1 FROM "mail_scheduled_sends" q WHERE q.account_id = k.keep_id AND q.draft_id = s.draft_id);
UPDATE "moneybird_exports" e SET account_id = k.keep_id FROM mailbox_keep k
WHERE e.account_id = k.account_id AND k.account_id <> k.keep_id
  AND NOT EXISTS (
    SELECT 1 FROM "moneybird_exports" q
    WHERE q.account_id = k.keep_id AND q.message_id = e.message_id
      AND q.attachment_key = e.attachment_key AND q.administration_id = e.administration_id
  );

-- The later copies go, with their messages and what could not move.
DELETE FROM "mail_accounts" a USING mailbox_keep k WHERE a.id = k.account_id AND k.account_id <> k.keep_id;

-- 4. Mailboxes lose their owner, colour and signatures (now on the connection).
ALTER TABLE "mail_accounts" DROP CONSTRAINT "mail_accounts_signature_new_id_fkey";
ALTER TABLE "mail_accounts" DROP CONSTRAINT "mail_accounts_signature_reply_id_fkey";
ALTER TABLE "mail_accounts" DROP CONSTRAINT "mail_accounts_user_id_fkey";
DROP INDEX "mail_accounts_user_provider_account_unique";
-- The tokens were sealed with the owner's id; it stays only for opening them.
ALTER TABLE "mail_accounts" RENAME COLUMN "user_id" TO "sealed_for";
ALTER TABLE "mail_accounts" DROP COLUMN "color",
DROP COLUMN "signature_new_id",
DROP COLUMN "signature_reply_id";
CREATE UNIQUE INDEX "mail_accounts_provider_account_unique" ON "mail_accounts"("provider", "provider_account_id");

-- 5. Messages and what is read from them belong to the mailbox, not to a user.
ALTER TABLE "mail_messages" DROP CONSTRAINT "mail_messages_user_id_fkey";
DROP INDEX "mail_messages_user_folder_received_idx";
DROP INDEX "mail_messages_user_received_idx";
ALTER TABLE "mail_messages" DROP COLUMN "user_id";
CREATE INDEX "mail_messages_account_folder_received_idx" ON "mail_messages"("account_id", "folder", "received_at" DESC, "id" DESC);

ALTER TABLE "mail_shipments" DROP CONSTRAINT "mail_shipments_user_id_fkey";
DROP INDEX "mail_shipments_user_received_idx";
ALTER TABLE "mail_shipments" DROP COLUMN "user_id";
CREATE INDEX "mail_shipments_account_received_idx" ON "mail_shipments"("account_id", "received_at" DESC);

ALTER TABLE "mail_invoices" DROP CONSTRAINT "mail_invoices_user_id_fkey";
DROP INDEX "mail_invoices_user_received_idx";
ALTER TABLE "mail_invoices" DROP COLUMN "user_id";
CREATE INDEX "mail_invoices_account_received_idx" ON "mail_invoices"("account_id", "received_at" DESC);

ALTER TABLE "mail_oauth_states" ADD COLUMN "organization_id" TEXT;

-- 6. Connections' keys.
CREATE INDEX "mail_connections_user_organization_idx" ON "mail_connections"("user_id", "organization_id");
CREATE UNIQUE INDEX "mail_connections_account_user_organization_unique" ON "mail_connections"("account_id", "user_id", "organization_id");
ALTER TABLE "mail_connections" ADD CONSTRAINT "mail_connections_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mail_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mail_connections" ADD CONSTRAINT "mail_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mail_connections" ADD CONSTRAINT "mail_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mail_connections" ADD CONSTRAINT "mail_connections_signature_new_id_fkey" FOREIGN KEY ("signature_new_id") REFERENCES "mail_signatures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mail_connections" ADD CONSTRAINT "mail_connections_signature_reply_id_fkey" FOREIGN KEY ("signature_reply_id") REFERENCES "mail_signatures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TABLE missing_personal;
DROP TABLE mailbox_keep;
