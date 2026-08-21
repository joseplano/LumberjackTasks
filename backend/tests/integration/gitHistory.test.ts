import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, authHeader } from '../helpers';

const app = createApp();
let auth: { Authorization: string };
let projectId: string;

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

      // The sync route is not mounted yet (T028), so this is a 404 from the
      // router, NOT a 413. The point is only that a small body is not rejected
      // by the body parser.
      expect(res.status).not.toBe(413);
    });
  });
});
