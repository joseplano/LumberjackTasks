import { prisma } from '../db';
import { ApiError } from '../middleware/errors';

/**
 * The repository-history sync service: the ONLY write path for feature
 * 004-view-repo-git-tree.
 *
 * Every rule implemented here is numbered in
 * `specs/004-view-repo-git-tree/contracts/http-api.md` section 4, and the
 * numbers are quoted at the code that enforces them. The two that are easiest
 * to break silently are:
 *
 *   - rule 3 (attribution is fixed): an already-recorded SHA never changes its
 *     `branchId`. Enforced structurally -- the update payload has no `branchId`
 *     key at all, so no future edit can re-attribute a commit by accident.
 *   - rule 11 (one transaction): every DB-dependent check runs INSIDE the
 *     interactive transaction, so a rejection rolls the whole batch back and a
 *     failed sync records nothing.
 *
 * Validation is hand-rolled to match the rest of `src/services` (there is no
 * validation library in this package, on purpose). Constitution Principle IV:
 * nothing is skipped or trimmed silently -- every rejection names the field.
 */

/** Contract section 4 rule 5 (research R2): the batch cap that keeps a sync
 * inside the global `express.json({ limit: '100kb' })` without weakening it. */
export const MAX_COMMITS_PER_BATCH = 50;
/** Contract section 4 rule 6 (FR-023/D7): the per-commit file cap. Exceeding it
 * is a rejection, never a silent trim -- the agent must truncate itself and
 * report the remainder in `truncatedFileCount`. */
export const MAX_FILES_PER_COMMIT = 500;

const BRANCH_STATES = ['UNCOMMITTED', 'ACTIVE', 'MERGED'] as const;
const FILE_CHANGES = ['A', 'M', 'D', 'R'] as const;
type BranchState = (typeof BRANCH_STATES)[number];
type FileChange = (typeof FILE_CHANGES)[number];

/** A full git object name: 40 LOWERCASE hex characters (contract rule 7). An
 * abbreviated or upper-cased SHA would not join to anything in `parentShas`. */
const SHA_PATTERN = /^[0-9a-f]{40}$/;

interface ParsedBranch {
  name: string;
  isTrunk: boolean;
  forkedFromBranchName: string | null;
  state: BranchState;
}

interface ParsedFile {
  path: string;
  changeType: FileChange;
}

interface ParsedCommit {
  sha: string;
  branchName: string;
  message: string;
  authorName: string;
  committedAt: Date;
  pushed: boolean;
  isMerge: boolean;
  parentShas: string[];
  files: ParsedFile[];
  truncatedFileCount: number;
  ticketIds: string[];
}

interface ParsedBatch {
  branches: ParsedBranch[];
  commits: ParsedCommit[];
}

export interface GitHistorySyncResult {
  branchesUpserted: number;
  commitsUpserted: number;
  filesUpserted: number;
  ticketLinksUpserted: number;
  lastSyncedAt: string;
}

function invalid(message: string): never {
  throw new ApiError(400, 'VALIDATION', message);
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, field: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) invalid(`${field} must be an array`);
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    invalid(`${field} must be a non-empty string`);
  }
  return value;
}

/**
 * Rule 7: the booleans of contracts/mcp-tool.md are plain booleans -- only
 * `forkedFromBranchName` and `ticketIds` are marked optional there. They are
 * therefore REQUIRED with no default, for the same reason `state` is
 * (data-model.md): defaulting an omitted `isTrunk` to `false` would let a
 * re-report of `{ name: 'main', state: 'ACTIVE' }` silently demote the trunk
 * and leave the project with none (rule 9), and an omitted `isMerge` would
 * clear the merge flag and drop a merge edge at draw time (FR-007) -- both with
 * a 200 and no diagnostic, which Principle IV forbids.
 */
function requiredBoolean(value: unknown, field: string): boolean {
  if (value === undefined || value === null) {
    invalid(`${field} is required and must be a boolean`);
  }
  if (typeof value !== 'boolean') invalid(`${field} must be a boolean`);
  return value;
}

function optionalNullableString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') invalid(`${field} must be a string or null`);
  return value.trim() === '' ? null : value;
}

function nonNegativeInt(value: unknown, field: string): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    invalid(`${field} must be an integer of 0 or more`);
  }
  return value;
}

