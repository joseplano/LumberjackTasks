-- AlterTable
ALTER TABLE "kanban_columns" ADD COLUMN "isCompletionColumn" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
-- NOT REVERSIBLE while any completed ticket exists: restoring NOT NULL on
-- tickets.columnId will fail on any row where it is null. Before reverting
-- this migration, every completed ticket must first be restored to the
-- board (columnId set back to a real column) so that no row violates the
-- constraint being re-added.
ALTER TABLE "tickets" ALTER COLUMN "columnId" DROP NOT NULL;

-- CreateIndex
-- Partial unique index: Prisma's schema language cannot express a filtered
-- unique index, so this exists ONLY here. See the isCompletionColumn field
-- comment in schema.prisma and specs/001-terminal-column-sweep/research.md R2.
-- Do not drop it, and do not attempt to express it as a plain @@unique in
-- schema.prisma — a future `prisma migrate dev` would silently regenerate a
-- non-partial index and lose the "at most one per project" guarantee.
CREATE UNIQUE INDEX "kanban_columns_projectId_completion_key"
  ON "kanban_columns" ("projectId")
  WHERE "isCompletionColumn" = true;
