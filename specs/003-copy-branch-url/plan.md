# Implementation Plan: Copy the branch URL, not just the branch name

**Branch**: `003-copy-branch-url` | **Date**: 2026-08-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-copy-branch-url/spec.md`

**Base branch**: `002-ticket-git-branch-view` (stacked, by explicit human decision — `main` has neither the branch field nor the copy control this feature modifies)

## Summary

The ticket branch block's copy control currently copies the branch name. It will instead copy a URL that opens that branch in the project's repository, whenever such a URL can be derived from the project's stored repository URL, and keep copying the branch name when it cannot. The derivation is a pure, UI-free function in `frontend/src/lib/branchUrl.ts`; the component change in `frontend/src/components/TicketDetailModal.tsx` is limited to choosing the payload and naming the control accordingly. Nothing outside `frontend/` changes except the README sentence that describes the control.

## Technical Context

**Language/Version**: TypeScript 6 (frontend package), targeting ES2022, `strict: true`

**Primary Dependencies**: Next.js 15, React 19 — no new dependency is added; URL handling uses the platform `URL` and `encodeURIComponent`

**Storage**: N/A — this feature reads two values that are already in the rendered component's props/state and persists nothing

**Testing**: vitest + Testing Library + jsdom (`cd frontend && npm test`), typecheck with `npx tsc --noEmit` in `frontend/` (`noEmit` is already set in `frontend/tsconfig.json`)

**Target Platform**: browsers served by the Next.js frontend on `:3000`, including non-secure contexts behind a plain-HTTP LAN reverse proxy

**Project Type**: web application — frontend package only for this feature

**Performance Goals**: no measurable cost; the derivation is a synchronous string transformation performed once per copy press (and once per render for the control's name)

**Constraints**: no new dependency; no backend, MCP, plugin, database or migration change; the branch text shown to the reader is unchanged; the existing clipboard mechanism and confirmation are unchanged

**Scale/Scope**: one new ~60-line module, one modified component region (the copy handler and the copy button), one new unit test file, additions to one existing component test file, one README sentence

## Constitution Check

*GATE: evaluated against `.specify/memory/constitution.md` v1.0.0 before Phase 0 and re-confirmed after Phase 1.*

| Principle | Assessment |
|---|---|
| **I. Module Boundaries & Single Source of Truth** | PASS. The change lives entirely in `frontend/`, which is defined as "a consumer of the backend HTTP API only". No domain rule is duplicated: a branch URL is a presentation-layer derivation of two values the backend already returns, not domain state. The backend gains no responsibility and the MCP server is untouched. |
| **II. TypeScript & Test Discipline (NON-NEGOTIABLE)** | PASS. New code is TypeScript. Every behaviour change ships with tests: unit tests for the derivation covering all four forges and every malformed-input class, plus component tests for both payload kinds and the control's accessible name. The full four-package suite is run before completion, with the plugin suite in the mandatory glob form. |
| **III. Security Posture Preservation & Scope Honesty** | PASS. No authentication, CORS, rate limiting, password, JWT or MCP-binding surface is touched, so this is not a security-relevant change under the constitution's definition. Two hygiene points are still respected: the repository URL is project data already shown in the project form, so putting it on the clipboard exposes nothing new to the person already viewing the project; and the derivation never executes or fetches the URL, it only builds a string. Nothing in this feature implies per-user isolation. |
| **IV. Plugin Portability & Silent-Failure Avoidance** | PASS by non-involvement. Nothing under `plugin/` changes, no `plugin.json` key is added, and no plugin name is affected. The plugin suite is still run as a regression gate. |
| **V. Configuration, Secrets & Reproducible Environments** | PASS. No new environment variable, no `.env.example` entry, no schema change and therefore no Prisma migration. `README.md` is updated because user-visible behaviour changes (FR-010), as the principle requires. |
| **Development Workflow & Quality Gates** | PASS with one documented deviation: the workflow says "work on a topic branch off `main`", and this branch is cut from `002-ticket-git-branch-view` instead. Recorded in Complexity Tracking below. |

No violation requires a Complexity Tracking justification for added complexity; the single deviation is topological, not architectural.

## Project Structure

### Documentation (this feature)

```text
specs/003-copy-branch-url/
├── plan.md              # This file
├── research.md          # Phase 0 — forge URL shapes and normalisation decisions
├── data-model.md        # Phase 1 — the derived Branch URL and its inputs
├── quickstart.md        # Phase 1 — how to verify by hand
├── contracts/
│   └── branchUrl.md     # Phase 1 — the buildBranchUrl contract
├── checklists/
│   └── requirements.md  # Pre-implementation readiness gate
└── tasks.md             # Phase 2 — /speckit-tasks output
```

### Source Code (repository root)

```text
frontend/
├── src/
│   ├── lib/
│   │   ├── branchUrl.ts            # NEW — buildBranchUrl(gitRepoUrl, branch): string | null
│   │   └── types.ts                # unchanged — ProjectDetail already carries gitRepoUrl
│   ├── components/
│   │   └── TicketDetailModal.tsx   # MODIFIED — payload choice + control naming only
│   └── __tests__/
│       ├── branchUrl.test.ts       # NEW — unit tests for the derivation
│       └── ticketDetail.test.tsx   # MODIFIED — component tests for both payload kinds
└── (no other frontend file changes)

