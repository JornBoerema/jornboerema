-- CreateTable
CREATE TABLE "connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "access_token_sealed" TEXT NOT NULL,
    "refresh_token_sealed" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "default_target_id" TEXT,
    "default_target_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connection_oauth_states" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connection_oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moneybird_exports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "attachment_key" TEXT NOT NULL,
    "attachment_name" TEXT NOT NULL,
    "sender_domain" TEXT,
    "administration_id" TEXT NOT NULL,
    "administration_name" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moneybird_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "connections_user_provider_key" ON "connections"("user_id", "provider");

-- CreateIndex
CREATE INDEX "connection_oauth_states_expires_idx" ON "connection_oauth_states"("expires_at");

-- CreateIndex
CREATE INDEX "moneybird_exports_thread_idx" ON "moneybird_exports"("account_id", "thread_id");

-- CreateIndex
CREATE INDEX "moneybird_exports_sender_idx" ON "moneybird_exports"("user_id", "sender_domain");

-- CreateIndex
CREATE UNIQUE INDEX "moneybird_exports_file_key" ON "moneybird_exports"("account_id", "message_id", "attachment_key", "administration_id");

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moneybird_exports" ADD CONSTRAINT "moneybird_exports_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mail_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
