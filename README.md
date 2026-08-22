> ⚠️ **Run this on `localhost` only.** Lumberjack Tasks is single-tenant: every authenticated user can see and modify **all** data. It has **no** isolation between users — never expose it to an untrusted network or the public internet. See [Security](#-security).

```text
██╗     ██╗   ██╗███╗   ███╗██████╗ ███████╗██████╗      ██╗ █████╗  ██████╗██╗  ██╗
██║     ██║   ██║████╗ ████║██╔══██╗██╔════╝██╔══██╗     ██║██╔══██╗██╔════╝██║ ██╔╝
██║     ██║   ██║██╔████╔██║██████╔╝█████╗  ██████╔╝     ██║███████║██║     █████╔╝
██║     ██║   ██║██║╚██╔╝██║██╔══██╗██╔══╝  ██╔══██╗██   ██║██╔══██║██║     ██╔═██╗
███████╗╚██████╔╝██║ ╚═╝ ██║██████╔╝███████╗██║  ██║╚█████╔╝██║  ██║╚██████╗██║  ██╗
╚══════╝ ╚═════╝ ╚═╝     ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚════╝ ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝
                        T   A   S   K   S
```

# Lumberjack Tasks

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-355%20passing-brightgreen.svg)](#-development)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![Made for Claude Code](https://img.shields.io/badge/made%20for-Claude%20Code-8A2BE2.svg)](https://claude.com/claude-code)

A kanban ticket system that **Claude Code drives itself**. Claude creates tickets before it
starts work, moves them across the board as it goes, and registers the real time and tokens each
ticket cost.

The repo is three things: the **stack** (backend, frontend, MCP server), a **Claude Code plugin**,
and the **marketplace** that publishes the plugin.

## Table of contents

- [Highlights](#highlights)
- [Requirements](#requirements)
- [Quickstart](#quickstart)
- [Install the plugin](#install-the-plugin)
- [Opt a repo in](#opt-a-repo-in)
- [Completion columns & automatic sweep](#completion-columns--automatic-sweep)
- [Git branch on a ticket](#git-branch-on-a-ticket)
- [View repo](#view-repo)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [🔒 Security](#-security)
- [Development](#-development)
- [Things to keep in mind](#things-to-keep-in-mind)
- [Contributing](#contributing)
- [License](#license)

## Highlights

- **Self-driving board** — Claude Code creates and moves tickets automatically as it works, via
  an MCP server, so the board reflects reality without manual updates.
- **Real cost tracking** — every ticket records the actual minutes and LLM tokens it consumed.
- **Kanban you can also use by hand** — projects, columns, tickets, subtickets, labels and phases
  (epics), with drag-and-drop.
- **One-time plugin install** — a single Claude Code plugin carries the skill, the SessionStart
  hook and the MCP registration to every repo you opt in.

## Requirements

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose (the fastest path).
- For local development without Docker: **Node.js ≥ 20** and a **PostgreSQL 16** instance.
- [Claude Code](https://claude.com/claude-code) to use the plugin.

## Quickstart

```bash
git clone https://github.com/joseplano/LumberjackTasks.git
cd LumberjackTasks
docker compose up -d
```

- Board (frontend): <http://localhost:3000>
- Backend API: <http://localhost:4000>
- MCP server: <http://127.0.0.1:5000/mcp>

> **Before any non-local deployment**, set a strong `JWT_SECRET` (`openssl rand -hex 32`) — see
> [Configuration](#configuration). And read [🔒 Security](#-security) first.

## Install the plugin

Install the plugin **once** — it then applies to every repo you opt in. In Claude Code:

```
/plugin marketplace add joseplano/LumberjackTasks
/plugin install lumberjack-tasks@lumberjack-tasks
/reload-plugins
```

A marketplace is just a git repo with a JSON index — nothing is hosted anywhere. If you have the
repo cloned but not pushed, point the marketplace at the local path instead:

```
/plugin marketplace add /absolute/path/to/LumberjackTasks
/plugin install lumberjack-tasks@lumberjack-tasks
```

> A **local-path install runs the plugin live from that directory**, not from a frozen copy. Edits
> under `plugin/` take effect in the next session with no `/plugin update` — convenient while
> developing, but a broken uncommitted edit reaches every repo you work in, and **moving or
> deleting the directory breaks the plugin everywhere**. Installing from a git remote gives you the
> usual frozen copy pinned to a commit.

That single install carries the `ticket-sync` skill, the SessionStart hook and the MCP server
registration. There is nothing to copy into your projects.

## Opt a repo in

In any repo you want tracked:

```
/ticket-init
```

That links the repo to a ticket project and writes `.claude/ticket-project.json`. Repos you never
opt in stay untouched — the plugin is silent in them.

## Completion columns & automatic sweep

In a project's settings, under **Kanban columns**, an operator may designate exactly one column
as that project's **completion column** (an automated agent can do the same via the MCP tool
`manage_columns` with `action: 'set_completion'`). A project has **at most one** completion
column: designating a second one moves the designation, and it can be cleared entirely.
**Existing projects start with none**, so nothing changes for a project until an operator opts in.

Once a completion column is set, moving a ticket into it re-checks the board: if no ticket remains
in any *other* column of the project, the backend automatically sweeps every ticket out of the
completion column, in the same transaction as the move that triggered it. Nothing is deleted —
each swept ticket stays in the project backlog marked completed, keeping its history, phase,
label, nesting and token/time totals, and it keeps counting in every report and metric. The
backlog shows completed tickets with a `Completed` status (and a machine-readable `completed:
true` flag) that's visually distinct from tickets still on the board, alongside a **Restore**
action that puts a ticket back on the board through the existing move — there is no separate
restore endpoint.

A few implementation notes for anyone driving the API directly:

- `GET /projects/:projectId/tickets` takes an optional `placement` query parameter
  (`board` | `completed` | `all`; defaults to `all`, so existing callers are unaffected). The
  board UI calls it with `placement=board`.
- The move response gained an additive `sweep` field — `null` when no sweep fired. When a sweep
  does fire, the moved ticket's own `columnId` comes back `null`; that's the expected outcome of
  landing in a now-swept completion column, not an error.
- A sweep emits one `board.swept` live-update event, so any board already open elsewhere reflects
  the emptied columns without a manual refresh.

## Git branch on a ticket

A ticket shows **the git branch the agent reported** while working on it. It is a mirror of what
the agent saw in the repository, and it is **read-only in the UI**: the branch block in the ticket
detail cannot be edited, and neither the create nor the edit form has a branch field. Nothing on
the board invents or derives the value, and it is never rewritten for display — the only writer is
the agent, through the `branch` field of the ticket-writing MCP tools (`create_ticket`,
`update_ticket`, `create_subticket` and `update_subticket`). The backend stores the reported name
as it was given, apart from trimming surrounding whitespace.

- The ticket detail shows a highlighted block under the title with a branch icon, the branch in a
  monospaced typeface and a copy button. The button copies a URL to that branch in the project's
  repository when one is configured, or the branch name otherwise, and labels itself accordingly
  (`Copy branch URL` / `Copy branch name`). Board cards carry the same value as a compact chip;
  cards without one carry nothing.
- **Subtickets inherit their parent's branch** while they have none of their own, shown with a
  muted `(heredada de #<parent number>)` marker. As soon as the agent reports a branch on the
  subticket itself, its own value is shown and the marker disappears.
- `Sin rama aún` means the agent has not reported a branch for that ticket (nor, for a subticket,
  for its parent). In that state no branch-like text is shown anywhere for the ticket.

Reporting a branch changes nothing else: no total, count or duration in any report or metric is
derived from it.

## View repo

A project board's header carries a **View repo** control next to **View backlog** and
**Add ticket**. It opens a read-only screen that draws the project's recorded git history as an
SVG tree: the trunk runs as a single horizontal line, oldest commit on the left, and every other
branch gets its own lane below it, forking from and — once merged — rejoining the trunk at the
recorded commit. Clicking a commit circle opens its description, date, linked tickets and changed
files; clicking a branch lane or its label opens the branch's tickets, changed files and a
description composed from what was recorded about it (its name, state and commit messages) — no
separate branch description is authored or stored. Any ticket link the screen had to guess rather
than read from a report is labelled **inferred**, never presented as if it were reported.

**Colour and precedence.** Each branch gets exactly one of four colours, decided by trying these
rules in order and stopping at the first match:

1. it's the trunk → **blue**, always, regardless of anything else reported about it;
2. it has been merged into the trunk → **grey** — this is checked *before* rule 3, so a branch
   that is both merged and has a dirty working tree is grey, not yellow;
3. it has uncommitted working-tree changes, or has no commit of its own yet → **yellow**;
4. otherwise → **green**.

Having been pushed to a remote is deliberately **not** a colour and adds no fifth state — a pushed
branch is coloured by the same four rules as any other.

**It's a mirror, and it can be stale.** Nothing here is computed live from the repository; the
screen only ever shows what a sync last reported, together with the time of that sync. A history
that has never been synced shows an explanation of how to sync it, not a blank canvas or invented
commits — and a failure to load is shown with its reason, never presented as an empty history.

**Read-only, and single-tenant like the rest of the board.** The screen cannot create, modify or
delete anything — there is no sync control on it, only instructions, because a sync button here
would make the frontend a second write path into repository history. As with every other screen,
there is no per-project or per-user ownership: any authenticated user sees the same mirror for
every project (see [Security](#-security)).

**Syncing and backfilling.** The agent is the only writer, through the `sync_git_history` MCP
tool driven by the `lumberjack-tasks:ticket-sync` skill — never a hook, and never something the
browser triggers. The skill syncs deliberately after committing and after changing branch. A
one-time backfill walks the *whole* existing history the same way: branch by branch, trunk first,
each with `git log --first-parent`, never `git log --all` — `--all` doesn't report which branch a
commit belongs to, so it can't supply what a sync requires and can't be used for the backfill
either.

## Configuration

Copy each `*.env.example` to its `.env` and adjust. Key variables:

### Backend (`backend/.env`)

| Variable      | Default                          | Notes |
|---------------|----------------------------------|-------|
| `DATABASE_URL`| `postgresql://…@127.0.0.1:5434/lumberjack_tasks` | PostgreSQL connection string. |
| `JWT_SECRET`  | *(required in production)*        | Strong secret to sign JWTs. Generate with `openssl rand -hex 32`. In production the server **refuses to start** with a weak/missing value; outside production a random per-run secret is used if unset (sessions reset on restart). |
| `CORS_ORIGIN` | `http://localhost:3000`           | Comma-separated list of allowed browser origins. |
| `PORT`        | `4000`                            | Backend port. |

### MCP server (`mcp/.env`)

| Variable       | Default              | Notes |
|----------------|----------------------|-------|
| `MCP_HOST`     | `127.0.0.1`          | Bind address. **Keep it on loopback** unless behind an authenticated proxy. |
| `BACKEND_URL`  | `http://localhost:4000` | Where the backend lives. |
| `MCP_JWT`      | *(empty)*            | Static backend JWT (takes precedence; backend tokens expire after 12 h). |
| `MCP_EMAIL` / `MCP_PASSWORD` | *(empty)* | Credentials for automatic login + re-login on expiry. |

To point the plugin at a hosted stack, set the MCP URL before starting Claude Code:

```bash
export LUMBERJACK_TASKS_MCP_URL=https://tickets.example.com/mcp
```

### Frontend (`frontend/.env.local`)

| Variable             | Default                 | Notes |
|----------------------|-------------------------|-------|
| `NEXT_PUBLIC_API_URL`| `http://localhost:4000` | Backend URL exposed to the browser. |

## Architecture

```
┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│  Frontend    │  HTTP  │   Backend    │  SQL   │  PostgreSQL  │
│  Next.js 15  │ ─────▶ │  Express 5   │ ─────▶ │      16      │
│  :3000       │        │  Prisma · JWT│        │  :5434       │
└──────────────┘        └──────▲───────┘        └──────────────┘
                               │ HTTP (bot credentials)
                        ┌──────┴───────┐        ┌──────────────┐
                        │  MCP server  │ ◀────  │  Claude Code │
                        │  :5000 (lo)  │  MCP   │   + plugin   │
                        └──────────────┘        └──────────────┘
```

- **backend/** — Express 5 + TypeScript + Prisma 7, PostgreSQL. JWT auth, kanban domain logic,
  reports, and a Server-Sent-Events stream for live board updates.
- **frontend/** — Next.js 15 + React 19, the kanban board UI.
- **mcp/** — Model Context Protocol server exposing the backend as tools Claude Code can call.
- **plugin/** — the Claude Code plugin: `ticket-sync` skill, SessionStart hook, MCP registration.

## 🔒 Security

**Read [SECURITY.md](SECURITY.md) before deploying anywhere other than your own machine.**

Lumberjack Tasks is **single-tenant by design**: once authenticated, every user can read and
modify **all** projects and tickets of **all** users — there is no ownership or role model yet.
It is meant for a single user or a small, trusted team on `localhost`. **Do not run it as a
public multi-user service.** Per-user isolation is planned but not implemented.

Hardening that *is* in place: mandatory strong `JWT_SECRET` (no published default), `helmet`
security headers, rate limiting on auth endpoints, restrictive CORS default, bcrypt passwords
(min 8 chars), and the MCP server bound to loopback by default. Details and how to report a
vulnerability are in [SECURITY.md](SECURITY.md).

## 🧪 Development

```bash
cd backend && npm test                    # backend tests (integration + unit)
cd mcp && npm test                        # MCP server tests
cd frontend && npm test                   # frontend tests
node --test plugin/tests/*.test.mjs       # plugin hook + token-script tests
```

The plugin ships with no dependencies and no `node_modules` — it is copied verbatim to users'
machines — so its tests run on Node's built-in runner. Use the glob form above; `node --test
plugin/tests` (directory form) fails with `MODULE_NOT_FOUND` on Windows.

## Things to keep in mind

- **Change `JWT_SECRET`** for anything beyond local dev — the server enforces this in production.
- **Keep the MCP server on `127.0.0.1`.** It has no auth of its own and acts with the bot's
  credentials; never expose it to an untrusted network.
- **Data is shared across all users** (see [Security](#-security)).
- **Editing the plugin:** before touching anything under `plugin/`, read the "Cómo está armado el
  plugin, y las cuatro trampas" section of [docs/ticket-sync.md](docs/ticket-sync.md). Three of
  those four mistakes break the plugin *silently* — most notably, adding a `"hooks"` or `"skills"`
  key to `plugin/.claude-plugin/plugin.json` disables the plugin's MCP server, with an error
  message that mentions neither.
- **Manually-registered MCP shadowing:** if you registered the MCP server by hand
  (`claude mcp list`), Claude Code suppresses the plugin's server when both point at the same URL.
  Remove the manual one after installing the plugin: `claude mcp remove <name>`.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Security issues:
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 José Plano. Free for personal and commercial use, modification and
redistribution; provided "as is", without warranty of any kind.
