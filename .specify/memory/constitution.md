<!--
Sync Impact Report
Version change: (template, unversioned) → 1.0.0
Rationale: First concrete ratification of the project constitution. The prior file was the
untouched upstream template with unresolved placeholder tokens, so this is an initial adoption
rather than an amendment.

Modified principles:
- [PRINCIPLE_1_NAME] → I. Module Boundaries & Single Source of Truth
- [PRINCIPLE_2_NAME] → II. TypeScript & Test Discipline (NON-NEGOTIABLE)
- [PRINCIPLE_3_NAME] → III. Security Posture Preservation & Scope Honesty
- [PRINCIPLE_4_NAME] → IV. Plugin Portability & Silent-Failure Avoidance
- [PRINCIPLE_5_NAME] → V. Configuration, Secrets & Reproducible Environments

Added sections:
- Technology Stack & Runtime Constraints (was [SECTION_2_NAME])
- Development Workflow & Quality Gates (was [SECTION_3_NAME])
- Governance (populated)

Removed sections: none

Templates requiring updates:
- .specify/templates/plan-template.md ✅ reads constitution at runtime, no change required
- .specify/templates/spec-template.md ✅ reads constitution at runtime, no change required
- .specify/templates/tasks-template.md ✅ reads constitution at runtime, no change required
- .specify/templates/checklist-template.md ✅ reads constitution at runtime, no change required

Follow-up TODOs: none. All placeholders resolved from repository evidence.
-->

# Lumberjack Tasks Constitution

Lumberjack Tasks is a self-hosted kanban ticket system that Claude Code drives itself through an
MCP server. This repository is three things at once: the **stack** (backend, frontend, MCP
server), a **Claude Code plugin**, and the **marketplace** that publishes that plugin. These
principles govern all changes to any of the three.

## Core Principles

### I. Module Boundaries & Single Source of Truth

The repository is four packages with non-overlapping responsibilities, and those boundaries MUST
be preserved:

- `backend/` — Express 5 + TypeScript + Prisma 7 over PostgreSQL 16. Owns JWT authentication,
  all kanban domain logic (projects, columns, tickets, subtickets, labels, phases), reports, and
  the Server-Sent-Events stream that pushes live board updates.
- `frontend/` — Next.js 15 + React 19 + Tailwind 4 + dnd-kit. The board UI, and a consumer of
  the backend HTTP API only.
- `mcp/` — a Model Context Protocol server (`@modelcontextprotocol/sdk` + `zod`) that exposes
  backend capabilities as tools Claude Code can call.
- `plugin/` — the Claude Code plugin: the `ticket-sync` skill, the `SessionStart` hook, the
  `session-tokens.mjs` script, the `/ticket-init` command, and the MCP server registration.

The backend is the **single source of truth** for all domain state. The MCP server MUST reach the
backend over HTTP using bot credentials and MUST NOT open its own database connection, embed
domain rules that the backend does not enforce, or become a second write path. Domain
invariants (for example, that subtickets never carry a `phaseId` and are rejected with
`400 SUBTASK_PHASE`) MUST be enforced in the backend; other layers may mirror them for UX, never
replace them.

*Rationale:* A ticket system Claude edits autonomously is only trustworthy if exactly one
component decides what is valid. Duplicated rules drift silently and corrupt the board.

### II. TypeScript & Test Discipline (NON-NEGOTIABLE)

The stack is TypeScript throughout; new stack code MUST be TypeScript, not JavaScript.

Every behavior change MUST ship with tests that cover it. Security-relevant fixes MUST ship with
a regression test that **fails without the fix**. The full suite MUST pass before a pull request
is opened:

```bash
cd backend && npm test                    # vitest: integration + unit
cd mcp && npm test                        # vitest
cd frontend && npm test                   # vitest + Testing Library + jsdom
node --test plugin/tests/*.test.mjs       # Node's built-in runner
```

The plugin suite MUST be invoked in the glob form shown above. The directory form
(`node --test plugin/tests`) fails with `MODULE_NOT_FOUND` on Windows and is not a valid
substitute. Backend changes that touch HTTP behavior require integration coverage, not unit
coverage alone.

