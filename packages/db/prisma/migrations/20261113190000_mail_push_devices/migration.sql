-- Phones and tablets that get a notification when new mail arrives.
CREATE TABLE "mail_push_devices" (
    "token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_push_devices_pkey" PRIMARY KEY ("token")
);

CREATE INDEX "mail_push_devices_user_idx" ON "mail_push_devices"("user_id");

ALTER TABLE "mail_push_devices" ADD CONSTRAINT "mail_push_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
