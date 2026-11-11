-- CreateTable
CREATE TABLE "mail_snoozes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "woke_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_snoozes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_scheduled_sends" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "send_at" TIMESTAMP(3) NOT NULL,
    "subject" TEXT NOT NULL,
    "to_addresses" JSONB NOT NULL DEFAULT '[]',
    "failed_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_scheduled_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mail_snoozes_until_idx" ON "mail_snoozes"("until");

-- CreateIndex
CREATE INDEX "mail_snoozes_user_until_idx" ON "mail_snoozes"("user_id", "until");

-- CreateIndex
CREATE UNIQUE INDEX "mail_snoozes_thread_key" ON "mail_snoozes"("account_id", "thread_id");

-- CreateIndex
CREATE INDEX "mail_scheduled_sends_send_at_idx" ON "mail_scheduled_sends"("send_at");

-- CreateIndex
CREATE UNIQUE INDEX "mail_scheduled_sends_draft_key" ON "mail_scheduled_sends"("account_id", "draft_id");

-- AddForeignKey
ALTER TABLE "mail_snoozes" ADD CONSTRAINT "mail_snoozes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_snoozes" ADD CONSTRAINT "mail_snoozes_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mail_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_scheduled_sends" ADD CONSTRAINT "mail_scheduled_sends_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_scheduled_sends" ADD CONSTRAINT "mail_scheduled_sends_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mail_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
