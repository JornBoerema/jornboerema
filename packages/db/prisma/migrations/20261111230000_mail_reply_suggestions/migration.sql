-- AlterTable
ALTER TABLE "mail_summaries" ADD COLUMN     "replies" JSONB;

-- AlterTable
ALTER TABLE "mail_preferences" ADD COLUMN     "reply_suggestions" BOOLEAN NOT NULL DEFAULT true;
