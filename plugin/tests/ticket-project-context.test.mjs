import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', 'scripts', 'ticket-project-context.mjs');

function makeRepo({ withMapping }) {
  const repo = mkdtempSync(join(tmpdir(), 'ticket-repo-'));
  if (withMapping) {
    mkdirSync(join(repo, '.claude'));
    writeFileSync(
      join(repo, '.claude', 'ticket-project.json'),
      JSON.stringify({ projectId: 'abc-123', projectName: 'Demo Project' }),
    );
  }
  return repo;
}

// The hook receives its payload as JSON on stdin, the way Claude Code invokes it.
function runHook(repo, transcriptPath = 'C:/transcripts/session.jsonl') {
  return execFileSync('node', [script], {
    encoding: 'utf8',
    input: JSON.stringify({
      session_id: 'sess-1',
      transcript_path: transcriptPath,
      cwd: repo,
      hook_event_name: 'SessionStart',
      source: 'startup',
    }),
  });
}

test('says nothing and writes nothing in a repo that never opted in', () => {
  const repo = makeRepo({ withMapping: false });

  const stdout = runHook(repo);

  assert.equal(stdout.trim(), '', 'the plugin is installed globally; it must stay silent here');
  assert.ok(!existsSync(join(repo, '.claude')), 'must not create .claude in an unrelated repo');
});

test('injects the project mapping and the exact token command when the repo opted in', () => {
  const repo = makeRepo({ withMapping: true });

  const stdout = runHook(repo);

  assert.match(stdout, /Demo Project/);
  assert.match(stdout, /abc-123/);
  assert.match(stdout, /lumberjack-tasks:ticket-sync/);
  assert.match(stdout, /session-tokens\.mjs/);
  assert.ok(stdout.includes(`--project-dir "${repo}"`), 'the repo path must be baked into the command');
  assert.match(stdout, /--consume/);
});

test('persists the session transcript path for the token script', () => {
  const repo = makeRepo({ withMapping: true });

  runHook(repo, 'C:/transcripts/abc.jsonl');

  const state = JSON.parse(readFileSync(join(repo, '.claude', '.session-state.json'), 'utf8'));
  assert.equal(state.transcript_path, 'C:/transcripts/abc.jsonl');
  assert.equal(state.session_id, 'sess-1');
});

test('stays silent when the mapping file is corrupt, rather than crashing the session start', () => {
  // A truncated or hand-edited ticket-project.json must not take the session
  // down with it — a broken mapping is indistinguishable, for us, from no mapping.
  const repo = mkdtempSync(join(tmpdir(), 'ticket-repo-'));
  mkdirSync(join(repo, '.claude'));
  writeFileSync(join(repo, '.claude', 'ticket-project.json'), '{ "projectId": "abc"');

  const stdout = runHook(repo);

  assert.equal(stdout.trim(), '');
});

test('falls back to CLAUDE_PROJECT_DIR when the hook payload carries no cwd', () => {
  const repo = makeRepo({ withMapping: true });

  const stdout = execFileSync('node', [script], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    input: JSON.stringify({ session_id: 'sess-2', transcript_path: 'C:/t/x.jsonl' }),
  });

  assert.match(stdout, /Demo Project/);
  assert.ok(stdout.includes(`--project-dir "${repo}"`));
});
