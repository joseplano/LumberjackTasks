// Guards the plugin's static configuration — the part with no runtime and no
// stack trace when it breaks. Three of the four failure modes below are silent:
// the plugin loads, and something it was supposed to provide just isn't there.
//
// Expected names are DERIVED from the manifest, never hardcoded, so renaming the
// plugin or its MCP server fails here instead of quietly stranding the text
// references in SKILL.md and ticket-init.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(pluginRoot, '..');

const read = (...parts) => readFileSync(join(...parts), 'utf8');
const readJson = (...parts) => JSON.parse(read(...parts));

const manifest = readJson(pluginRoot, '.claude-plugin', 'plugin.json');
const skill = read(pluginRoot, 'skills', 'ticket-sync', 'SKILL.md');
const ticketInit = read(pluginRoot, 'commands', 'ticket-init.md');

const serverName = Object.keys(manifest.mcpServers)[0];
// How Claude Code exposes a plugin-provided MCP server's tools and skills.
const toolPrefix = `mcp__plugin_${manifest.name}_${serverName}__`;
const skillName = `${manifest.name}:ticket-sync`;
// The bare, un-prefixed form a manually-registered (non-plugin) server would expose.
const bareToolPrefix = `mcp__${serverName}__`;
const urlEnvVar = `${manifest.name.replace(/-/g, '_').toUpperCase()}_MCP_URL`;

test('the manifest declares only mcpServers — declaring hooks or skills disables the MCP server', () => {
  // hooks/hooks.json and skills/ auto-load. Declaring them raises
  // "Duplicate hooks file detected" -> hook-load-failed, whose unrelated-looking
  // side effect is that the plugin's MCP server never registers. Nothing else in
  // this repo would catch that.
  for (const key of ['hooks', 'skills', 'commands']) {
    assert.ok(
      !(key in manifest),
      `plugin.json must not declare "${key}" — it is auto-loaded, and declaring it silently kills the plugin's MCP server`,
    );
  }
  assert.ok('mcpServers' in manifest);
});

test('the MCP server is reachable over HTTP at an overridable URL', () => {
  const server = manifest.mcpServers[serverName];

  assert.equal(server.type, 'http');
  assert.match(
    server.url,
    new RegExp(`^\\$\\{${urlEnvVar}:-http://127\\.0\\.0\\.1:5000/mcp\\}$`),
    `the default must be overridable by ${urlEnvVar} for anyone hosting the stack elsewhere`,
  );
});

test('the SessionStart hook points at a script that exists, resolved from the plugin root', () => {
  const hooks = readJson(pluginRoot, 'hooks', 'hooks.json');
  const command = hooks.hooks.SessionStart[0].hooks[0].command;

  assert.match(command, /\$\{CLAUDE_PLUGIN_ROOT\}/, 'the path must resolve from the plugin, not the cwd');

  const scriptPath = command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)/)[1];
  assert.ok(
    existsSync(join(pluginRoot, scriptPath)),
    `hooks.json runs ${scriptPath}, which does not exist in the plugin`,
  );
});

test('the marketplace index and the manifest agree on what is being published', () => {
  const marketplace = readJson(repoRoot, '.claude-plugin', 'marketplace.json');
  const entry = marketplace.plugins.find((p) => p.name === manifest.name);

  assert.ok(entry, `the marketplace does not list a plugin named "${manifest.name}"`);
  assert.equal(entry.version, manifest.version, 'a version bump in one file but not the other ships the wrong version');
  assert.ok(
    existsSync(join(repoRoot, entry.source, '.claude-plugin', 'plugin.json')),
    `the marketplace's source "${entry.source}" does not contain a plugin`,
  );
});

test('the skill and the command call the MCP tools by their plugin-scoped names', () => {
  // Packaging renames the tools. A skill still asking for the bare names finds nothing.
  for (const [file, text] of [['SKILL.md', skill], ['ticket-init.md', ticketInit]]) {
    assert.ok(text.includes(toolPrefix), `${file} must reference the tools as ${toolPrefix}*`);
    assert.doesNotMatch(
      text,
      new RegExp(bareToolPrefix),
      `${file} references the tools as ${bareToolPrefix}*, the un-prefixed names a plugin-provided server never exposes`,
    );
  }
});

test('the hook and the command call the skill by its namespaced name', () => {
  const hookScript = read(pluginRoot, 'scripts', 'ticket-project-context.mjs');

  assert.ok(hookScript.includes(skillName), `the hook must name the skill "${skillName}"`);
  assert.ok(ticketInit.includes(skillName), `ticket-init.md must name the skill "${skillName}"`);
});

