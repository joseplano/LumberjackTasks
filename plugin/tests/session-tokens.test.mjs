import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', 'scripts', 'session-tokens.mjs');
const fixture = join(here, 'fixtures', 'transcript.jsonl');

function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'ticket-repo-'));
  mkdirSync(join(repo, '.claude'));
  return repo;
}

function run(args) {
  return JSON.parse(execFileSync('node', [script, ...args], { encoding: 'utf8' }));
}

test('sums new tokens, keeps only the last entry per message id, ignores cache reads', () => {
  const repo = makeRepo();
  const out = run(['--project-dir', repo, '--transcript', fixture]);

  assert.equal(out.tokens, 40);
  assert.equal(out.llmName, 'claude-opus-4-8');
});

test('--consume writes its checkpoint inside the given project dir, not next to the script', () => {
  const repo = makeRepo();
  run(['--project-dir', repo, '--transcript', fixture, '--consume']);

  const checkpoint = join(repo, '.claude', '.session-tokens-state.json');
  assert.ok(existsSync(checkpoint), 'checkpoint must land in the repo passed via --project-dir');
  assert.equal(JSON.parse(readFileSync(checkpoint, 'utf8')).transcript, fixture);
  assert.ok(!existsSync(join(here, '..', '.claude')), 'must not write state into the plugin');
  // The historical bug computed claudeDir as dirname(script)/.., which from
  // plugin/scripts/ lands at plugin/ (not plugin/.claude/) — so the stray
  // checkpoint would appear directly in the plugin dir or next to the script.
  assert.ok(
    !existsSync(join(here, '..', '.session-tokens-state.json')),
    'must not write a checkpoint directly into the plugin dir',
  );
  assert.ok(
    !existsSync(join(here, '..', 'scripts', '.session-tokens-state.json')),
    'must not write a checkpoint next to the script',
  );
});

test('a second --consume returns a zero delta for the same transcript', () => {
  const repo = makeRepo();
  const first = run(['--project-dir', repo, '--transcript', fixture, '--consume']);
  const second = run(['--project-dir', repo, '--transcript', fixture, '--consume']);

  assert.equal(first.tokens, 40);
  assert.equal(second.tokens, 0, 'tokens already registered must not be double-counted');
});

test('--since / --until windows the transcript and leaves the checkpoint untouched', () => {
  const repo = makeRepo();
  const out = run([
    '--project-dir', repo,
    '--transcript', fixture,
    '--since', '2026-07-14T10:30:00Z',
    '--until', '2026-07-14T11:30:00Z',
  ]);

  assert.equal(out.tokens, 5, 'only msg_2 falls inside the window');
  assert.ok(
    !existsSync(join(repo, '.claude', '.session-tokens-state.json')),
    'a retroactive query must not checkpoint',
  );
});

test('--consume combined with --since / --until still leaves the checkpoint untouched', () => {
  const repo = makeRepo();
  const out = run([
    '--project-dir', repo,
    '--transcript', fixture,
    '--consume',
    '--since', '2026-07-14T10:30:00Z',
    '--until', '2026-07-14T11:30:00Z',
  ]);

  assert.equal(out.tokens, 5, 'only msg_2 falls inside the window');
  assert.ok(
    !existsSync(join(repo, '.claude', '.session-tokens-state.json')),
    '--consume must not checkpoint when combined with a --since/--until window',
  );
});

test('falls back to CLAUDE_PROJECT_DIR when --project-dir is absent', () => {
  const repo = makeRepo();

  const out = JSON.parse(
    execFileSync('node', [script, '--transcript', fixture, '--consume'], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    }),
  );

  assert.equal(out.tokens, 40);
  assert.ok(
    existsSync(join(repo, '.claude', '.session-tokens-state.json')),
    'the checkpoint must follow CLAUDE_PROJECT_DIR, not the cwd the script happened to run from',
  );
});

test('skips malformed transcript lines instead of crashing', () => {
  // Claude Code appends to the transcript as it streams; reading it mid-write
  // can catch a half-flushed line. One bad line must not lose the whole session.
  const repo = makeRepo();
  const torn = join(repo, 'torn.jsonl');
  writeFileSync(
    torn,
    [
      '{"message":{"id":"m1","model":"claude-opus-4-8","usage":{"input_tokens":10,"output_tokens":5}}}',
      '{"message":{"id":"m2","model":"claude-opus-4-8","usage":{"inp',
      '',
      'not json at all',
      '{"message":{"id":"m3","model":"claude-opus-4-8","usage":{"input_tokens":1,"output_tokens":1}}}',
    ].join('\n'),
  );

  const out = run(['--project-dir', repo, '--transcript', torn]);

  assert.equal(out.tokens, 17, 'the two intact messages must still be counted');
});
