-- CreateEnum
CREATE TYPE "StatusCategory" AS ENUM ('backlog', 'unstarted', 'started', 'completed', 'canceled');

-- AlterEnum
ALTER TYPE "ListKind" ADD VALUE 'board';

-- AlterTable
ALTER TABLE "todos" ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "number" INTEGER,
ADD COLUMN     "parent_id" TEXT,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "project_id" TEXT,
ADD COLUMN     "status_id" TEXT;

-- CreateTable
CREATE TABLE "workspace_statuses" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "StatusCategory" NOT NULL,
    "color" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "todo_assignees" (
    "todo_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "todo_assignees_pkey" PRIMARY KEY ("todo_id","user_id")
);

-- CreateTable
CREATE TABLE "todo_attachments" (
    "id" TEXT NOT NULL,
    "todo_id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "todo_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "todo_attachment_chunks" (
    "attachment_id" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "todo_attachment_chunks_pkey" PRIMARY KEY ("attachment_id","index")
);

-- CreateIndex
CREATE INDEX "workspace_statuses_workspace_idx" ON "workspace_statuses"("workspace_id");

-- CreateIndex
CREATE INDEX "projects_workspace_idx" ON "projects"("workspace_id");

-- CreateIndex
CREATE INDEX "todo_assignees_user_idx" ON "todo_assignees"("user_id");

-- CreateIndex
CREATE INDEX "todo_attachments_todo_idx" ON "todo_attachments"("todo_id");

-- CreateIndex
CREATE INDEX "todos_parent_idx" ON "todos"("parent_id");

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "workspace_statuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "todos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_statuses" ADD CONSTRAINT "workspace_statuses_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todo_assignees" ADD CONSTRAINT "todo_assignees_todo_id_fkey" FOREIGN KEY ("todo_id") REFERENCES "todos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todo_assignees" ADD CONSTRAINT "todo_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todo_attachments" ADD CONSTRAINT "todo_attachments_todo_id_fkey" FOREIGN KEY ("todo_id") REFERENCES "todos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todo_attachments" ADD CONSTRAINT "todo_attachments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todo_attachment_chunks" ADD CONSTRAINT "todo_attachment_chunks_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "todo_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
