-- CreateTable
CREATE TABLE "todo_mails" (
    "todo_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "from_name" TEXT,
    "from_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "todo_mails_pkey" PRIMARY KEY ("todo_id")
);

-- CreateIndex
CREATE INDEX "todo_mails_thread_idx" ON "todo_mails"("account_id", "thread_id");

-- AddForeignKey
ALTER TABLE "todo_mails" ADD CONSTRAINT "todo_mails_todo_id_fkey" FOREIGN KEY ("todo_id") REFERENCES "todos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
