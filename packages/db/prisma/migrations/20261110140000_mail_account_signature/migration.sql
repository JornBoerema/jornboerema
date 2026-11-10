-- AlterTable
ALTER TABLE "mail_accounts" ADD COLUMN "signature_html" TEXT NOT NULL DEFAULT '',
ADD COLUMN "signature_for_new" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "signature_for_replies" BOOLEAN NOT NULL DEFAULT true;
