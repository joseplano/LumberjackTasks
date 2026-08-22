-- Feature 004-view-repo-git-tree: the recorded git history mirror.
-- Four new tables and two new enums. No column on any existing table changes;
-- Project and Ticket gain Prisma back-relations only, which produce no SQL.
-- Every foreign key below declares ON DELETE CASCADE explicitly. The one on
-- git_commit_tickets.ticketId is load-bearing: the Prisma relation is required,
-- and Prisma's default for a required relation is Restrict, which would make
-- deleting any ticket that has a commit link fail. See
-- specs/004-view-repo-git-tree/research.md R7.

-- CreateEnum GitBranchState
CREATE TYPE "GitBranchState" AS ENUM ('UNCOMMITTED', 'ACTIVE', 'MERGED');

-- CreateEnum GitFileChange
CREATE TYPE "GitFileChange" AS ENUM ('A', 'M', 'D', 'R');

-- CreateTable git_branches
CREATE TABLE "git_branches" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isTrunk" BOOLEAN NOT NULL DEFAULT false,
    "forkedFromBranchName" TEXT,
    "state" "GitBranchState" NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "git_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable git_commits
CREATE TABLE "git_commits" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "committedAt" TIMESTAMP(3) NOT NULL,
    "pushed" BOOLEAN NOT NULL DEFAULT false,
    "isMerge" BOOLEAN NOT NULL DEFAULT false,
    "parentShas" TEXT[],
    "truncatedFileCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "git_commits_pkey" PRIMARY KEY ("id")
);

-- CreateTable git_commit_files
CREATE TABLE "git_commit_files" (
    "id" TEXT NOT NULL,
    "commitId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "changeType" "GitFileChange" NOT NULL,

    CONSTRAINT "git_commit_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable git_commit_tickets
CREATE TABLE "git_commit_tickets" (
    "id" TEXT NOT NULL,
    "commitId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,

    CONSTRAINT "git_commit_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Branch identity within a project (FR-026): a re-sync updates instead of duplicating.
CREATE UNIQUE INDEX "git_branches_projectId_name_key" ON "git_branches"("projectId", "name");

-- CreateIndex
CREATE INDEX "git_commits_branchId_idx" ON "git_commits"("branchId");

-- CreateIndex
-- A SHA appears at most once per project: this enforces D8/FR-024, so a commit
-- cannot be re-attributed by appearing under a second branch.
CREATE UNIQUE INDEX "git_commits_projectId_sha_key" ON "git_commits"("projectId", "sha");

-- CreateIndex
CREATE INDEX "git_commit_files_commitId_idx" ON "git_commit_files"("commitId");

-- CreateIndex
CREATE UNIQUE INDEX "git_commit_files_commitId_path_key" ON "git_commit_files"("commitId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "git_commit_tickets_commitId_ticketId_key" ON "git_commit_tickets"("commitId", "ticketId");

-- AddForeignKey
ALTER TABLE "git_branches" ADD CONSTRAINT "git_branches_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "git_commits" ADD CONSTRAINT "git_commits_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "git_commits" ADD CONSTRAINT "git_commits_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "git_branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "git_commit_files" ADD CONSTRAINT "git_commit_files_commitId_fkey" FOREIGN KEY ("commitId") REFERENCES "git_commits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "git_commit_tickets" ADD CONSTRAINT "git_commit_tickets_commitId_fkey" FOREIGN KEY ("commitId") REFERENCES "git_commits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- Load-bearing: see the header comment and research R7. A regression test in
-- backend/tests/integration/tickets.test.ts is the only proof this is not RESTRICT.
ALTER TABLE "git_commit_tickets" ADD CONSTRAINT "git_commit_tickets_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
