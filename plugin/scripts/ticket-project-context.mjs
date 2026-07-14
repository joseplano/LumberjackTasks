// SessionStart hook (plugin-provided): injects the repo → ticket-project mapping
// into context, and the exact command to measure real token usage.
//
// This plugin is installed once and applies to every repo the user opens, so a
// repo with no mapping is a repo that never opted in: say nothing, write nothing.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tokensScript = join(pluginRoot, 'scripts', 'session-tokens.mjs');

// Hook input arrives as JSON on stdin ({ session_id, transcript_path, cwd, ... }).
// Skipped when run manually from a terminal (TTY).
let input = {};
if (!process.stdin.isTTY) {
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    input = {};
  }
}

const projectDir = input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const claudeDir = join(projectDir, '.claude');

let cfg;
try {
  cfg = JSON.parse(readFileSync(join(claudeDir, 'ticket-project.json'), 'utf8'));
} catch {
  process.exit(0); // not opted in
}

// Only now, with the repo known to use the ticket system, is it fair to write to
// its .claude/ — session-tokens.mjs reads the transcript path from here.
if (input.session_id || input.transcript_path) {
  try {
    writeFileSync(
      join(claudeDir, '.session-state.json'),
      JSON.stringify(
        {
          session_id: input.session_id ?? null,
          transcript_path: input.transcript_path ?? null,
          at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch {
    // a read-only .claude/ must not break the session
  }
}

console.log(
  `This repo is linked to project "${cfg.projectName}" (id ${cfg.projectId}) in the Lumberjack Tasks system. ` +
    'Before planning or implementing any new task, use the lumberjack-tasks:ticket-sync skill to create and track tickets. ' +
    'To register real token usage on a ticket move, run this exact command:\n' +
    `node "${tokensScript}" --project-dir "${projectDir}" --consume`,
);
