import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, authHeader, prisma } from '../helpers';

const app = createApp();
let auth: { Authorization: string };
let projectId: string;

/** A syntactically valid 40-lowercase-hex object name derived from a number. */
const sha = (n: number) => n.toString(16).padStart(40, '0');
const syncUrl = (id: string) => `/api/v1/projects/${id}/git-history/sync`;
const historyUrl = (id: string) => `/api/v1/projects/${id}/git-history`;

function sync(body: unknown, id: string = projectId) {
  return request(app)
    .post(syncUrl(id))
    .set(auth)
    .send(body as object);
}

function list(id: string = projectId) {
  return request(app).get(historyUrl(id)).set(auth);
}

async function newProject(name: string) {
  const res = await request(app).post('/api/v1/projects').set(auth).send({ name });
  return res.body.id as string;
}

async function newTicket(pid: string, name: string) {
  const res = await request(app)
    .post(`/api/v1/projects/${pid}/tickets`)
    .set(auth)
    .send({ name, complexity: 1 });
  return res.body.id as string;
}

/** Row counts across every table the sync writes to. Used to prove rule 11 (a
 * failed batch records nothing) and rule 1 (a repeat batch duplicates nothing). */
async function gitRowCounts() {
  return {
    branches: await prisma.gitBranch.count(),
    commits: await prisma.gitCommit.count(),
    files: await prisma.gitCommitFile.count(),
    ticketLinks: await prisma.gitCommitTicket.count(),
  };
}

const trunk = { name: 'main', isTrunk: true, forkedFromBranchName: null, state: 'ACTIVE' };
const feature = {
  name: '004-view-repo-git-tree',
  isTrunk: false,
  forkedFromBranchName: 'main',
  state: 'ACTIVE',
};

/** A minimal, entirely valid commit. Individual tests override one field so that
 * exactly one thing is wrong (contract section 4 rule 7). */
function validCommit(overrides: Record<string, unknown> = {}) {
  return {
    sha: sha(1),
    branchName: 'main',
    message: 'chore: initial commit',
    authorName: 'juglarx',
    committedAt: '2026-08-21T18:02:11.000Z',
    pushed: true,
    isMerge: false,
    parentShas: [] as string[],
    files: [{ path: 'README.md', changeType: 'A' }],
    truncatedFileCount: 0,
    ticketIds: [] as string[],
    ...overrides,
  };
}

/** The same object with one key removed -- for proving a field is REQUIRED, which
 * a value of `false` (or `0`, or `[]`) cannot prove. contracts/mcp-tool.md marks
 * only `forkedFromBranchName` and `ticketIds` optional, so `isTrunk`, `pushed`,
 * `isMerge`, `parentShas` and `truncatedFileCount` are all required: omitting
 * any of them would overwrite recorded truth on a re-report. `files` alone stays
 * optional, because sync is additive and an absent files array cannot destroy
 * anything (rule 2 / FR-032). */
function omit<T extends Record<string, unknown>>(source: T, key: keyof T): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...source };
  delete copy[key as string];
  return copy;
}

