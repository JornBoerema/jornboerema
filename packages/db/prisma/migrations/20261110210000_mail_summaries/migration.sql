-- CreateTable
CREATE TABLE "mail_summaries" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "code" TEXT,
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mail_summaries_key" ON "mail_summaries"("account_id", "thread_id", "message_id", "language");

-- AddForeignKey
ALTER TABLE "mail_summaries" ADD CONSTRAINT "mail_summaries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mail_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