test('the plugin ships with no dependencies — it is copied verbatim onto users machines', () => {
  assert.ok(!existsSync(join(pluginRoot, 'node_modules')), 'the plugin must not carry node_modules');

  if (existsSync(join(pluginRoot, 'package.json'))) {
    const pkg = readJson(pluginRoot, 'package.json');
    assert.deepEqual(pkg.dependencies ?? {}, {}, 'the plugin must have no runtime dependencies');
    assert.deepEqual(pkg.devDependencies ?? {}, {}, 'tests must run on the built-in node --test runner');
  }
});

test('the skill reads the branch from the repo and never fabricates one (FR-023, FR-024)', () => {
  // The ticket's branch field is a mirror of the repo, and this skill is the only
  // thing that writes it. Every failure mode here is silent: the board keeps
  // showing "Sin rama aún", or worse, a plausible-looking name nobody ever
  // checked out. Nothing at runtime would flag either one.
  assert.match(
    skill,
    /git rev-parse --abbrev-ref HEAD/,
    'SKILL.md must tell the agent to read the branch with `git rev-parse --abbrev-ref HEAD` — any other source is a guess',
  );

  // move_ticket has no `branch` parameter; instructing the agent to pass it there
  // would make every report a silently rejected no-op.
  assert.match(
    skill,
    /`branch`[\s\S]{0,200}?update_ticket/,
    'SKILL.md must report the branch via update_ticket/update_subticket, not move_ticket',
  );

  // FR-024: a detached HEAD prints the literal "HEAD". Sending that, or the commit
  // hash, would write a value that is not a branch at all.
  assert.match(
    skill,
    /detached/i,
    'SKILL.md must cover the detached-HEAD case (FR-024)',
  );
  assert.match(
    skill,
    /omit `branch`|report \*\*nothing\*\*|report nothing/,
    'SKILL.md must say that a detached HEAD reports nothing rather than a commit hash',
  );

  // FR-025 has no code to enforce it — there is no generator to delete. This
  // instruction is the only thing standing between the mirror and a fabricated name.
  assert.match(
    skill,
    /Never invent, derive, slugify/,
    'SKILL.md must forbid inventing, deriving or slugifying a branch name (FR-025)',
  );
});

test('every script the plugin ships imports only Node built-ins', () => {
  const scripts = readdirSync(join(pluginRoot, 'scripts')).filter((f) => f.endsWith('.mjs'));
  assert.ok(scripts.length > 0, 'expected the plugin to ship scripts');

  for (const file of scripts) {
    for (const [, specifier] of read(pluginRoot, 'scripts', file).matchAll(/^import .* from '([^']+)';$/gm)) {
      assert.ok(
        specifier.startsWith('node:'),
        `scripts/${file} imports "${specifier}" — the plugin has no node_modules on a user's machine`,
      );
    }
  }
});
// Fix wave, Important 2. The 100 kB body limit in backend/src/app.ts is a
// denial-of-service control and is not raised, so the agent chunks instead.
// "Send fewer commits, not fewer files per commit" had a floor nobody had
// noticed: a batch of ONE commit cannot be split. A commit whose own `files`
// array carries the body past the limit was therefore permanently unsyncable,
// with this file explicitly forbidding the one remedy the design already
// provides. Nothing at runtime would surface it -- the sync just keeps
// answering 413 and the agent keeps doing the thing that cannot help.
test('the skill leaves a way out of a 413 on a single oversized commit (FR-023, FR-017)', () => {
  assert.doesNotMatch(
    skill,
    /not fewer files per commit/,
    'SKILL.md must not forbid sending fewer files: for a one-commit batch that is the only remedy left',
  );

  // The batch-size remedy stays FIRST -- it is the right answer nearly always.
  assert.match(
    skill,
    /413 PAYLOAD_TOO_LARGE`? means send\s+fewer commits/,
    'SKILL.md must still name "send fewer commits" as the first response to a 413',
  );

  // ... and the escape hatch after it, for the case where that is exhausted.
  assert.match(
    skill,
    /413[\s\S]{0,600}?fewer `files`[\s\S]{0,200}?`truncatedFileCount`/,
    'SKILL.md must tell the agent that a single commit still hitting 413 sends fewer `files`, with the difference in `truncatedFileCount`',
  );

  // The remainder is REPORTED, never quietly dropped: a silently short file
  // list presented as complete is exactly what FR-017 forbids.
  assert.match(
    skill,
    /`truncatedFileCount`[\s\S]{0,200}?never dropped silently/,
    'SKILL.md must say the remainder is reported, never dropped silently (FR-017)',
  );
});
