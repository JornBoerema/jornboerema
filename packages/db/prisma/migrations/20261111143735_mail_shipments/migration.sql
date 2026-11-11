-- CreateTable
CREATE TABLE "mail_shipments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "found" BOOLEAN NOT NULL,
    "carrier" TEXT,
    "tracking_code" TEXT,
    "tracking_url" TEXT,
    "merchant" TEXT,
    "status" TEXT,
    "subject" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mail_shipments_user_received_idx" ON "mail_shipments"("user_id", "received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "mail_shipments_thread_key" ON "mail_shipments"("account_id", "thread_id");

-- AddForeignKey
ALTER TABLE "mail_shipments" ADD CONSTRAINT "mail_shipments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_shipments" ADD CONSTRAINT "mail_shipments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mail_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
