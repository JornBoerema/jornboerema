-- Every folder is synced, not only the inbox. Rows so far are all inbox mail.

-- CreateEnum
CREATE TYPE "mail_message_folder" AS ENUM ('inbox', 'sent', 'archive', 'spam', 'trash');

-- AlterTable
ALTER TABLE "mail_messages" ADD COLUMN "folder" "mail_message_folder" NOT NULL DEFAULT 'inbox',
ADD COLUMN "to_addresses" JSONB NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE INDEX "mail_messages_user_folder_received_idx" ON "mail_messages"("user_id", "folder", "received_at" DESC, "id" DESC);
