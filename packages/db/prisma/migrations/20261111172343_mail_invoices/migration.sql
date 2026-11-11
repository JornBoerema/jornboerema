-- AlterTable
ALTER TABLE "mail_preferences" ADD COLUMN     "invoices" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "mail_invoices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "read_version" INTEGER NOT NULL DEFAULT 1,
    "found" BOOLEAN NOT NULL,
    "vendor" TEXT,
    "amount_cents" INTEGER,
    "currency" TEXT,
    "due_date" TEXT,
    "invoice_number" TEXT,
    "pay_url" TEXT,
    "status" TEXT,
    "overdue" BOOLEAN NOT NULL DEFAULT false,
    "subject" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mail_invoices_user_received_idx" ON "mail_invoices"("user_id", "received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "mail_invoices_thread_key" ON "mail_invoices"("account_id", "thread_id");

-- AddForeignKey
ALTER TABLE "mail_invoices" ADD CONSTRAINT "mail_invoices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_invoices" ADD CONSTRAINT "mail_invoices_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mail_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
