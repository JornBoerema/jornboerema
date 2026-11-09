-- AlterTable
ALTER TABLE "mail_accounts" ADD COLUMN     "sync_cursor" TEXT,
ADD COLUMN     "sync_locked_until" TIMESTAMP(3),
ADD COLUMN     "sync_since" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "mail_messages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "thread_id" TEXT,
    "subject" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "from_name" TEXT,
    "from_email" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL,
    "is_read" BOOLEAN NOT NULL,
    "is_starred" BOOLEAN NOT NULL,
    "has_attachments" BOOLEAN NOT NULL,

    CONSTRAINT "mail_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mail_messages_user_received_idx" ON "mail_messages"("user_id", "received_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "mail_messages_account_received_idx" ON "mail_messages"("account_id", "received_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "mail_messages_account_provider_unique" ON "mail_messages"("account_id", "provider_message_id");

-- AddForeignKey
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mail_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

