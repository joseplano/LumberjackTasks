// Sums real LLM token usage from the current Claude Code session transcript
// (JSONL) so ticket moves can register accurate tokensDelta + llmName.
//
// Usage (the SessionStart hook prints the exact command with paths resolved):
//   node <plugin>/scripts/session-tokens.mjs --project-dir <repo> --consume
//   ... --since 2026-07-03T13:00:00Z --until 2026-07-03T14:00:00Z   # no checkpoint
//   ... --transcript <path.jsonl>
//
// "tokens" = input + cache_creation + output (new tokens; cache reads are
// re-reads of the same context every turn and would inflate the number).
// Output is JSON: { tokens, llmName, perModel, transcript }.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function parseArgs(argv) {
  const args = { consume: false, since: null, until: null, transcript: null, projectDir: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--consume') args.consume = true;
    else if (argv[i] === '--since') args.since = new Date(argv[++i]);
    else if (argv[i] === '--until') args.until = new Date(argv[++i]);
    else if (argv[i] === '--transcript') args.transcript = argv[++i];
    else if (argv[i] === '--project-dir') args.projectDir = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv);

// This script lives in the plugin, not in the repo being worked on, so the repo
// must be passed in — deriving it from the script's own location would point at
// the plugin and scatter session state there.
const projectDir = args.projectDir ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const claudeDir = join(projectDir, '.claude');
const sessionStatePath = join(claudeDir, '.session-state.json');
const checkpointPath = join(claudeDir, '.session-tokens-state.json');

function findTranscript(explicit) {
  if (explicit) return explicit;
  try {
    const state = JSON.parse(readFileSync(sessionStatePath, 'utf8'));
    if (state.transcript_path && existsSync(state.transcript_path)) return state.transcript_path;
  } catch {
    // no session state; fall back to newest transcript for this project
  }
  const projectSlug = projectDir.replace(/[:\\/.]/g, '-');
  const dir = join(homedir(), '.claude', 'projects', projectSlug);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!files.length) throw new Error(`No transcripts found in ${dir}`);
  return files[0];
}

function sumTranscript(path, since, until) {
  // Streaming writes several lines per API message with the same id and
  // cumulative usage — keep only the LAST entry per message id.
  const byMessage = new Map();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = entry.message?.usage;
    if (!usage || typeof usage.output_tokens !== 'number') continue;
    if (since || until) {
      const ts = entry.timestamp ? new Date(entry.timestamp) : null;
      if (!ts) continue;
      if (since && ts < since) continue;
      if (until && ts > until) continue;
    }
    const key = entry.message?.id ?? entry.requestId ?? entry.uuid;
    byMessage.set(key, { model: entry.message?.model ?? 'unknown', usage });
  }

  const perModel = {};
  for (const { model, usage } of byMessage.values()) {
    const m = (perModel[model] ??= { tokens: 0, input: 0, cacheCreation: 0, cacheRead: 0, output: 0, messages: 0 });
    m.input += usage.input_tokens ?? 0;
    m.cacheCreation += usage.cache_creation_input_tokens ?? 0;
    m.cacheRead += usage.cache_read_input_tokens ?? 0;
    m.output += usage.output_tokens ?? 0;
    m.tokens += (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.output_tokens ?? 0);
    m.messages += 1;
  }
  return perModel;
}

function dominantModel(perModel) {
  return Object.entries(perModel).sort((a, b) => b[1].tokens - a[1].tokens)[0]?.[0] ?? null;
}

const transcript = findTranscript(args.transcript);
const perModel = sumTranscript(transcript, args.since, args.until);

let result = perModel;
if (args.consume && !args.since && !args.until) {
  let checkpoint = {};
  try {
    const saved = JSON.parse(readFileSync(checkpointPath, 'utf8'));
    if (saved.transcript === transcript) checkpoint = saved.perModel ?? {};
  } catch {
    // first run: delta is the full session
  }
  const delta = {};
  for (const [model, m] of Object.entries(perModel)) {
    const prev = checkpoint[model] ?? { tokens: 0, input: 0, cacheCreation: 0, cacheRead: 0, output: 0, messages: 0 };
    delta[model] = Object.fromEntries(
      Object.keys(m).map((k) => [k, Math.max(0, m[k] - (prev[k] ?? 0))]),
    );
  }
  writeFileSync(checkpointPath, JSON.stringify({ transcript, perModel, at: new Date().toISOString() }, null, 2));
  result = delta;
}

const total = Object.values(result).reduce((acc, m) => acc + m.tokens, 0);
console.log(JSON.stringify({ tokens: total, llmName: dominantModel(result), perModel: result, transcript }, null, 2));
