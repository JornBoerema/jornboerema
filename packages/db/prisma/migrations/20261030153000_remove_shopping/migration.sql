-- Shopping lists are removed from the todo app.
DELETE FROM "lists" WHERE "kind" = 'shopping';

ALTER TABLE "todos" DROP COLUMN "shopping";

-- Postgres cannot drop an enum value; swap in a new type without it.
ALTER TYPE "ListKind" RENAME TO "ListKind_old";
CREATE TYPE "ListKind" AS ENUM ('todo', 'note');
ALTER TABLE "lists" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "lists" ALTER COLUMN "kind" TYPE "ListKind" USING ("kind"::text::"ListKind");
ALTER TABLE "lists" ALTER COLUMN "kind" SET DEFAULT 'todo';
DROP TYPE "ListKind_old";
