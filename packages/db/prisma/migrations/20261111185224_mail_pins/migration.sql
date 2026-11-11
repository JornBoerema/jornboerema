-- AlterTable
ALTER TABLE "mail_preferences" ADD COLUMN     "pins" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "mail_pins" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_pins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mail_pins_user_idx" ON "mail_pins"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_pins_thread_key" ON "mail_pins"("account_id", "thread_id");

-- AddForeignKey
ALTER TABLE "mail_pins" ADD CONSTRAINT "mail_pins_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mail_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