describe('git history', () => {
  beforeEach(async () => {
    await resetDb();
    auth = await authHeader(app);
    const p = await request(app).post('/api/v1/projects').set(auth).send({ name: 'Proj' });
    projectId = p.body.id;
  });

  // T012 (research R2, contracts/http-api.md section 4 rule 10): the global
  // express.json({ limit: '100kb' }) in src/app.ts is a denial-of-service control
  // and stays exactly as it is -- constitution Principle III forbids weakening a
  // listed control. The agent chunks instead (at most 50 commits per call). What
  // must change is the REPORTING: without a mapping, body-parser's
  // `entity.too.large` falls through src/middleware/errors.ts to
  // 500 INTERNAL / "Unexpected error", so a sync fails without saying why, which
  // FR-020 and constitution Principle IV forbid.
  //
  // express.json() runs before routing, so the oversize body reaches the error
  // handler whether or not the sync route exists yet.
  describe('oversize sync body (T012)', () => {
    const oversizeBody = () => {
      // Comfortably over 100 KB: 4000 commit-shaped entries of ~30 bytes each.
      const commits = Array.from({ length: 4000 }, (_, i) => ({
        sha: i.toString(16).padStart(40, '0'),
      }));
      return JSON.stringify({ branches: [], commits });
    };

    it('answers 413 PAYLOAD_TOO_LARGE, never 500 INTERNAL', async () => {
      const body = oversizeBody();
      expect(Buffer.byteLength(body)).toBeGreaterThan(100 * 1024);

      const res = await request(app)
        .post(`/api/v1/projects/${projectId}/git-history/sync`)
        .set(auth)
        .set('Content-Type', 'application/json')
        .send(body);

      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(res.body.error.code).not.toBe('INTERNAL');
    });

    it('says what the caller should do about it, rather than "Unexpected error"', async () => {
      const res = await request(app)
        .post(`/api/v1/projects/${projectId}/git-history/sync`)
        .set(auth)
        .set('Content-Type', 'application/json')
        .send(oversizeBody());

      // The status is asserted here too: without it this case would still pass if
      // the mapping regressed to a 400 VALIDATION carrying the same text.
      expect(res.status).toBe(413);
      const message = String(res.body.error.message);
      expect(message).not.toBe('Unexpected error');
      // FR-020: the message must tell the agent the actionable remedy -- send fewer commits.
      expect(message.toLowerCase()).toContain('fewer commits');
    });

    // Fix wave, Important 2. "Send fewer commits" has a floor: a batch of ONE
    // commit cannot be split. A single commit whose own `files` array pushes
    // the body past 100 kB would then be permanently unsyncable, with the only
    // named remedy already exhausted. The message must also point at the
    // escape hatch the design already provides -- fewer `files`, remainder in
    // `truncatedFileCount` (contract section 4 rule 6, FR-023/FR-017) -- and
    // must keep that remainder REPORTED rather than dropped (constitution
    // Principle IV). Keep this in step with plugin/skills/ticket-sync/SKILL.md,
    // which is pinned by plugin/tests/plugin-config.test.mjs.
    it('also names the remedy for a SINGLE commit that is too large on its own', async () => {
      const res = await request(app)
        .post(`/api/v1/projects/${projectId}/git-history/sync`)
        .set(auth)
        .set('Content-Type', 'application/json')
        .send(oversizeBody());

      expect(res.status).toBe(413);
      const message = String(res.body.error.message);
      // Both remedies, and in that order: split the batch first; when one
      // commit still will not fit, send fewer files for that commit.
      expect(message.toLowerCase()).toContain('fewer commits');
      expect(message.toLowerCase()).toContain('fewer files');
      expect(message.indexOf('fewer commits')).toBeLessThan(message.indexOf('fewer files'));
      expect(message).toContain('truncatedFileCount');
      // The remainder is reported, never silently dropped.
      expect(message.toLowerCase()).toContain('never drop the remainder');
    });

    it('leaves a body under the limit alone (the 100kb control is unchanged)', async () => {
      const res = await request(app)
        .post(`/api/v1/projects/${projectId}/git-history/sync`)
        .set(auth)
        .send({ branches: [], commits: [] });

      // Now that the route is mounted (T028) an empty batch is a real, successful
      // no-op sync. Asserting the exact status rather than `not 413` is what makes
      // this a control: a 500 or a 404 fails it too.
      expect(res.status).toBe(200);
      expect(res.body.branchesUpserted).toBe(0);
      expect(res.body.commitsUpserted).toBe(0);
    });
  });

  describe('POST sync (US6, contracts/http-api.md section 4)', () => {
    // T015 / US6 scenario 1: a first sync records branches, commits, parent SHAs,
    // files and the reported ticket links against the project.
    it('records branches, commits, parentShas, files and reported ticket links (T015)', async () => {
      const ticketId = await newTicket(projectId, 'Draw the tree');

      const res = await sync({
        branches: [trunk, feature],
        commits: [
          validCommit({ sha: sha(1), branchName: 'main', parentShas: [] }),
          validCommit({
            sha: sha(2),
            branchName: feature.name,
            message: 'feat(backend): sync write path',
            authorName: 'juglarx',
            committedAt: '2026-08-21T19:00:00.000Z',
            parentShas: [sha(1)],
            files: [
              { path: 'backend/src/services/gitHistory.ts', changeType: 'A' },
              { path: 'backend/src/app.ts', changeType: 'M' },
            ],
            truncatedFileCount: 3,
            ticketIds: [ticketId],
          }),
        ],
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        branchesUpserted: 2,
        commitsUpserted: 2,
        filesUpserted: 3,
        ticketLinksUpserted: 1,
      });
      expect(typeof res.body.lastSyncedAt).toBe('string');

      const branches = await prisma.gitBranch.findMany({
        where: { projectId },
        orderBy: { name: 'asc' },
      });
      expect(branches.map((b) => b.name).sort()).toEqual([feature.name, 'main'].sort());
      const featureRow = branches.find((b) => b.name === feature.name)!;
      const trunkRow = branches.find((b) => b.name === 'main')!;
      expect(trunkRow.isTrunk).toBe(true);
      expect(trunkRow.forkedFromBranchName).toBeNull();
      expect(featureRow.isTrunk).toBe(false);
      expect(featureRow.forkedFromBranchName).toBe('main');
      expect(featureRow.state).toBe('ACTIVE');

      const second = await prisma.gitCommit.findFirst({ where: { projectId, sha: sha(2) } });
      expect(second).not.toBeNull();
      expect(second!.branchId).toBe(featureRow.id);
      expect(second!.parentShas).toEqual([sha(1)]);
      expect(second!.message).toBe('feat(backend): sync write path');
      expect(second!.authorName).toBe('juglarx');
      expect(second!.committedAt.toISOString()).toBe('2026-08-21T19:00:00.000Z');
      expect(second!.pushed).toBe(true);
      expect(second!.truncatedFileCount).toBe(3);

      const root = await prisma.gitCommit.findFirst({ where: { projectId, sha: sha(1) } });
      expect(root!.branchId).toBe(trunkRow.id);
      expect(root!.parentShas).toEqual([]);

      const files = await prisma.gitCommitFile.findMany({
        where: { commitId: second!.id },
        orderBy: { path: 'asc' },
      });
      expect(files.map((f) => [f.path, f.changeType])).toEqual([
        ['backend/src/app.ts', 'M'],
        ['backend/src/services/gitHistory.ts', 'A'],
      ]);

      const links = await prisma.gitCommitTicket.findMany({ where: { commitId: second!.id } });
      expect(links.map((l) => l.ticketId)).toEqual([ticketId]);
    });

    // T016 / FR-026, SC-010, US6 scenario 2: the identical batch twice.
    it('is idempotent: the same batch twice keeps the counts and creates no duplicates (T016)', async () => {
      const ticketId = await newTicket(projectId, 'Idempotent');
      const batch = {
        branches: [trunk, feature],
        commits: [
          validCommit({ sha: sha(1) }),
          validCommit({
            sha: sha(2),
            branchName: feature.name,
            parentShas: [sha(1)],
            files: [
              { path: 'a.ts', changeType: 'A' },
              { path: 'b.ts', changeType: 'M' },
            ],
            ticketIds: [ticketId],
          }),
        ],
      };

      const first = await sync(batch);
      expect(first.status).toBe(200);
      const countsAfterFirst = await gitRowCounts();

      const second = await sync(batch);
      expect(second.status).toBe(200);

      expect({
        branchesUpserted: second.body.branchesUpserted,
        commitsUpserted: second.body.commitsUpserted,
        filesUpserted: second.body.filesUpserted,
        ticketLinksUpserted: second.body.ticketLinksUpserted,
      }).toEqual({
        branchesUpserted: first.body.branchesUpserted,
        commitsUpserted: first.body.commitsUpserted,
        filesUpserted: first.body.filesUpserted,
        ticketLinksUpserted: first.body.ticketLinksUpserted,
      });
      expect(await gitRowCounts()).toEqual(countsAfterFirst);
      expect(countsAfterFirst).toEqual({ branches: 2, commits: 2, files: 3, ticketLinks: 1 });
    });

    // T017 / FR-024, D8, US6 scenario 6: attribution is fixed. The single most
    // important invariant of the write path.
    it('keeps a commit on its original branch when re-reported under another (T017)', async () => {
      await sync({
        branches: [trunk, feature],
        commits: [
          validCommit({
            sha: sha(7),
            branchName: feature.name,
            message: 'first message',
            authorName: 'first author',
            committedAt: '2026-08-20T10:00:00.000Z',
            pushed: false,
            isMerge: false,
            parentShas: [sha(1)],
            files: [{ path: 'a.ts', changeType: 'A' }],
            truncatedFileCount: 0,
          }),
        ],
      });
      const featureRow = await prisma.gitBranch.findFirst({
        where: { projectId, name: feature.name },
      });
      const before = await prisma.gitCommit.findFirst({ where: { projectId, sha: sha(7) } });
      expect(before!.branchId).toBe(featureRow!.id);

      // The branch has been merged and the same SHA is now reported on the trunk.
      const res = await sync({
        branches: [trunk, { ...feature, state: 'MERGED' }],
        commits: [
          validCommit({
            sha: sha(7),
            branchName: 'main',
            message: 'second message',
            authorName: 'second author',
            committedAt: '2026-08-21T11:30:00.000Z',
            pushed: true,
            isMerge: true,
            parentShas: [sha(1), sha(2)],
            files: [{ path: 'a.ts', changeType: 'M' }],
            truncatedFileCount: 4,
          }),
        ],
      });
      expect(res.status).toBe(200);

      const after = await prisma.gitCommit.findFirst({ where: { projectId, sha: sha(7) } });
      // Attribution is fixed: the commit does not move to the trunk lane.
      expect(after!.branchId).toBe(featureRow!.id);
      expect(after!.id).toBe(before!.id);
      // Every other field updates.
      expect(after!.message).toBe('second message');
      expect(after!.authorName).toBe('second author');
      expect(after!.committedAt.toISOString()).toBe('2026-08-21T11:30:00.000Z');
      expect(after!.pushed).toBe(true);
      expect(after!.isMerge).toBe(true);
      expect(after!.parentShas).toEqual([sha(1), sha(2)]);
      expect(after!.truncatedFileCount).toBe(4);
      const file = await prisma.gitCommitFile.findFirst({
        where: { commitId: after!.id, path: 'a.ts' },
      });
      expect(file!.changeType).toBe('M');
      // And exactly one commit row for the SHA -- no duplicate under the trunk.
      expect(await prisma.gitCommit.count({ where: { projectId, sha: sha(7) } })).toBe(1);
    });

    // The counterpart of the T017 test above, and the same defect class as
    // `rejects a re-report that omits isTrunk...` below. Rule 3 updates every
    // field but branchId on a re-report, so if parentShas defaulted to [], a
    // re-report that simply left it out would erase the commit's topology --
    // and FR-007 draws every fork and merge edge from that field alone, so the
    // tree would silently lose the merge with a 200 and no diagnostic.
    it('rejects a re-report that omits parentShas instead of erasing the recorded parents', async () => {
      await sync({
        branches: [trunk],
        commits: [
          validCommit({
            sha: sha(7),
            branchName: 'main',
            isMerge: true,
            parentShas: [sha(1), sha(2)],
          }),
        ],
      });
      const before = await prisma.gitCommit.findFirst({ where: { projectId, sha: sha(7) } });
      expect(before!.parentShas).toEqual([sha(1), sha(2)]);

      const res = await sync({
        branches: [trunk],
        commits: [
          omit(
            validCommit({ sha: sha(7), branchName: 'main', isMerge: true, message: 'reworded' }),
            'parentShas',
          ),
        ],
      });

      // The data assertion leads deliberately: a regression to a defaulted []
      // must report the ERASURE, not merely a status mismatch.
      const after = await prisma.gitCommit.findFirst({ where: { projectId, sha: sha(7) } });
      expect(after!.parentShas).toEqual([sha(1), sha(2)]);
      // Nothing else of the rejected batch was written either.
      expect(after!.message).toBe('chore: initial commit');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
      expect(String(res.body.error.message)).toContain('parentShas');
    });

    // Same shape, for the honesty field: a defaulted 0 would silently upgrade a
    // known-incomplete file list to "complete" (FR-017, rule 2).
    it('rejects a re-report that omits truncatedFileCount instead of resetting it to 0', async () => {
      await sync({
        branches: [trunk],
        commits: [
          validCommit({ sha: sha(7), branchName: 'main', truncatedFileCount: 12 }),
        ],
      });
      const before = await prisma.gitCommit.findFirst({ where: { projectId, sha: sha(7) } });
      expect(before!.truncatedFileCount).toBe(12);

      const res = await sync({
        branches: [trunk],
        commits: [
          omit(
            validCommit({ sha: sha(7), branchName: 'main', message: 'reworded' }),
            'truncatedFileCount',
          ),
        ],
      });

      const after = await prisma.gitCommit.findFirst({ where: { projectId, sha: sha(7) } });
      expect(after!.truncatedFileCount).toBe(12);
      expect(after!.message).toBe('chore: initial commit');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
      expect(String(res.body.error.message)).toContain('truncatedFileCount');
    });

    // T018 / FR-032, SC-011, US6 scenario 7: additive only.
    it('leaves a branch absent from a later batch, and its lastSyncedAt, untouched (T018)', async () => {
      const ticketId = await newTicket(projectId, 'Survivor');
      await sync({
        branches: [trunk, feature],
        commits: [
          validCommit({
            sha: sha(3),
            branchName: feature.name,
            files: [{ path: 'gone.ts', changeType: 'A' }],
            ticketIds: [ticketId],
          }),
        ],
      });
      const featureBefore = await prisma.gitBranch.findFirst({
        where: { projectId, name: feature.name },
      });
      expect(featureBefore).not.toBeNull();

      // A measurable gap, so an accidental re-stamp of lastSyncedAt is visible.
      await new Promise((resolve) => setTimeout(resolve, 25));

      // The feature branch is gone from the repository: it is simply not in this batch.
      const res = await sync({
        branches: [trunk],
        commits: [validCommit({ sha: sha(4), branchName: 'main', parentShas: [sha(1)] })],
      });
      expect(res.status).toBe(200);

      const featureAfter = await prisma.gitBranch.findFirst({
        where: { projectId, name: feature.name },
      });
      expect(featureAfter).not.toBeNull();
      expect(featureAfter!.id).toBe(featureBefore!.id);
      expect(featureAfter!.state).toBe(featureBefore!.state);
      expect(featureAfter!.isTrunk).toBe(featureBefore!.isTrunk);
      expect(featureAfter!.forkedFromBranchName).toBe(featureBefore!.forkedFromBranchName);
      expect(featureAfter!.lastSyncedAt.toISOString()).toBe(
        featureBefore!.lastSyncedAt.toISOString(),
      );

      // Its commit, that commit's file and its ticket link all survive.
      const survivor = await prisma.gitCommit.findFirst({ where: { projectId, sha: sha(3) } });
      expect(survivor!.branchId).toBe(featureBefore!.id);
      expect(await prisma.gitCommitFile.count({ where: { commitId: survivor!.id } })).toBe(1);
      expect(await prisma.gitCommitTicket.count({ where: { commitId: survivor!.id } })).toBe(1);

      // The trunk, which IS in the batch, was re-stamped by the server clock.
      const trunkAfter = await prisma.gitBranch.findFirst({ where: { projectId, name: 'main' } });
      expect(trunkAfter!.lastSyncedAt.getTime()).toBeGreaterThan(
        featureBefore!.lastSyncedAt.getTime(),
      );
    });

    // Rule 7, positive half: a commit may name a branch recorded by an earlier
    // batch. Only an INVENTED branch is rejected.
    it('accepts a commit naming a branch recorded by an earlier batch', async () => {
      await sync({ branches: [trunk, feature], commits: [] });
      const featureRow = await prisma.gitBranch.findFirst({
        where: { projectId, name: feature.name },
      });

      const res = await sync({
        branches: [],
        commits: [validCommit({ sha: sha(9), branchName: feature.name })],
      });

      expect(res.status).toBe(200);
      const commit = await prisma.gitCommit.findFirst({ where: { projectId, sha: sha(9) } });
      expect(commit!.branchId).toBe(featureRow!.id);
    });

    // T019 / FR-023, contract section 4 rules 5-6: the caps are rejections, never
    // silent trims.
    describe('batch and file caps (T019)', () => {
      it('rejects 51 commits in one batch with 400 VALIDATION', async () => {
        const commits = Array.from({ length: 51 }, (_, i) => validCommit({ sha: sha(i + 1) }));
        const res = await sync({ branches: [trunk], commits });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION');
        expect(String(res.body.error.message)).toContain('commits');
        expect(String(res.body.error.message)).toContain('50');
        // Not trimmed silently: nothing at all was recorded.
        expect(await gitRowCounts()).toEqual({
          branches: 0,
          commits: 0,
          files: 0,
          ticketLinks: 0,
        });
      });

      it('accepts exactly 50 commits (the cap is inclusive)', async () => {
        const commits = Array.from({ length: 50 }, (_, i) =>
          validCommit({ sha: sha(i + 1), files: [] }),
        );
        const res = await sync({ branches: [trunk], commits });
        expect(res.status).toBe(200);
        expect(res.body.commitsUpserted).toBe(50);
      });

      it('rejects 501 files on one commit with 400 VALIDATION', async () => {
        const files = Array.from({ length: 501 }, (_, i) => ({
          path: `src/file-${i}.ts`,
          changeType: 'M',
        }));
        const res = await sync({
          branches: [trunk],
          commits: [validCommit({ files, truncatedFileCount: 0 })],
        });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION');
        expect(String(res.body.error.message)).toContain('files');
        expect(String(res.body.error.message)).toContain('500');
        expect(await gitRowCounts()).toEqual({
          branches: 0,
          commits: 0,
          files: 0,
          ticketLinks: 0,
        });
      });

      it('accepts exactly 500 files with the remainder in truncatedFileCount', async () => {
        const files = Array.from({ length: 500 }, (_, i) => ({
          path: `src/file-${i}.ts`,
          changeType: 'M',
        }));
        const res = await sync({
          branches: [trunk],
          commits: [validCommit({ files, truncatedFileCount: 7 })],
        });

        expect(res.status).toBe(200);
        expect(res.body.filesUpserted).toBe(500);
        const commit = await prisma.gitCommit.findFirst({ where: { projectId, sha: sha(1) } });
        expect(commit!.truncatedFileCount).toBe(7);
      });
    });

    // T020 / contract section 4 rule 7: every rejection names the offending field.
    describe('field validation (T020)', () => {
      const cases: Array<{ label: string; body: () => unknown; field: string }> = [
        {
          label: 'a bad state',
          body: () => ({ branches: [{ ...trunk, state: 'DIRTY' }], commits: [] }),
          field: 'state',
        },
        {
          label: 'a bad changeType',
          body: () => ({
            branches: [trunk],
            commits: [validCommit({ files: [{ path: 'a.ts', changeType: 'X' }] })],
          }),
          field: 'changeType',
        },
        {
          label: 'a malformed sha',
          body: () => ({ branches: [trunk], commits: [validCommit({ sha: 'NOTAHEXSHA' })] }),
          field: 'sha',
        },
        {
          label: 'an uppercase sha (40 hex characters, wrong case)',
          body: () => ({
            branches: [trunk],
            commits: [validCommit({ sha: 'ABCDEF'.repeat(6) + 'abcd' })],
          }),
          field: 'sha',
        },
        {
          label: 'an unparseable committedAt',
          body: () => ({ branches: [trunk], commits: [validCommit({ committedAt: 'yesterday' })] }),
          field: 'committedAt',
        },
        {
          label: 'a branchName naming neither a batch branch nor a recorded one',
          body: () => ({ branches: [trunk], commits: [validCommit({ branchName: 'invented' })] }),
          field: 'branchName',
        },
        // The three booleans are REQUIRED, not defaulted. Defaulting an omitted
        // isTrunk to false would let a re-report of a branch silently demote the
        // trunk (rule 9) and an omitted isMerge would drop a merge edge (FR-007),
        // both with a 200 and no diagnostic.
        {
          label: 'a branch with isTrunk omitted',
          body: () => ({ branches: [omit(trunk, 'isTrunk')], commits: [] }),
          field: 'isTrunk',
        },
        {
          label: 'a commit with pushed omitted',
          body: () => ({ branches: [trunk], commits: [omit(validCommit(), 'pushed')] }),
          field: 'pushed',
        },
        {
          label: 'a commit with isMerge omitted',
          body: () => ({ branches: [trunk], commits: [omit(validCommit(), 'isMerge')] }),
          field: 'isMerge',
        },
        // parentShas and truncatedFileCount are REQUIRED for the same reason,
        // and for the same defect class. Rule 3 updates every field but
        // branchId on a re-report, so an omitted parentShas would overwrite the
        // recorded parents with [] -- and FR-007 derives every fork and merge
        // edge from that field alone. An omitted truncatedFileCount defaulting
        // to 0 would silently assert "this file list is complete", which is
        // exactly the false claim FR-017 and rule 2 exist to prevent. `files`
        // is deliberately NOT here: sync is additive and never deletes (rule 2
        // / FR-032), so an absent files array adds nothing and destroys
        // nothing, and rejecting it would refuse the legitimate "no files
        // recorded for this commit" report.
        {
          label: 'a commit with parentShas omitted',
          body: () => ({ branches: [trunk], commits: [omit(validCommit(), 'parentShas')] }),
          field: 'parentShas',
        },
        {
          label: 'a commit with truncatedFileCount omitted',
          body: () => ({
            branches: [trunk],
            commits: [omit(validCommit(), 'truncatedFileCount')],
          }),
          field: 'truncatedFileCount',
        },
      ];

      for (const testCase of cases) {
        it(`rejects ${testCase.label} with 400 VALIDATION naming the field`, async () => {
          const res = await sync(testCase.body());

          expect(res.status).toBe(400);
          expect(res.body.error.code).toBe('VALIDATION');
          expect(String(res.body.error.message)).toContain(testCase.field);
          expect(await gitRowCounts()).toEqual({
            branches: 0,
            commits: 0,
            files: 0,
            ticketLinks: 0,
          });
        });
      }
    });

    // T021 / contract section 4 rule 8, constitution Principle IV.
    it('rejects a ticketIds entry belonging to another project, naming the id (T021)', async () => {
      const otherProjectId = await newProject('Other');
      const foreignTicketId = await newTicket(otherProjectId, 'Not ours');

      const res = await sync({
        branches: [trunk],
        commits: [validCommit({ ticketIds: [foreignTicketId] })],
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
      expect(String(res.body.error.message)).toContain(foreignTicketId);
      // Not skipped silently: the commit itself was not recorded either.
      expect(await prisma.gitCommit.count({ where: { projectId } })).toBe(0);
      expect(await prisma.gitCommitTicket.count()).toBe(0);
    });

    it('rejects a ticketIds entry that does not exist at all, naming the id (T021)', async () => {
      const res = await sync({
        branches: [trunk],
        commits: [validCommit({ ticketIds: ['00000000-0000-4000-8000-000000000000'] })],
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
      expect(String(res.body.error.message)).toContain('00000000-0000-4000-8000-000000000000');
    });

    // T022 / contract section 4 rule 9.
    describe('trunk uniqueness (T022)', () => {
      it('rejects two isTrunk branches in one batch', async () => {
        const res = await sync({ branches: [trunk, { ...feature, isTrunk: true }], commits: [] });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION');
        expect(String(res.body.error.message)).toContain('isTrunk');
        expect(await prisma.gitBranch.count({ where: { projectId } })).toBe(0);
      });

      it('rejects a second trunk when a different branch is already recorded as trunk', async () => {
        await sync({ branches: [trunk], commits: [] });

        const res = await sync({ branches: [{ ...feature, isTrunk: true }], commits: [] });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION');
        expect(String(res.body.error.message)).toContain('isTrunk');
        // The recorded trunk is untouched and the rejected branch was not created.
        expect(await prisma.gitBranch.count({ where: { projectId } })).toBe(1);
        const only = await prisma.gitBranch.findFirst({ where: { projectId } });
        expect(only!.name).toBe('main');
        expect(only!.isTrunk).toBe(true);
      });

      // Rule 9's silent-demotion hole: an agent re-reporting the trunk without
      // isTrunk must be told, not obeyed. If isTrunk were defaulted to false the
      // upsert would write that false over the stored row and leave the project
      // with NO trunk, answering 200 with no diagnostic.
      it('rejects a re-report that omits isTrunk instead of silently demoting the trunk', async () => {
        await sync({ branches: [trunk], commits: [] });

        const res = await sync({ branches: [{ name: 'main', state: 'ACTIVE' }], commits: [] });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION');
        expect(String(res.body.error.message)).toContain('isTrunk');
        const stored = await prisma.gitBranch.findFirst({ where: { projectId, name: 'main' } });
        expect(stored!.isTrunk).toBe(true);
        expect(await prisma.gitBranch.count({ where: { projectId, isTrunk: true } })).toBe(1);
      });

      it('accepts the SAME branch being re-reported as trunk', async () => {
        await sync({ branches: [trunk], commits: [] });

        const res = await sync({ branches: [{ ...trunk, state: 'MERGED' }], commits: [] });

        expect(res.status).toBe(200);
        const only = await prisma.gitBranch.findFirst({ where: { projectId, name: 'main' } });
        expect(only!.isTrunk).toBe(true);
        expect(only!.state).toBe('MERGED');
      });
    });

    // T023 / contract section 4 rule 4: a mirror that can be told it is fresh is
    // not a mirror.
    it('sets lastSyncedAt from the server clock and ignores a client-supplied one (T023)', async () => {
      const before = Date.now();
      const res = await sync({
        // The client-supplied timestamps below are the lie the server must ignore.
        // Unknown/extra properties are ignored rather than rejected.
        lastSyncedAt: '1999-01-01T00:00:00.000Z',
        branches: [{ ...trunk, lastSyncedAt: '1999-01-01T00:00:00.000Z' }],
        commits: [validCommit()],
      });
      const after = Date.now();

      expect(res.status).toBe(200);
      const stored = await prisma.gitBranch.findFirst({ where: { projectId, name: 'main' } });
      expect(stored!.lastSyncedAt.getFullYear()).not.toBe(1999);
      expect(stored!.lastSyncedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(stored!.lastSyncedAt.getTime()).toBeLessThanOrEqual(after);
      // The envelope reports the same server-clock value it stored.
      expect(new Date(res.body.lastSyncedAt).getTime()).toBe(stored!.lastSyncedAt.getTime());
    });

    // T024 / contract section 4 rule 11, US6 scenario 8: one transaction.
    it('records nothing at all when any part of the batch is invalid (T024)', async () => {
      const ticketId = await newTicket(projectId, 'Atomic');

      const res = await sync({
        branches: [trunk, feature],
        commits: [
          // NOTE: this is a SHAPE failure (`committedAt`), which parseBatch
          // rejects before the transaction is even opened -- so this case proves
          // the batch is all-or-nothing at the shape gate, NOT that a rollback
          // works. The rollback itself is exercised by the DB-dependent case
          // below, which fails after rows have already been written.
          validCommit({
            sha: sha(1),
            files: [{ path: 'good.ts', changeType: 'A' }],
            ticketIds: [ticketId],
          }),
          validCommit({ sha: sha(2), branchName: feature.name, committedAt: 'not a date' }),
        ],
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
      expect(await gitRowCounts()).toEqual({ branches: 0, commits: 0, files: 0, ticketLinks: 0 });
    });

    it('leaves an earlier successful sync intact when a later batch fails (T024)', async () => {
      await sync({ branches: [trunk], commits: [validCommit({ sha: sha(1) })] });
      const before = await gitRowCounts();

      const res = await sync({
        branches: [feature],
        commits: [validCommit({ sha: 'not-a-sha', branchName: feature.name })],
      });

      expect(res.status).toBe(400);
      expect(await gitRowCounts()).toEqual(before);
    });

    // T024, the case that actually exercises ROLLBACK. The rejection here is
    // DB-dependent (rule 8: is this ticket id one of the project's?) and it fires
    // inside the commit write loop, so by the time it throws the transaction has
    // already written both branches, the first commit, its file and its ticket
    // link. Only the transaction can take those back: remove the
    // `prisma.$transaction` wrapper in services/gitHistory.ts and this case fails
    // on non-zero counts.
    it('rolls back rows already written when a later commit names a foreign ticket (T024)', async () => {
      const ourTicketId = await newTicket(projectId, 'Ours');
      const otherProjectId = await newProject('Other');
      const foreignTicketId = await newTicket(otherProjectId, 'Not ours');

      const res = await sync({
        branches: [trunk, feature],
        commits: [
          // Entirely valid and written first: a branch row, a commit row, a file
          // row and a ticket link all exist inside the transaction before the
          // rejection below is reached.
          validCommit({
            sha: sha(1),
            files: [{ path: 'good.ts', changeType: 'A' }],
            ticketIds: [ourTicketId],
          }),
          validCommit({
            sha: sha(2),
            branchName: feature.name,
            files: [{ path: 'also-good.ts', changeType: 'A' }],
            ticketIds: [foreignTicketId],
          }),
        ],
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
      expect(String(res.body.error.message)).toContain(foreignTicketId);
      // Nothing survives -- not the branches, not the valid first commit, not its
      // file, not its ticket link.
      expect(await gitRowCounts()).toEqual({ branches: 0, commits: 0, files: 0, ticketLinks: 0 });
    });

    // T025 / contract section 4 rule 12.
    it('returns 404 NOT_FOUND for an unknown projectId (T025)', async () => {
      const res = await sync(
        { branches: [trunk], commits: [] },
        '11111111-1111-4111-8111-111111111111',
      );

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(await prisma.gitBranch.count()).toBe(0);
    });
  });

  // T039 / US1, contracts/http-api.md section 1: the read endpoint that feeds the
  // tree drawing. Everything the tree needs (branches, commits, counts) and
  // nothing else (no file lists -- research R12).
  describe('GET / (US1, contracts/http-api.md section 1)', () => {
    // Rule 2: the never-synced shape is a 200, not a 404. An existing project
    // with zero GitBranch rows must be distinguishable from an unknown project
    // (rule 5) and from a transport failure (FR-033) -- so this is asserted on
    // its own, before any sync has ever happened for this project.
    it('answers 200 with the never-synced shape for a project that has never been synced', async () => {
      const res = await list();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ lastSyncedAt: null, branches: [], commits: [] });
    });

    // Rule 5, other half: unknown projectId is the 404, so the never-synced 200
    // above cannot be mistaken for "any id gets a 200".
    it('returns 404 NOT_FOUND for an unknown projectId (T039)', async () => {
      const res = await list('11111111-1111-4111-8111-111111111111');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('carries lastSyncedAt, branches and commits with exactly the contracted fields', async () => {
      await sync({
        branches: [trunk],
        commits: [validCommit({ sha: sha(1) })],
      });

      const res = await list();
      expect(res.status).toBe(200);
      expect(res.body.branches).toHaveLength(1);
      expect(res.body.commits).toHaveLength(1);

      // Per-branch fields are exactly: id, name, isTrunk, forkedFromBranchName,
      // state, lastSyncedAt.
      expect(Object.keys(res.body.branches[0]).sort()).toEqual(
        ['id', 'name', 'isTrunk', 'forkedFromBranchName', 'state', 'lastSyncedAt'].sort(),
      );
      // Per-commit fields are exactly: sha, branchId, message, authorName,
      // committedAt, pushed, isMerge, parentShas, fileCount, truncatedFileCount.
      expect(Object.keys(res.body.commits[0]).sort()).toEqual(
        [
          'sha',
          'branchId',
          'message',
          'authorName',
          'committedAt',
          'pushed',
          'isMerge',
          'parentShas',
          'fileCount',
          'truncatedFileCount',
        ].sort(),
      );
      // Negative assertion (contract section 1, "no file lists"): a response
      // that leaked a `files` array on a commit must fail this test.
      expect(res.body.commits[0].files).toBeUndefined();
    });

    // Rule 4: fileCount is the number of STORED file rows; fileCount +
    // truncatedFileCount is the real total. No file paths travel in this payload.
    it('reports fileCount as the stored row count and truncatedFileCount as the honest remainder', async () => {
      await sync({
        branches: [trunk],
        commits: [
          validCommit({
            sha: sha(1),
            files: [
              { path: 'a.ts', changeType: 'A' },
              { path: 'b.ts', changeType: 'M' },
            ],
            truncatedFileCount: 3,
          }),
        ],
      });

      const res = await list();
      expect(res.status).toBe(200);
      const commit = res.body.commits.find((c: { sha: string }) => c.sha === sha(1));
      expect(commit.fileCount).toBe(2);
      expect(commit.truncatedFileCount).toBe(3);
      expect(commit.files).toBeUndefined();
    });

    // Rule 1: lastSyncedAt is the MAXIMUM across the project's branches, not the
    // first, not the trunk's, not an arbitrary one. Two separate syncs, so the
    // two branches genuinely differ, prove the endpoint actually takes a max
    // rather than e.g. always reporting the trunk's or the first-synced branch's.
    it('derives lastSyncedAt as the maximum across the project branches', async () => {
      const first = await sync({ branches: [trunk], commits: [] });
      await new Promise((resolve) => setTimeout(resolve, 25));
      const second = await sync({ branches: [feature], commits: [] });

      expect(new Date(second.body.lastSyncedAt).getTime()).toBeGreaterThan(
        new Date(first.body.lastSyncedAt).getTime(),
      );

      const res = await list();
      expect(res.status).toBe(200);
      expect(res.body.lastSyncedAt).toBe(second.body.lastSyncedAt);
      // Sanity: the reported max really is the max of the two branch rows, not
      // coincidentally equal to only one of them by construction.
      const trunkRow = res.body.branches.find((b: { name: string }) => b.name === trunk.name);
      const featureRow = res.body.branches.find((b: { name: string }) => b.name === feature.name);
      expect(trunkRow.lastSyncedAt).toBe(first.body.lastSyncedAt);
      expect(featureRow.lastSyncedAt).toBe(second.body.lastSyncedAt);
      expect(res.body.lastSyncedAt).toBe(
        [trunkRow.lastSyncedAt, featureRow.lastSyncedAt].sort().slice(-1)[0],
      );
    });

    // Rule 3: commits ordered by committedAt ascending, ties broken by sha
    // ascending. Without the tie-break two commits sharing a second would swap
    // between runs and the geometry function's output would not be assertable
    // (research R11) -- so the tie is tested explicitly, not just the general
    // chronological order.
    it('orders commits by committedAt ascending, ties broken by sha ascending', async () => {
      const tiedTimestamp = '2026-08-21T19:00:00.000Z';
      await sync({
        branches: [trunk],
        commits: [
          validCommit({ sha: sha(1), committedAt: '2026-08-21T18:00:00.000Z' }),
          // Two commits with the IDENTICAL committedAt and different shas, sent
          // in descending-sha order so a passing test cannot be an accident of
          // insertion order.
          validCommit({ sha: sha(9), committedAt: tiedTimestamp }),
          validCommit({ sha: sha(3), committedAt: tiedTimestamp }),
        ],
      });

      const res = await list();
      expect(res.status).toBe(200);
      expect(res.body.commits.map((c: { sha: string }) => c.sha)).toEqual([
        sha(1),
        sha(3),
        sha(9),
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // T050 / T055 / T060 -- the remaining read endpoints, plus the never-synced
  // regression. Shared fixtures for all three live here, at the body level of
  // the outer describe, so the nested blocks below can use them.
  // -------------------------------------------------------------------------

  const commitDetailUrl = (id: string, s: string) =>
    `/api/v1/projects/${id}/git-history/commits/${s}`;
  const branchDetailUrl = (id: string, bid: string) =>
    `/api/v1/projects/${id}/git-history/branches/${bid}`;

  function commitDetail(s: string, id: string = projectId) {
    return request(app).get(commitDetailUrl(id, s)).set(auth);
  }

  function branchDetail(bid: string, id: string = projectId) {
    return request(app).get(branchDetailUrl(id, bid)).set(auth);
  }

  /** A ticket carrying a reported `gitBranch` (or none). `branch` is the
   * STORED value the inference in contract section 2 rule 3 matches on. */
  async function newTicketOn(branch: string | null, name: string, pid: string = projectId) {
    const res = await request(app)
      .post(`/api/v1/projects/${pid}/tickets`)
      .set(auth)
      .send({ name, complexity: 1, branch });
    return res.body as { id: string; number: number; name: string };
  }

  /** The id the sync gave a branch, read back through the tree endpoint --
   * contract section 3 keys on the id, not the name (research R12). */
  async function branchIdOf(name: string, pid: string = projectId) {
    const res = await list(pid);
    const branch = res.body.branches.find((b: { name: string }) => b.name === name);
    return branch.id as string;
  }

  type TicketRef = { id: string; number: number; name: string; source: string };
  const sourceOf = (tickets: TicketRef[], id: string) => tickets.find((t) => t.id === id)?.source;

  /** FR-025/D9, contract section 2 rule 4: the machine-readable half of "an
   * inference is never presented as reported data". Applied to EVERY response
   * that carries tickets, not only to the ones a test is about. */
  function expectEveryTicketCarriesASource(tickets: TicketRef[]) {
    for (const ticket of tickets) {
      expect(Object.keys(ticket).sort()).toEqual(['id', 'name', 'number', 'source']);
      expect(['reported', 'inferred']).toContain(ticket.source);
    }
  }

  // T050 / US3, contracts/http-api.md section 2: one commit's files and tickets.
  describe('GET /commits/:sha (US3, contracts/http-api.md section 2)', () => {
    // Rule 5.
    it('returns 404 NOT_FOUND for a sha that is not recorded for this project (T050)', async () => {
      await sync({ branches: [trunk], commits: [validCommit({ sha: sha(1) })] });

      const res = await commitDetail(sha(999));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    // Rule 5, sharper: single-tenant means no ownership check (FR-030), but a
    // commit is still scoped to its project -- a sha recorded elsewhere is
    // unknown HERE, and must not leak across projects.
    it('returns 404 for a sha recorded on a different project (T050)', async () => {
      const otherId = await newProject('Other');
      await request(app)
        .post(syncUrl(otherId))
        .set(auth)
        .send({ branches: [trunk], commits: [validCommit({ sha: sha(7) })] });

      const res = await commitDetail(sha(7));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('carries exactly the contracted fields (T050)', async () => {
      await sync({
        branches: [trunk, feature],
        commits: [
          validCommit({
            sha: sha(1),
            branchName: feature.name,
            message: 'feat: something',
            parentShas: [sha(2)],
            isMerge: true,
            pushed: false,
          }),
        ],
      });

      const res = await commitDetail(sha(1));
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(
        [
          'sha',
          'branchId',
          'branchName',
          'message',
          'authorName',
          'committedAt',
          'pushed',
          'isMerge',
          'parentShas',
          'files',
          'truncatedFileCount',
          'tickets',
        ].sort(),
      );
      expect(res.body.sha).toBe(sha(1));
      expect(res.body.branchName).toBe(feature.name);
      expect(res.body.branchId).toBe(await branchIdOf(feature.name));
      expect(res.body.message).toBe('feat: something');
      expect(res.body.authorName).toBe('juglarx');
      expect(res.body.parentShas).toEqual([sha(2)]);
      expect(res.body.isMerge).toBe(true);
      expect(res.body.pushed).toBe(false);
      expect(res.body.files).toEqual([{ path: 'README.md', changeType: 'A' }]);
    });

    // Rule 1, and the Phase 3 review finding behind it: the READ path caps at
    // 500, because the write path's cap is per BATCH and sync never deletes
    // (rule 2 / FR-032). Re-reporting one sha with a different set of 500 paths
    // leaves 1000 rows on that commit, so a read that trusted the write path
    // would return 1000 and break rule 1. The two batches use path prefixes
    // that interleave under an ascending sort ("a/..." sorts before "b/..."
    // although it was written second), so a response that returned insertion
    // order, or the first 500 rows as stored, fails this test.
    it('orders files by path ascending and caps them at 500 on read (T050)', async () => {
      const paths = (prefix: string) =>
        Array.from({ length: 500 }, (_, i) => ({
          path: `${prefix}/${i.toString().padStart(3, '0')}.ts`,
          changeType: 'A',
        }));

      await sync({
        branches: [trunk],
        commits: [validCommit({ sha: sha(1), files: paths('b') })],
      });
      await sync({
        branches: [trunk],
        commits: [validCommit({ sha: sha(1), files: paths('a') })],
      });

      // 1000 rows really are stored: sync is additive and deletes nothing.
      expect(await prisma.gitCommitFile.count()).toBe(1000);

      const res = await commitDetail(sha(1));
      expect(res.status).toBe(200);
      expect(res.body.files).toHaveLength(500);
      expect(res.body.files.map((f: { path: string }) => f.path)).toEqual(
        paths('a').map((f) => f.path),
      );
      const returned = res.body.files.map((f: { path: string }) => f.path);
      expect(returned).toEqual([...returned].sort());
    });

    // Rule 2: truncatedFileCount comes from the commit row and is reported
    // unchanged -- the read-side cap above does not re-write it.
    it('reports truncatedFileCount from the commit row (T050)', async () => {
      await sync({
        branches: [trunk],
        commits: [
          validCommit({
            sha: sha(1),
            files: [{ path: 'b.ts', changeType: 'M' }],
            truncatedFileCount: 7,
          }),
        ],
      });

      const res = await commitDetail(sha(1));
      expect(res.status).toBe(200);
      expect(res.body.truncatedFileCount).toBe(7);
      expect(res.body.files).toEqual([{ path: 'b.ts', changeType: 'M' }]);
    });

    // Rule 3, first clause: when the commit has at least one reported link,
    // `tickets` is EXACTLY those links, every one "reported". Inference is not
    // mixed in -- so the branch-matching ticket that is not linked must be
    // absent, which is what stops a guess being dressed up as a fact (D9).
    it('returns every reported link as source "reported" and mixes in no inference (T050)', async () => {
      const linked = await newTicketOn(null, 'Linked by the agent');
      const branchMatched = await newTicketOn(feature.name, 'Merely on the same branch');

      await sync({
        branches: [trunk, feature],
        commits: [
          validCommit({ sha: sha(1), branchName: feature.name, ticketIds: [linked.id] }),
        ],
      });

      const res = await commitDetail(sha(1));
      expect(res.status).toBe(200);
      expectEveryTicketCarriesASource(res.body.tickets);
      expect(res.body.tickets).toHaveLength(1);
      expect(res.body.tickets[0]).toEqual({
        id: linked.id,
        number: linked.number,
        name: 'Linked by the agent',
        source: 'reported',
      });
      expect(sourceOf(res.body.tickets, branchMatched.id)).toBeUndefined();
    });

    // Rule 3, second clause: with no reported link, `tickets` is the project's
    // tickets whose gitBranch equals the commit's BRANCH NAME, every one
    // "inferred" (research R6 -- derived at read time, never stored).
    it('returns branch-matched tickets as source "inferred" when nothing was reported (T050)', async () => {
      const onBranch = await newTicketOn(feature.name, 'On the feature branch');
      const alsoOnBranch = await newTicketOn(feature.name, 'Also on the feature branch');
      const elsewhere = await newTicketOn('main', 'On another branch');
      const unbranched = await newTicketOn(null, 'No branch reported');

      await sync({
        branches: [trunk, feature],
        commits: [validCommit({ sha: sha(1), branchName: feature.name, ticketIds: [] })],
      });

      const res = await commitDetail(sha(1));
      expect(res.status).toBe(200);
      expectEveryTicketCarriesASource(res.body.tickets);
      expect(res.body.tickets.map((t: TicketRef) => t.id).sort()).toEqual(
        [onBranch.id, alsoOnBranch.id].sort(),
      );
      expect(sourceOf(res.body.tickets, onBranch.id)).toBe('inferred');
      expect(sourceOf(res.body.tickets, alsoOnBranch.id)).toBe('inferred');
      expect(sourceOf(res.body.tickets, elsewhere.id)).toBeUndefined();
      expect(sourceOf(res.body.tickets, unbranched.id)).toBeUndefined();

      // Nothing inferred is written: the link table still holds only what the
      // agent reported, which here is nothing (research R6, schema note).
      expect(await prisma.gitCommitTicket.count()).toBe(0);
    });

    // Rule 3, third clause.
    it('returns tickets: [] with neither a reported link nor a branch match (T050)', async () => {
      await newTicketOn('some-other-branch', 'Unrelated');

      await sync({
        branches: [trunk, feature],
        commits: [validCommit({ sha: sha(1), branchName: feature.name, ticketIds: [] })],
      });

      const res = await commitDetail(sha(1));
      expect(res.status).toBe(200);
      expect(res.body.tickets).toEqual([]);
    });

    // Rule 4, stated on its own: no response ever carries a ticket without a
    // source, whichever clause of rule 3 produced it.
    it('never returns a ticket without a source, reported or inferred (T050)', async () => {
      const linked = await newTicketOn(feature.name, 'Linked');
      await newTicketOn(feature.name, 'Inferred only');

      await sync({
        branches: [trunk, feature],
        commits: [
          validCommit({ sha: sha(1), branchName: feature.name, ticketIds: [linked.id] }),
          validCommit({ sha: sha(2), branchName: feature.name, ticketIds: [] }),
        ],
      });

      for (const s of [sha(1), sha(2)]) {
        const res = await commitDetail(s);
        expect(res.status).toBe(200);
        expect(res.body.tickets.length).toBeGreaterThan(0);
        expectEveryTicketCarriesASource(res.body.tickets);
      }
    });
  });

  // T055 / US4, contracts/http-api.md section 3: one branch's aggregate. Keyed
  // on branchId, not name, because branch names contain "/" (research R12).
  describe('GET /branches/:branchId (US4, contracts/http-api.md section 3)', () => {
    // Rule 6, both halves.
    it('returns 404 NOT_FOUND for an unknown branchId (T055)', async () => {
      await sync({ branches: [trunk], commits: [] });

      const res = await branchDetail('11111111-1111-4111-8111-111111111111');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 for a branch belonging to another project (T055)', async () => {
      const otherId = await newProject('Other');
      await request(app)
        .post(syncUrl(otherId))
        .set(auth)
        .send({ branches: [feature], commits: [] });
      const foreignBranchId = await branchIdOf(feature.name, otherId);

      const res = await branchDetail(foreignBranchId);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');

      // It is a real branch, reachable under its OWN project -- so the 404
      // above is the project scoping and not a broken lookup.
      const own = await branchDetail(foreignBranchId, otherId);
      expect(own.status).toBe(200);
    });

    it('carries exactly the contracted fields (T055)', async () => {
      const synced = await sync({
        branches: [trunk, { ...feature, state: 'MERGED' }],
        commits: [validCommit({ sha: sha(1), branchName: feature.name })],
      });

      const res = await branchDetail(await branchIdOf(feature.name));
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(
        [
          'id',
          'name',
          'isTrunk',
          'state',
          'forkedFromBranchName',
          'lastSyncedAt',
          'commitCount',
          'commitMessages',
          'files',
          'truncatedFileCount',
          'tickets',
        ].sort(),
      );
      expect(res.body.name).toBe(feature.name);
      expect(res.body.isTrunk).toBe(false);
      expect(res.body.state).toBe('MERGED');
      expect(res.body.forkedFromBranchName).toBe('main');
      expect(res.body.lastSyncedAt).toBe(synced.body.lastSyncedAt);
      // Rule 4/FR-015: the description is composed BY THE CLIENT from name,
      // state and commitMessages. No authored description exists here or in the
      // database, so a `description` field in this payload is a defect.
      expect(res.body.description).toBeUndefined();
    });

    // Rule 1: the distinct union, ordered by path ascending, with the MOST
    // RECENT commit's change type winning. `shared.ts` is added by the older
    // commit and modified by the newer one, so a union that took the first
    // occurrence would report "A" and fail.
    it('returns the distinct union of files ordered by path, newest change type winning (T055)', async () => {
      await sync({
        branches: [trunk, feature],
        commits: [
          validCommit({
            sha: sha(1),
            branchName: feature.name,
            committedAt: '2026-08-20T10:00:00.000Z',
            files: [
              { path: 'z.ts', changeType: 'A' },
              { path: 'shared.ts', changeType: 'A' },
            ],
          }),
          validCommit({
            sha: sha(2),
            branchName: feature.name,
            committedAt: '2026-08-21T10:00:00.000Z',
            files: [
              { path: 'shared.ts', changeType: 'M' },
              { path: 'a.ts', changeType: 'D' },
            ],
          }),
          // Another branch's commit touching the same path must not leak in.
          validCommit({
            sha: sha(3),
            branchName: 'main',
            committedAt: '2026-08-22T10:00:00.000Z',
            files: [
              { path: 'shared.ts', changeType: 'D' },
              { path: 'trunk-only.ts', changeType: 'A' },
            ],
          }),
        ],
      });

      const res = await branchDetail(await branchIdOf(feature.name));
      expect(res.status).toBe(200);
      expect(res.body.files).toEqual([
        { path: 'a.ts', changeType: 'D' },
        { path: 'shared.ts', changeType: 'M' },
        { path: 'z.ts', changeType: 'A' },
      ]);
    });

    // Rule 1's tie-break, fixed in the phase brief: when two commits touching a
    // path share an identical committedAt, the HIGHER sha wins -- reusing the
    // (committedAt, sha) ordering section 1 rule 3 already fixes, so the output
    // is deterministic. Sent in descending-sha order so a pass cannot be an
    // accident of insertion order.
    it('breaks a committedAt tie on the higher sha when a path repeats (T055)', async () => {
      const tied = '2026-08-21T19:00:00.000Z';
      await sync({
        branches: [trunk, feature],
        commits: [
          validCommit({
            sha: sha(9),
            branchName: feature.name,
            committedAt: tied,
            files: [{ path: 'tie.ts', changeType: 'D' }],
          }),
          validCommit({
            sha: sha(3),
            branchName: feature.name,
            committedAt: tied,
            files: [{ path: 'tie.ts', changeType: 'M' }],
          }),
        ],
      });

      const res = await branchDetail(await branchIdOf(feature.name));
      expect(res.status).toBe(200);
      expect(res.body.files).toEqual([{ path: 'tie.ts', changeType: 'D' }]);
    });

    // Rule 2: summed across the branch's commits, and only its own.
    it('sums truncatedFileCount across the branch commits (T055)', async () => {
      await sync({
        branches: [trunk, feature],
        commits: [
          validCommit({ sha: sha(1), branchName: feature.name, truncatedFileCount: 2 }),
          validCommit({ sha: sha(2), branchName: feature.name, truncatedFileCount: 3 }),
          validCommit({ sha: sha(3), branchName: 'main', truncatedFileCount: 40 }),
        ],
      });

      const res = await branchDetail(await branchIdOf(feature.name));
      expect(res.status).toBe(200);
      expect(res.body.truncatedFileCount).toBe(5);
    });

    // Rule 3: the union of the commits' tickets under section 2 rule 3,
    // de-duplicated by id, with `reported` on ANY commit winning.
    //   c1 (oldest)  reports TA          -> TA reported
    //   c2 (middle)  reports nothing     -> TA, TB, TC inferred (all match the branch)
    //   c3 (newest)  reports TB          -> TB reported
    // TA proves a reported link is not later overwritten by an inference; TB
    // proves an earlier inference is upgraded by a later reported link. A
    // last-one-wins merge fails on one or the other whichever way it iterates.
    it('de-duplicates tickets with reported winning over inferred (T055)', async () => {
      const ta = await newTicketOn(feature.name, 'Reported on the oldest commit');
      const tb = await newTicketOn(feature.name, 'Reported on the newest commit');
      const tc = await newTicketOn(feature.name, 'Never reported');

      await sync({
        branches: [trunk, feature],
        commits: [
          validCommit({
            sha: sha(1),
            branchName: feature.name,
            committedAt: '2026-08-19T10:00:00.000Z',
            ticketIds: [ta.id],
          }),
          validCommit({
            sha: sha(2),
            branchName: feature.name,
            committedAt: '2026-08-20T10:00:00.000Z',
            ticketIds: [],
          }),
          validCommit({
            sha: sha(3),
            branchName: feature.name,
            committedAt: '2026-08-21T10:00:00.000Z',
            ticketIds: [tb.id],
          }),
        ],
      });

      const res = await branchDetail(await branchIdOf(feature.name));
      expect(res.status).toBe(200);
      expectEveryTicketCarriesASource(res.body.tickets);
      expect(res.body.tickets.map((t: TicketRef) => t.id).sort()).toEqual(
        [ta.id, tb.id, tc.id].sort(),
      );
      expect(sourceOf(res.body.tickets, ta.id)).toBe('reported');
      expect(sourceOf(res.body.tickets, tb.id)).toBe('reported');
      expect(sourceOf(res.body.tickets, tc.id)).toBe('inferred');
    });

    // Rule 5: newest first, capped at 50, with commitCount giving the TRUE
    // total so the client can say the list shown is a subset (FR-015).
    it('returns commitMessages newest-first capped at 50 with the true commitCount (T055)', async () => {
      const commitAt = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
      const batch = (from: number, to: number) =>
        Array.from({ length: to - from }, (_, k) =>
          validCommit({
            sha: sha(from + k + 1),
            branchName: feature.name,
            message: `msg-${from + k}`,
            committedAt: commitAt(from + k),
            files: [],
          }),
        );

      await sync({ branches: [trunk, feature], commits: batch(0, 30) });
      await sync({ branches: [feature], commits: batch(30, 60) });

      const res = await branchDetail(await branchIdOf(feature.name));
      expect(res.status).toBe(200);
      expect(res.body.commitCount).toBe(60);
      expect(res.body.commitMessages).toHaveLength(50);
      expect(res.body.commitCount).toBeGreaterThan(res.body.commitMessages.length);
      // Newest first: msg-59 down to msg-10.
      expect(res.body.commitMessages).toEqual(
        Array.from({ length: 50 }, (_, i) => `msg-${59 - i}`),
      );
    });

    it('returns every commit message when the branch has fewer than 50 (T055)', async () => {
      await sync({
        branches: [trunk, feature],
        commits: [
          validCommit({
            sha: sha(1),
            branchName: feature.name,
            message: 'older',
            committedAt: '2026-08-19T10:00:00.000Z',
          }),
          validCommit({
            sha: sha(2),
            branchName: feature.name,
            message: 'newer',
            committedAt: '2026-08-20T10:00:00.000Z',
          }),
        ],
      });

      const res = await branchDetail(await branchIdOf(feature.name));
      expect(res.status).toBe(200);
      expect(res.body.commitCount).toBe(2);
      expect(res.body.commitMessages).toEqual(['newer', 'older']);
    });

    it('returns the empty aggregate for a branch with no commits (T055)', async () => {
      await sync({ branches: [trunk, feature], commits: [] });

      const res = await branchDetail(await branchIdOf(feature.name));
      expect(res.status).toBe(200);
      expect(res.body.commitCount).toBe(0);
      expect(res.body.commitMessages).toEqual([]);
      expect(res.body.files).toEqual([]);
      expect(res.body.truncatedFileCount).toBe(0);
      expect(res.body.tickets).toEqual([]);
    });
  });

  // T060 / US5, contracts/http-api.md section 1 rules 2 and 5. This is an
  // explicit REGRESSION test: `GET /` already answers the never-synced shape
  // with a 200 (see the section 1 block above), and US5 turns that behaviour
  // into a named guarantee, because the whole FR-029 empty state depends on it.
  // A 404 here would make "never synced" indistinguishable from "no such
  // project" and from a transport failure (FR-033).
  describe('GET / never-synced regression (US5, T060)', () => {
    it('answers 200 with the never-synced shape, not 404, for an existing unsynced project', async () => {
      // The project exists: it was created in beforeEach and is readable.
      const project = await request(app).get(`/api/v1/projects/${projectId}`).set(auth);
      expect(project.status).toBe(200);
      // ... and has genuinely never been synced.
      expect(await prisma.gitBranch.count({ where: { projectId } })).toBe(0);

      const res = await list();

      expect(res.status).toBe(200);
      expect(res.status).not.toBe(404);
      expect(res.body.error).toBeUndefined();
      expect(res.body).toEqual({ lastSyncedAt: null, branches: [], commits: [] });
    });

    it('still answers 404 for an unknown projectId, so the 200 above is not blanket', async () => {
      const res = await list('11111111-1111-4111-8111-111111111111');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
  // ---------------------------------------------------------------------------
  // Fix wave, Important 1 -- the four routes of this feature are protected by
  // exactly ONE line: `app.use('/api/v1', requireAuth)` in src/app.ts, which
  // sits ABOVE `app.use('/api/v1/projects/:projectId/git-history', ...)`.
  // Nothing pinned that ordering. Moving the mount two lines up would ship a
  // fully unauthenticated `POST .../git-history/sync` -- the system's only new
  // write endpoint -- with a completely green suite. These cases pin it.
  //
  // The project is seeded through the AUTHENTICATED path in beforeEach, so
  // every unauthenticated request below addresses a route that WOULD answer
  // 200 if it ran. Without that, a 401 could just as well come from an empty
  // database, and the test would not discriminate.
  // ---------------------------------------------------------------------------
  describe('requireAuth covers all four routes (fix wave, Important 1)', () => {
    let seededBranchId: string;

    beforeEach(async () => {
      const seed = await sync({ branches: [trunk], commits: [validCommit({ sha: sha(1) })] });
      expect(seed.status).toBe(200);
      seededBranchId = await branchIdOf(trunk.name);
    });

    /** A wholly valid batch of work that is NEW relative to the seed: were it
     * ever to reach the service, it would upsert a branch, a commit and a file
     * row. That is what makes the "zero rows" assertion below mean something. */
    const newWork = () => ({
      branches: [feature],
      commits: [
        validCommit({
          sha: sha(2),
          branchName: feature.name,
          files: [{ path: 'src/services/gitHistory.ts', changeType: 'M' }],
        }),
      ],
    });

    it('POST /sync answers 401 UNAUTHENTICATED with no Authorization header', async () => {
      const res = await request(app).post(syncUrl(projectId)).send(newWork());
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('POST /sync writes ZERO rows with no Authorization header', async () => {
      const before = await gitRowCounts();

      const res = await request(app).post(syncUrl(projectId)).send(newWork());
      expect(res.status).toBe(401);
      // The status alone proves nothing: an endpoint that wrote first and
      // rejected afterwards would still answer 401. The counts are the proof.
      expect(await gitRowCounts()).toEqual(before);

      // The control. The very same body, sent WITH a token, does write -- so
      // "zero rows" above is the auth boundary holding, not a body that had
      // nothing to write.
      const authorised = await sync(newWork());
      expect(authorised.status).toBe(200);
      const after = await gitRowCounts();
      expect(after.branches).toBeGreaterThan(before.branches);
      expect(after.commits).toBeGreaterThan(before.commits);
      expect(after.files).toBeGreaterThan(before.files);
    });

    it('the three GET endpoints answer 401 with no Authorization header', async () => {
      const urls = [
        historyUrl(projectId),
        commitDetailUrl(projectId, sha(1)),
        branchDetailUrl(projectId, seededBranchId),
      ];
      for (const url of urls) {
        const res = await request(app).get(url);
        // Asserted as one object so a failure names the offending URL.
        expect({ url, status: res.status, code: res.body.error?.code }).toEqual({
          url,
          status: 401,
          code: 'UNAUTHENTICATED',
        });
      }
    });

    it('all three GETs answer 200 WITH a token, so the 401s above are about auth alone', async () => {
      expect((await list()).status).toBe(200);
      expect((await commitDetail(sha(1))).status).toBe(200);
      expect((await branchDetail(seededBranchId)).status).toBe(200);
    });

    it('rejects a bearer token that is not a valid JWT, and still writes nothing', async () => {
      const res = await request(app)
        .post(syncUrl(projectId))
        .set('Authorization', 'Bearer not-a-real-token')
        .send(newWork());
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(await prisma.gitCommit.count({ where: { sha: sha(2) } })).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Fix wave, Gap -- the section 1 / 2 / 3 disagreement, pinned exactly as the
  // code behaves TODAY. This block changes nothing and fixes nothing.
  //
  // The write path's 500-file cap is per CALL (section 4 rule 6) and sync never
  // deletes (rule 2 / FR-032). So two legal batches, same sha, 500 disjoint
  // paths each, leave 1000 stored rows on one commit. From there the three read
  // endpoints disagree, and the contract does not say which of them is right:
  //
  //   section 1 rule 4  `fileCount` is the number of STORED rows and
  //     `fileCount + truncatedFileCount` is "the real total". Here that reads
  //     1000 -- yet had the two batches re-reported the SAME 500 paths, the
  //     stored count would be 500 and the arithmetic would give a different
  //     answer for an identical commit. The rule stops describing reality.
  //   section 2 rule 1  commit detail caps at 500 on READ, so it shows 500 of
  //     the 1000 and reports the list as complete (`truncatedFileCount` is 0).
  //   section 3 rule 1  branch detail has NO cap and returns the whole union:
  //     all 1000.
  //
  // Do NOT "fix" this by capping the branch endpoint, or by recomputing
  // `truncatedFileCount` on read. Which section is authoritative is a product
  // decision. This test exists so the disagreement is visible and so that
  // changing one side without the other fails loudly, here, with this comment.
  // ---------------------------------------------------------------------------
  describe('re-sync with a different file set (fix wave, Gap)', () => {
    const paths = (prefix: string) =>
      Array.from({ length: 500 }, (_, i) => ({
        path: `${prefix}/${i.toString().padStart(3, '0')}.ts`,
        changeType: 'A',
      }));

    /** The stored rows for the one sha, read straight from the database. */
    async function storedFileRows() {
      const commit = await prisma.gitCommit.findFirstOrThrow({
        where: { projectId, sha: sha(1) },
        select: { id: true },
      });
      return prisma.gitCommitFile.count({ where: { commitId: commit.id } });
    }

    beforeEach(async () => {
      // Both calls are legal: each sends exactly 500 files, the per-call cap.
      // The prefixes interleave under an ascending sort, so "a/..." sorts
      // first although it was written second.
      const first = await sync({
        branches: [trunk],
        commits: [validCommit({ sha: sha(1), files: paths('b'), truncatedFileCount: 0 })],
      });
      expect(first.status).toBe(200);
      const second = await sync({
        branches: [trunk],
        commits: [validCommit({ sha: sha(1), files: paths('a'), truncatedFileCount: 0 })],
      });
      expect(second.status).toBe(200);
    });

    it('leaves MORE than 500 stored rows on the one sha (sync is additive, FR-032)', async () => {
      const stored = await storedFileRows();
      expect(stored).toBeGreaterThan(500);
      expect(stored).toBe(1000);
    });

    it('GET /commits/:sha still returns exactly 500 -- the read path caps (section 2 rule 1)', async () => {
      const res = await commitDetail(sha(1));
      expect(res.status).toBe(200);
      expect(res.body.files).toHaveLength(500);
      // The first 500 by ascending path: the "a/..." batch, written second.
      expect(res.body.files.map((f: { path: string }) => f.path)).toEqual(
        paths('a').map((f) => f.path),
      );
      // And it reports the list as complete, because `truncatedFileCount` is
      // the reporter's own field and the read cap does not touch it (rule 2).
      expect(res.body.truncatedFileCount).toBe(0);
    });

    it('GET / reports fileCount 1000, so section 1 rule 4 arithmetic no longer holds', async () => {
      const res = await list();
      expect(res.status).toBe(200);
      const commit = res.body.commits.find((c: { sha: string }) => c.sha === sha(1));
      expect(commit.fileCount).toBe(await storedFileRows());
      expect(commit.truncatedFileCount).toBe(0);
      // "The real total" per rule 4 -- 1000 -- against what endpoint 2 will
      // ever show -- 500. Each is the current, intended behaviour of its own
      // section; they cannot both be honest about the same commit.
      expect(commit.fileCount + commit.truncatedFileCount).toBe(1000);
      expect((await commitDetail(sha(1))).body.files).toHaveLength(500);
    });

    it('GET /branches/:branchId returns all 1000 -- section 3 has no cap', async () => {
      const res = await branchDetail(await branchIdOf(trunk.name));
      expect(res.status).toBe(200);
      // The disagreement in one assertion: the same commit's files, through
      // two endpoints, two different answers. Read the block comment above
      // before changing either number.
      expect({
        viaCommitDetail: (await commitDetail(sha(1))).body.files.length,
        viaBranchDetail: res.body.files.length,
      }).toEqual({ viaCommitDetail: 500, viaBranchDetail: 1000 });
    });
  });
});