*Rationale:* This system is written and operated largely by an agent. Tests are the only
mechanism that reliably catches an agent's regression before a human sees it.

### III. Security Posture Preservation & Scope Honesty

Lumberjack Tasks is **single-tenant by design**. Once authenticated, every account can read,
modify and delete **all** projects, tickets, columns, labels, phases and reports of **every**
account. There is no ownership model and no roles. Multi-tenant isolation is planned work and is
NOT implemented.

This limitation MUST be stated honestly, never papered over. No change may imply per-user
isolation that does not exist, and no feature may be documented as safe for untrusted multi-user
exposure. The supported deployment target is `localhost`, or a reverse proxy the operator
controls and authenticates.

The following hardening already exists and MUST NOT be weakened without an explicit, documented
amendment:

- **No hard-coded JWT secret, ever.** `backend/src/config.ts` mints a random per-process secret
  outside production and **throws on startup** in production unless `JWT_SECRET` is ≥ 32 chars
  and not a known placeholder. A published default would let any reader of this public repo forge
  tokens for any user.
- `helmet` security headers, with `X-Powered-By` disabled.
- Rate limiting on authentication endpoints.
- CORS restricted by default to `http://localhost:3000`; other origins are opt-in via
  `CORS_ORIGIN`.
- Passwords hashed with bcrypt, minimum 8 characters.
- The MCP server bound to loopback. It has **no authentication of its own** and acts with the
  bot's backend credentials. In Docker it binds `0.0.0.0` inside the container only because the
  host publish is pinned to `127.0.0.1:5000`; that pin MUST stay.

*Rationale:* The threat model is deliberate and narrow. Every listed control compensates for the
absence of per-user authorization; removing one silently converts a safe local tool into an open
database.

### IV. Plugin Portability & Silent-Failure Avoidance

`plugin/` is copied verbatim onto users' machines. It MUST have **no runtime dependencies and no
`node_modules`**; its tests therefore run on Node's built-in runner. Introducing a dependency
into `plugin/` is a breaking change and requires an explicit amendment.

Claude Code plugin packaging fails silently in ways that are not documented upstream. Before any
change under `plugin/`, the "Cómo está armado el plugin, y las cuatro trampas" section of
`docs/ticket-sync.md` MUST be read, and these rules MUST hold:

1. `plugin/.claude-plugin/plugin.json` declares **only** `mcpServers`. Adding a `"hooks"` or
   `"skills"` key disables the plugin's MCP server — the error message mentions hooks, never MCP.
2. The plugin's `bin/` is not added to `PATH`. The absolute path to `session-tokens.mjs` is
   emitted by the `SessionStart` hook via `${CLAUDE_PLUGIN_ROOT}`; the skill MUST run that
   command verbatim and MUST NOT reconstruct the path, because `${CLAUDE_PLUGIN_ROOT}` is not
   available inside model-issued Bash calls.
3. A manually registered MCP server at the same URL suppresses the plugin's server and exposes
   tools under unprefixed names the skill does not expect.
4. Names change when packaged (`mcp__plugin_lumberjack-tasks_lumberjack-tasks__*`,
   `lumberjack-tasks:ticket-sync`, `/lumberjack-tasks:ticket-init`). These are referenced as
   literal text, so renaming the plugin or the MCP server REQUIRES updating every reference.

The `SessionStart` hook MUST stay silent in repositories with no `.claude/ticket-project.json`:
it must print nothing and write nothing. Opt-in is per repository via `/ticket-init`.

*Rationale:* Three of these four failure modes produce no error at all — something simply stops
existing. Encoding them as rules is cheaper than rediscovering them.

### V. Configuration, Secrets & Reproducible Environments

Configuration is environment-driven, per package: `backend/.env`, `mcp/.env`,
`frontend/.env.local`, each derived from the committed `*.env.example`. Every new setting MUST be
added to the corresponding `.env.example` with a safe default and documented in `README.md`.
Secrets MUST NOT be committed; `.env` files and per-machine state
(`.claude/.session-state.json`, `.claude/.session-tokens-state.json`) stay gitignored.