function enumValue<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    invalid(`${field} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function shaValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
    invalid(`${field} must be 40 lowercase hexadecimal characters`);
  }
  return value;
}

function dateValue(value: unknown, field: string): Date {
  if (typeof value !== 'string' && typeof value !== 'number') {
    invalid(`${field} must be a date the server can parse`);
  }
  const parsed = new Date(value as string | number);
  if (Number.isNaN(parsed.getTime())) {
    invalid(`${field} must be a date the server can parse`);
  }
  return parsed;
}

function parseBranch(raw: unknown, index: number): ParsedBranch {
  const field = `branches[${index}]`;
  const branch = asObject(raw, field);
  return {
    name: requiredString(branch.name, `${field}.name`),
    isTrunk: requiredBoolean(branch.isTrunk, `${field}.isTrunk`),
    forkedFromBranchName: optionalNullableString(
      branch.forkedFromBranchName,
      `${field}.forkedFromBranchName`,
    ),
    // Required with no default: an omitted state is a validation error rather
    // than a silent UNCOMMITTED (data-model.md).
    state: enumValue(branch.state, `${field}.state`, BRANCH_STATES),
  };
}

function parseFile(raw: unknown, field: string): ParsedFile {
  const file = asObject(raw, field);
  return {
    path: requiredString(file.path, `${field}.path`),
    changeType: enumValue(file.changeType, `${field}.changeType`, FILE_CHANGES),
  };
}

function parseCommit(raw: unknown, index: number): ParsedCommit {
  const field = `commits[${index}]`;
  const commit = asObject(raw, field);

  const rawFiles = asArray(commit.files, `${field}.files`);
  // Rule 6: rejected, never trimmed. The remainder belongs in truncatedFileCount.
  if (rawFiles.length > MAX_FILES_PER_COMMIT) {
    invalid(
      `${field}.files must contain at most ${MAX_FILES_PER_COMMIT} entries (received ${rawFiles.length}); ` +
        `truncate the list and report the remainder in ${field}.truncatedFileCount`,
    );
  }
  const files = rawFiles.map((file, i) => parseFile(file, `${field}.files[${i}]`));
  const seenPaths = new Set<string>();
  for (const file of files) {
    // Two entries for one path in one commit would make the write order decide
    // the stored changeType -- a silent resolution, which Principle IV forbids.
    if (seenPaths.has(file.path)) {
      invalid(`${field}.files contains the path "${file.path}" more than once`);
    }
    seenPaths.add(file.path);
  }

  const rawTicketIds = asArray(commit.ticketIds, `${field}.ticketIds`);
  const ticketIds = [
    ...new Set(
      rawTicketIds.map((id, i) => requiredString(id, `${field}.ticketIds[${i}]`)),
    ),
  ];

  const parentShas = asArray(commit.parentShas, `${field}.parentShas`).map((parent, i) =>
    shaValue(parent, `${field}.parentShas[${i}]`),
  );

  return {
    sha: shaValue(commit.sha, `${field}.sha`),
    branchName: requiredString(commit.branchName, `${field}.branchName`),
    message: requiredString(commit.message, `${field}.message`),
    authorName: requiredString(commit.authorName, `${field}.authorName`),
    committedAt: dateValue(commit.committedAt, `${field}.committedAt`),
    pushed: requiredBoolean(commit.pushed, `${field}.pushed`),
    isMerge: requiredBoolean(commit.isMerge, `${field}.isMerge`),
    parentShas,
    files,
    truncatedFileCount: nonNegativeInt(commit.truncatedFileCount, `${field}.truncatedFileCount`),
    ticketIds,
  };
}

/**
 * Shape validation: everything that can be decided without touching the
 * database. Unknown/extra properties are IGNORED rather than rejected (a
 * client-supplied `lastSyncedAt` is simply ignored, rule 4); the named fields
 * are validated strictly (rule 7).
 */
function parseBatch(body: unknown): ParsedBatch {
  const root = asObject(body ?? {}, 'body');

  const branches = asArray(root.branches, 'branches').map(parseBranch);
  const seenBranchNames = new Set<string>();
  branches.forEach((branch, index) => {
    if (seenBranchNames.has(branch.name)) {
      invalid(`branches[${index}].name repeats "${branch.name}"; each branch may appear once per batch`);
    }
    seenBranchNames.add(branch.name);
  });

  const rawCommits = asArray(root.commits, 'commits');
  // Rule 5: rejected, never trimmed. The whole history is loaded by calling
  // repeatedly; that is also how the D4 backfill works.
  if (rawCommits.length > MAX_COMMITS_PER_BATCH) {
    invalid(
      `commits must contain at most ${MAX_COMMITS_PER_BATCH} entries per request (received ${rawCommits.length}); ` +
        'split the history and sync it in several calls',
    );
  }
  const commits = rawCommits.map(parseCommit);
  const seenShas = new Set<string>();
  commits.forEach((commit, index) => {
    if (seenShas.has(commit.sha)) {
      invalid(`commits[${index}].sha repeats "${commit.sha}"; each commit may appear once per batch`);
    }
    seenShas.add(commit.sha);
  });

  return { branches, commits };
}

/**
 * Rule 9: at most one branch per project may be the trunk. The effective trunk
 * set is what the project would hold AFTER this batch: already-recorded trunks
 * that this batch does not re-report, plus the trunks the batch declares. That
 * covers both listed cases (two trunks inside one batch; one in the batch while
 * a DIFFERENT branch is already trunk) while allowing the same branch to be
 * re-reported as trunk, and allowing a batch that moves the trunk by demoting
 * the old one in the same call.
 */
function assertSingleTrunk(batch: ParsedBatch, existing: { name: string; isTrunk: boolean }[]) {
  const batchNames = new Set(batch.branches.map((branch) => branch.name));
  const trunks = new Set<string>();
  for (const branch of existing) {
    if (branch.isTrunk && !batchNames.has(branch.name)) trunks.add(branch.name);
  }
  for (const branch of batch.branches) {
    if (branch.isTrunk) trunks.add(branch.name);
  }
  if (trunks.size > 1) {
    const named = [...trunks].map((name) => `"${name}"`).join(' and ');
    invalid(
      `isTrunk: a project may have at most one trunk branch, but this batch would leave ${trunks.size} (${named})`,
    );
  }
}

export async function syncGitHistory(
  projectId: string,
  body: unknown,
): Promise<GitHistorySyncResult> {
  // Shape validation first: it needs no database and no project, so a malformed
  // batch never opens a transaction.
  const batch = parseBatch(body);
  // Rule 4: the server clock, once per batch. A client-supplied value is
  // ignored -- a mirror that can be told it is fresh is not a mirror.
  const syncedAt = new Date();

  return prisma.$transaction(
    async (tx) => {
      // Rule 12.
      const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true } });
      if (!project) throw new ApiError(404, 'NOT_FOUND', 'Project not found');

      const existingBranches = await tx.gitBranch.findMany({
        where: { projectId },
        select: { id: true, name: true, isTrunk: true },
      });

      assertSingleTrunk(batch, existingBranches);

      // Rule 7, last clause: a commit is never attached to an invented branch.
      // The branch must be in this batch or already recorded.
      const knownBranchNames = new Set([
        ...existingBranches.map((branch) => branch.name),
        ...batch.branches.map((branch) => branch.name),
      ]);
      batch.commits.forEach((commit, index) => {
        if (!knownBranchNames.has(commit.branchName)) {
          invalid(
            `commits[${index}].branchName "${commit.branchName}" is neither declared in this batch's branches ` +
              'nor already recorded for this project',
          );
        }
      });

      // Rule 8, first half: one read for every ticket id the batch names. The
      // per-commit rejection itself happens further down, at the point each
      // commit's links are written -- see the note there.
      const requestedTicketIds = [...new Set(batch.commits.flatMap((commit) => commit.ticketIds))];
      const ownedTicketIds = new Set<string>();
      if (requestedTicketIds.length > 0) {
        const projectTickets = await tx.ticket.findMany({
          where: { id: { in: requestedTicketIds }, projectId },
          select: { id: true },
        });
        for (const ticket of projectTickets) ownedTicketIds.add(ticket.id);
      }

      // ---- writes -------------------------------------------------------
      // Rule 2: additive only. Nothing below deletes a branch, commit, file or
      // ticket link; a branch absent from this batch keeps its record and its
      // previous lastSyncedAt because it is simply never touched.
      const branchIdsByName = new Map(existingBranches.map((branch) => [branch.name, branch.id]));

      for (const branch of batch.branches) {
        // Rule 1: branches match on (projectId, name).
        const row = await tx.gitBranch.upsert({
          where: { projectId_name: { projectId, name: branch.name } },
          create: {
            projectId,
            name: branch.name,
            isTrunk: branch.isTrunk,
            forkedFromBranchName: branch.forkedFromBranchName,
            state: branch.state,
            lastSyncedAt: syncedAt,
          },
          update: {
            isTrunk: branch.isTrunk,
            forkedFromBranchName: branch.forkedFromBranchName,
            state: branch.state,
            lastSyncedAt: syncedAt,
          },
          select: { id: true },
        });
        branchIdsByName.set(branch.name, row.id);
      }

      let filesUpserted = 0;
      let ticketLinksUpserted = 0;

      for (const [index, commit] of batch.commits.entries()) {
        // Rule 1: commits match on (projectId, sha).
        const existingCommit = await tx.gitCommit.findUnique({
          where: { projectId_sha: { projectId, sha: commit.sha } },
          select: { id: true },
        });

        let commitId: string;
        if (existingCommit) {
          // Rule 3 (FR-024/D8): `branchId` is deliberately ABSENT from this
          // payload. The commit stays attributed to the branch it was
          // introduced on even when the batch reports another one; every other
          // field is updated.
          await tx.gitCommit.update({
            where: { id: existingCommit.id },
            data: {
              message: commit.message,
              authorName: commit.authorName,
              committedAt: commit.committedAt,
              pushed: commit.pushed,
              isMerge: commit.isMerge,
              parentShas: commit.parentShas,
              truncatedFileCount: commit.truncatedFileCount,
            },
          });
          commitId = existingCommit.id;
        } else {
          const created = await tx.gitCommit.create({
            data: {
              projectId,
              branchId: branchIdsByName.get(commit.branchName)!,
              sha: commit.sha,
              message: commit.message,
              authorName: commit.authorName,
              committedAt: commit.committedAt,
              pushed: commit.pushed,
              isMerge: commit.isMerge,
              parentShas: commit.parentShas,
              truncatedFileCount: commit.truncatedFileCount,
            },
            select: { id: true },
          });
          commitId = created.id;
        }

        for (const file of commit.files) {
          // Rule 1: files match on (commitId, path).
          await tx.gitCommitFile.upsert({
            where: { commitId_path: { commitId, path: file.path } },
            create: { commitId, path: file.path, changeType: file.changeType },
            update: { changeType: file.changeType },
            select: { id: true },
          });
          filesUpserted += 1;
        }

        if (commit.ticketIds.length > 0) {
          // Rule 8, second half: a ticket id that is not this project's is
          // rejected by name, never skipped silently (Principle IV). The check
          // lives HERE, at the write, rather than up with its read: by this
          // point the batch's branches and every earlier commit have already
          // been written, so the rejection is a real mid-write abort and rule 11
          // (one transaction) is what makes the batch record nothing. Hoisting
          // it back above the writes would make the transaction unobservable --
          // and untestable.
          for (const ticketId of commit.ticketIds) {
            if (!ownedTicketIds.has(ticketId)) {
              invalid(
                `commits[${index}].ticketIds contains "${ticketId}", which is not a ticket of this project`,
              );
            }
          }
          // Rule 1: ticket links match on (commitId, ticketId). There is nothing
          // to update on a link -- its existence IS the claim that the agent
          // reported it (research R6) -- so an insert that skips duplicates is
          // the whole upsert.
          await tx.gitCommitTicket.createMany({
            data: commit.ticketIds.map((ticketId) => ({ commitId, ticketId })),
            skipDuplicates: true,
          });
          ticketLinksUpserted += commit.ticketIds.length;
        }
      }

      return {
        branchesUpserted: batch.branches.length,
        commitsUpserted: batch.commits.length,
        filesUpserted,
        ticketLinksUpserted,
        lastSyncedAt: syncedAt.toISOString(),
      };
    },
    // A full batch is up to 50 commits of up to 500 files; the default 5s
    // interactive-transaction budget is not enough for the upper end of that.
    { maxWait: 15_000, timeout: 120_000 },
  );
}
