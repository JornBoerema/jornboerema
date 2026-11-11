-- CreateIndex
CREATE INDEX "mail_messages_account_thread_idx" ON "mail_messages"("account_id", "thread_id");
