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
});
