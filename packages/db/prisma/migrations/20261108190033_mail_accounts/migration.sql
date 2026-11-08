-- CreateEnum
CREATE TYPE "MailProvider" AS ENUM ('gmail', 'outlook');

-- CreateEnum
CREATE TYPE "MailAccountStatus" AS ENUM ('active', 'reauth_required');

-- CreateTable
CREATE TABLE "mail_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" "MailProvider" NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "access_token_sealed" TEXT NOT NULL,
    "refresh_token_sealed" TEXT NOT NULL,
    "access_token_expires_at" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL,
    "status" "MailAccountStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_oauth_states" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" "MailProvider" NOT NULL,
    "code_verifier_sealed" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mail_accounts_user_provider_account_unique" ON "mail_accounts"("user_id", "provider", "provider_account_id");

-- CreateIndex
CREATE INDEX "mail_oauth_states_expires_idx" ON "mail_oauth_states"("expires_at");

-- AddForeignKey
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_oauth_states" ADD CONSTRAINT "mail_oauth_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
