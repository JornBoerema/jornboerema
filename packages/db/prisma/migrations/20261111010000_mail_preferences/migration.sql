-- CreateTable
CREATE TABLE "mail_preferences" (
    "user_id" TEXT NOT NULL,
    "summaries" BOOLEAN NOT NULL DEFAULT true,
    "codes" BOOLEAN NOT NULL DEFAULT true,
    "ai_writing" BOOLEAN NOT NULL DEFAULT true,
    "remote_images" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_preferences_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "mail_preferences" ADD CONSTRAINT "mail_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
