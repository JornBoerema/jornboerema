-- AlterTable
ALTER TABLE "mail_accounts" ADD COLUMN     "watch_expires_at" TIMESTAMP(3),
ADD COLUMN     "watch_id" TEXT;

-- CreateIndex
CREATE INDEX "mail_accounts_watch_id_idx" ON "mail_accounts"("watch_id");

