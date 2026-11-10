-- Signatures become their own records that mailboxes point at.
-- The old per-mailbox columns stay until the next migration, so the running app keeps working.

-- CreateTable
CREATE TABLE "mail_signatures" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mail_signatures_user_created_idx" ON "mail_signatures"("user_id", "created_at");

-- AlterTable
ALTER TABLE "mail_accounts" ADD COLUMN "signature_new_id" TEXT,
ADD COLUMN "signature_reply_id" TEXT;

-- AddForeignKey
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_signature_new_id_fkey" FOREIGN KEY ("signature_new_id") REFERENCES "mail_signatures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_signature_reply_id_fkey" FOREIGN KEY ("signature_reply_id") REFERENCES "mail_signatures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_signatures" ADD CONSTRAINT "mail_signatures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every signature written so far becomes a named one, still used where it was.
INSERT INTO "mail_signatures" ("id", "user_id", "name", "html", "created_at", "updated_at")
SELECT 'sig_' || "id", "user_id", "email", "signature_html", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "mail_accounts"
WHERE "signature_html" <> '';

UPDATE "mail_accounts"
SET "signature_new_id" = CASE WHEN "signature_for_new" THEN 'sig_' || "id" END,
    "signature_reply_id" = CASE WHEN "signature_for_replies" THEN 'sig_' || "id" END
WHERE "signature_html" <> '';