Docker Compose is the primary supported deployment path and MUST remain a working one-command
bring-up (`docker compose up -d`). Local development without Docker requires Node ≥ 20 and
PostgreSQL 16. All database schema changes MUST go through Prisma migrations under
`backend/prisma/migrations`; ad-hoc SQL against a running database, or schema drift not captured
by a migration, is prohibited.

*Rationale:* A tool meant to be cloned and run by strangers must boot on the first try, and a
board whose schema drifts from its migrations cannot be restored.

## Technology Stack & Runtime Constraints

Stack changes stay within these bounds unless amended:

| Package | Stack |
|---|---|
| `backend/` | Express 5, TypeScript, Prisma 7 (`@prisma/adapter-pg`), PostgreSQL 16, `jsonwebtoken`, `bcryptjs`, `helmet`, `express-rate-limit`, vitest + supertest |
| `frontend/` | Next.js 15, React 19, Tailwind 4, `@dnd-kit/core`, vitest + Testing Library + jsdom |
| `mcp/` | `@modelcontextprotocol/sdk`, Express 5, `zod`, vitest |
| `plugin/` | Plain ESM `.mjs`, zero dependencies, Node built-in test runner |

Runtime contracts that other components and users already depend on MUST be preserved:

- Backend on `:4000`, exposing `/health`.
- Frontend on `:3000`.
- MCP on `:5000/mcp`, published to the host as `127.0.0.1:5000` only; overridable for clients via
  `LUMBERJACK_TASKS_MCP_URL`.
- PostgreSQL published on `:5434`.
- Compose services declare healthchecks and `depends_on: condition: service_healthy`; new
  services MUST do the same.

Breaking any published port, endpoint, MCP tool name, or `.claude/ticket-project.json` shape is a
breaking change requiring a MAJOR constitution-compliant review and documentation updates in
`README.md` and `docs/ticket-sync.md`.

## Development Workflow & Quality Gates

- Work on a topic branch off `main`. Keep pull requests focused, and describe the motivation and
  the change.
- Follow existing code style; the codebase is TypeScript throughout.
- Add or update tests for any behavior you change (see Principle II). Run the full suite before
  opening a PR.
- Any change under `plugin/` requires re-reading `docs/ticket-sync.md` first and running the
  plugin tests.
- Any change touching authentication, CORS, rate limiting, password handling, JWT configuration,
  or MCP binding is security-relevant: it requires a regression test and a review against
  Principle III.
- Schema changes require a Prisma migration committed alongside the code.
- User-visible behavior, configuration variables, and ports MUST be reflected in `README.md`;
  plugin internals in `docs/ticket-sync.md`.
- Bugs and features go to public GitHub issues with reproduction steps. **Security
  vulnerabilities MUST NOT be filed as public issues** — use the private flow in `SECURITY.md`.
- Contributions are licensed under the MIT License.

## Governance

This constitution supersedes ad-hoc practice. Where it conflicts with a habit, the constitution
wins; where it conflicts with `CONTRIBUTING.md`, that is a defect to be reconciled explicitly
rather than resolved silently in either direction.

**Amendment procedure.** Amendments are proposed as a pull request that changes this file,
states the rationale, and updates any documentation the change invalidates. An amendment that
relaxes a security control under Principle III MUST additionally spell out the new threat model
and the compensating control.

**Versioning policy.** This document is versioned semantically:

- **MAJOR** — a principle is removed or redefined in a backward-incompatible way; governance is
  materially restructured.
- **MINOR** — a principle or section is added, or existing guidance is materially expanded.
- **PATCH** — clarifications, wording, and typo fixes with no change in meaning.

**Compliance review.** Pull request review MUST verify compliance with these principles. Added
complexity MUST be justified in the PR description; the simplest change that satisfies the
principles is preferred. Spec Kit artifacts (`spec.md`, `plan.md`, `tasks.md`) generated for this
project are evaluated against this constitution before implementation begins.

**Version**: 1.0.0 | **Ratified**: 2026-08-15 | **Last Amended**: 2026-08-15
