-- CreateTable
CREATE TABLE "mail_uploads" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_upload_chunks" (
    "upload_id" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "mail_upload_chunks_pkey" PRIMARY KEY ("upload_id","index")
);

-- CreateIndex
CREATE INDEX "mail_uploads_created_idx" ON "mail_uploads"("created_at");

-- AddForeignKey
ALTER TABLE "mail_uploads" ADD CONSTRAINT "mail_uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_upload_chunks" ADD CONSTRAINT "mail_upload_chunks_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "mail_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

