-- AlterTable
ALTER TABLE "mail_invoices" ADD COLUMN     "dismissed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "mail_shipments" ADD COLUMN     "dismissed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "mail_recognition_reports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "from_domain" TEXT,
    "found" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_recognition_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mail_recognition_reports_kind_created_idx" ON "mail_recognition_reports"("kind", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "mail_recognition_reports" ADD CONSTRAINT "mail_recognition_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