README.md                            # MODIFIED — one sentence describing the copy control
```

**Structure Decision**: the repository is the four-package web application described in the constitution (`backend/`, `frontend/`, `mcp/`, `plugin/`). This feature touches `frontend/` only, following that package's existing conventions: pure helpers live as single-purpose modules in `frontend/src/lib/` (as `moveTicketLocally.ts` does), and all frontend tests live in `frontend/src/__tests__/` and import through the `@/` alias configured in `vitest.config.ts` and `tsconfig.json`.

## Design

### The derivation — `frontend/src/lib/branchUrl.ts`

A single exported pure function:

```ts
export function buildBranchUrl(gitRepoUrl: string, branch: string): string | null
```

It returns the branch URL, or `null` when no usable repository address can be read from `gitRepoUrl`. It is total: it throws for no input, performs no I/O, and reads no globals other than the platform `URL` constructor. The full behaviour is specified in [contracts/branchUrl.md](./contracts/branchUrl.md); the reasoning behind each rule is in [research.md](./research.md).

Two stages, in order:

1. **Normalise** the stored value to a repository address — trim, SSH-to-https, strip trailing `.git`, strip trailing `/`, and reject anything that is not `http`/`https` (FR-003, FR-003a–c). Rejection is `null`.
2. **Shape** the branch URL from the host — GitHub/GitLab/Bitbucket/Azure DevOps, with the GitHub shape as the fallback for any other host (FR-003d, FR-005). The branch stays literal in a path segment and is `encodeURIComponent`-encoded in the Azure DevOps query parameter, which is also appended with `&` when the address already carries a query (FR-005a).

An empty or whitespace-only `branch` is not a case this function needs to handle for the UI — the block renders no copy control without an effective branch (FR-009) — but the contract still defines it (`null`) so the function is total and the component cannot be surprised.

### The component — `frontend/src/components/TicketDetailModal.tsx`

The modal already receives `project: ProjectDetail`, and `ProjectDetail extends Project`, which carries `gitRepoUrl: string`. No prop, no fetch and no state is added.

Inside the branch block, where `detail.effectiveBranch` is already known to be present:

- Derive once per render: `const branchUrl = buildBranchUrl(project.gitRepoUrl, detail.effectiveBranch)`.
- The copy handler copies `branchUrl ?? detail.effectiveBranch`. `copyBranch` keeps its exact structure — primary clipboard path, hidden-textarea fallback, `confirmCopied()` only on success — because the payload is decided before it is called (FR-007). Its doc comment is updated so it no longer claims the branch text is what is copied.
- The button's `aria-label` and `title` both become `branchUrl ? 'Copy branch URL' : 'Copy branch name'` (FR-006). The visible text stays `Copy` (spec Clarifications).

Nothing else in the block changes: the icon and its `<title>`, the monospaced branch text, the inheritance marker, the `Sin rama aún` empty state and the `Copiado` status all stay exactly as feature 002 left them (FR-009).

### Documentation

`README.md` currently says the ticket detail shows the branch "with a copy button". That sentence gains what the button copies: the branch URL when the project has a repository URL configured, the branch name otherwise (FR-010). No other document describes this control — `docs/ticket-sync.md` covers plugin internals and is untouched.

## Testing Strategy

Constitution Principle II requires tests with every behaviour change and the full suite green before a PR.

**Unit — `frontend/src/__tests__/branchUrl.test.ts`** (new). One case per contract row: GitHub, GitLab, Bitbucket, Azure DevOps, unrecognised host; subdomain/self-hosted host matching; SSH form; `.git` suffix; trailing slash; surrounding whitespace; empty string; whitespace-only string; non-URL value; unsupported scheme; branch containing slashes for a path forge and for the query forge; a repository address that already carries a query string; and an empty branch. These cover SC-005 without rendering anything, which is the point of FR-011.

**Component — `frontend/src/__tests__/ticketDetail.test.tsx`** (extended, existing cases preserved). The existing fixture has `gitRepoUrl: ''`, so the current copy tests keep passing unchanged and stand as the regression guard for FR-004. Added: with a GitHub `gitRepoUrl`, pressing copy writes the branch URL and the accessible name reads `Copy branch URL`; with an empty `gitRepoUrl`, the accessible name reads `Copy branch name`; and the non-secure-context fallback path copies the URL too (FR-007, SC-007).

**Authoritative commands** (from the constitution, run from the repository root on Windows):

```bash
cd frontend && npm test                    # vitest — the suite that covers this change
cd frontend && npx tsc --noEmit            # typecheck (frontend/tsconfig.json already sets noEmit)
cd backend && npm test                     # regression
cd mcp && npm test                         # regression
node --test plugin/tests/*.test.mjs        # regression — glob form is mandatory on Windows
```

`next build` is not required as a gate: `tsc --noEmit` covers the type surface of a change that adds no route, no server component boundary and no build-time behaviour.

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
|---|---|---|
| Branch cut from `002-ticket-git-branch-view` instead of `main`, contrary to "work on a topic branch off `main`" | This feature modifies the copy control and the branch field that feature 002 introduced. 002 is committed and pushed but deliberately unmerged. | Cutting from `main` leaves nothing to modify — neither the control nor the branch field exists there — so the work could not be written, let alone tested. The two branches will be merged in order. Explicit human decision, recorded in the approved design. |
