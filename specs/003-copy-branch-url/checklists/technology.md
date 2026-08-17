# Technology Verification Checklist: Copy the branch URL, not just the branch name

**Purpose**: Confirm that the plan and tasks carry the technology-specific verification this repository's stack actually requires
**Created**: 2026-08-16
**Feature**: [spec.md](../spec.md)
**Active profiles**: `typescript-node` (frontend package). `prisma` and `database-migrations` are present in the repository but **not triggered**: this feature changes no schema, no migration, no relation, no index and no referential action.

## typescript-node

- [x] TCH001 - Is the repository-authoritative test command named, per package? [plan.md §Testing Strategy, research.md §R10] — `cd frontend && npm test` as the covering suite; `backend`, `mcp` and `plugin` suites as regressions
- [x] TCH002 - Is a typecheck gate named, and is it one the repository actually supports? [plan.md §Testing Strategy] — `cd frontend && npx tsc --noEmit`; `frontend/tsconfig.json` already sets `"noEmit": true` and `"strict": true`. There is no `typecheck` npm script, and none is added for this feature
- [x] TCH003 - Is the plugin test command written in the form the constitution requires on Windows? [Constitution §II, plan.md §Testing Strategy, tasks.md] — `node --test plugin/tests/*.test.mjs`, never the directory form
- [x] TCH004 - Does every behaviour change have a test task that precedes it? [tasks.md Phase 2, T004-T008 before T009-T010; Phase 6, T016 before T017] — unit tests for the derivation and component tests for both payload kinds are written before the production code they cover, and the behaviour change added by the two 2026-08-17 rulings has its own RED task (T016, covering both the path-shape query vectors and the Azure DevOps fragment vectors) ahead of its implementation task (T017)
- [x] TCH014 - Does the appended work re-run the same gate the original work was measured against, rather than relying on the earlier green run? [tasks.md T018 versus T012-T013] — `cd frontend && npm test`, `cd frontend && npx tsc --noEmit` and the three regression suites are re-run after T017; the earlier T012/T013 results (22 files / 162 tests, backend 282, mcp 80, plugin 21) stand only as the pre-change baseline
- [x] TCH015 - Is the changed module still free of new runtime dependencies after both rulings? [contracts/branchUrl.md §Stage 1 rules 6a-6c, plan.md §Technical Context] — reducing an address to `origin + pathname + search` (every shape, fragment dropped) and then to `origin + pathname` (path shapes only) uses the platform `URL` object the module already constructs for scheme validation; `URL` exposes both `search` and `pathname` directly, so the second ruling adds no parsing of its own and nothing is added to `frontend/package.json`
- [x] TCH005 - Is the new module placed and imported the way this package already does it? [plan.md §Project Structure, research.md §R7] — a single-purpose pure module in `frontend/src/lib/`, tested from `frontend/src/__tests__/` through the `@/` alias configured in both `vitest.config.ts` and `tsconfig.json`, matching `moveTicketLocally.ts`
- [x] TCH006 - Is the absence of any new runtime dependency stated? [plan.md §Technical Context] — the platform `URL` constructor and `encodeURIComponent` only; no package is added to `frontend/package.json`
- [x] TCH007 - Is the type surface of the new export defined precisely enough to typecheck under `strict`? [contracts/branchUrl.md] — `(gitRepoUrl: string, branch: string) => string | null`; the caller consumes it with `??`, so no non-null assertion is introduced
- [x] TCH008 - Is a build gate correctly scoped in or out, with a reason? [plan.md §Testing Strategy, research.md §R10] — `next build` is deliberately not a gate: the change adds no route, no server/client boundary and no build-time behaviour, and `tsc --noEmit` covers its type surface

## prisma / database-migrations *(not triggered — recorded for the reviewer)*

- [x] TCH009 - Is it established that no schema element changes? [Spec §FR-008, data-model.md] — no table, column, index, constraint, enum, default, relation optionality or referential action is touched, so no `prisma validate`, no migration diff and no referential-action review is applicable
- [x] TCH010 - Is it established that no migration is required, so the constitution's "schema changes require a Prisma migration" rule is satisfied vacuously? [plan.md §Constitution Check V, data-model.md]

## Cross-cutting

- [x] TCH011 - Is accessibility verification included, given that an accessible name changes? [plan.md §Testing Strategy, tasks.md T007] — the component tests query the control by its accessible name, so an incorrect or stale `aria-label` fails the suite rather than passing silently
- [x] TCH012 - Is the non-secure-context path covered, given it is a real deployment shape for this project? [Spec §FR-007/SC-007, plan.md §Testing Strategy, tasks.md T008] — the existing fallback test is extended to the URL payload
- [x] TCH013 - Is the full-suite gate stated as a completion condition rather than left implicit? [plan.md §Testing Strategy, tasks.md T012-T013, quickstart.md]
