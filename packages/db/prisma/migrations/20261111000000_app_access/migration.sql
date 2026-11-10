-- CreateTable
CREATE TABLE "app_access" (
    "user_id" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by" TEXT,

    CONSTRAINT "app_access_pkey" PRIMARY KEY ("user_id","app")
);

-- CreateTable
CREATE TABLE "app_invites" (
    "id" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "invited_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),

    CONSTRAINT "app_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_access_requests" (
    "id" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_access_app_idx" ON "app_access"("app");

-- CreateIndex
CREATE UNIQUE INDEX "app_invites_app_email_key" ON "app_invites"("app", "email");

-- CreateIndex
CREATE INDEX "app_access_requests_app_idx" ON "app_access_requests"("app");

-- CreateIndex
CREATE UNIQUE INDEX "app_access_requests_app_user_id_key" ON "app_access_requests"("app", "user_id");

-- AddForeignKey
ALTER TABLE "app_access" ADD CONSTRAINT "app_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_access_requests" ADD CONSTRAINT "app_access_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Everyone who already connected a mailbox keeps using Even mailen.
INSERT INTO "app_access" ("user_id", "app")
SELECT DISTINCT "user_id", 'mail' FROM "mail_accounts"
ON CONFLICT DO NOTHING;
