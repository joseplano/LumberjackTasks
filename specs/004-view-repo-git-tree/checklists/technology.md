# Technology Verification Checklist: View repo — a graphical tree of the repository history

**Purpose**: Validate that the artifacts specify the technology-specific verification this change
actually needs — Prisma schema/migration/referential semantics, TypeScript type gates, and the
frontend's real (limited) gate set — before implementation begins. These items test what the
artifacts specify, not what code does.
**Created**: 2026-08-21
**Feature**: [spec.md](../spec.md) | [plan.md](../plan.md) | [research.md](../research.md)

**Active profiles**: `prisma`, `database-migrations`, `typescript-node`.

## Prisma — schema and migration integrity

- [x] CHK029 Is `prisma validate` named as a required check for this schema change? [Completeness, Research §R9]
- [x] CHK030 Is a schema-to-migration drift check specified with its concrete command and a pass condition (exit code 0)? [Measurability, Research §R9, Quickstart §1]
- [x] CHK031 Is the shadow-database prerequisite for the drift check stated, together with what must happen when no disposable database is available? [Edge Case, Quickstart §1]
- [x] CHK032 Is the migration's directory name, hand-written-SQL format and absence of `migration_lock.toml` recorded from repository evidence rather than assumed from Prisma defaults? [Traceability, Research §R8]
- [x] CHK033 Is it stated how the migration is applied in both places it runs — the container `CMD` and the test `globalSetup` — so the test suite is known to exercise the migration? [Completeness, Research §R8]
- [x] CHK034 Are the limits of the test-suite gate stated honestly — that it catches missing tables and columns but not differing referential actions? [Clarity, Research §R8]

## Prisma — referential actions and constraint semantics

- [x] CHK035 Is an explicit `onDelete` specified for **every** new relation, rather than relying on Prisma's optionality-dependent default? [Completeness, Research §R7, Data-model]
- [x] CHK036 Is the specific hazard named — that Prisma defaults a required relation to `Restrict` and an optional one to `SetNull` — so the choice is a decision and not an accident? [Clarity, Research §R7]
- [x] CHK037 Is the one relation whose default would change existing product behaviour identified by name, with the behaviour it would break? [Gap closed, Research §R7 — `GitCommitTicket → Ticket` would block deleting any ticket that has a commit link]
- [x] CHK038 Is a regression test required for that relation's delete behaviour, given that no Prisma command can prove it? [Coverage, Research §R9, Quickstart §2]
- [x] CHK039 Are the uniqueness constraints that carry product invariants specified, with the invariant each one enforces? [Traceability, Data-model — `(projectId, name)` for FR-026, `(projectId, sha)` for FR-024/D8, `(commitId, path)` and `(commitId, ticketId)` for FR-026]
- [x] CHK040 Is the decision to avoid an optional self-referencing foreign key for the originating branch recorded with its referential-action rationale? [Traceability, Research §R5]
- [x] CHK041 Is transactional behaviour specified for the write path, so a rejected batch records nothing? [Completeness, Contract §http-api.md §4 rule 11]
- [x] CHK042 Are the requirements clear that a re-sync never rewrites commit-to-branch attribution, and is that expressed as a constraint the storage enforces rather than a convention? [Consistency, Spec §FR-024, Data-model §GitCommit]

## Database migration safety

- [x] CHK043 Is the change identified as purely additive — new enums, new tables, back-relations only, no column altered on an existing table? [Clarity, Data-model preamble]
- [x] CHK044 Are the consequences for existing data specified, or explicitly stated to be none? [Completeness, Data-model — additive only, no backfill of existing tables required]
- [x] CHK045 Are the indexes needed by the read paths specified alongside the queries that need them? [Completeness, Data-model §GitCommit, §GitCommitFile]

## TypeScript type gates

- [x] CHK046 Is the type gate identified per package, rather than assumed uniform across the repository? [Clarity, Plan §Technical Context]
- [x] CHK047 Is it stated explicitly that `frontend/` has **no** `typecheck` script and **no** `lint` script, as verified fact rather than omission? [Gap closed, Research §R10, Plan §Technical Context]
- [x] CHK048 Do the artifacts forbid any task from invoking `npm run typecheck` or `npm run lint` in `frontend/`, and give the reason (a missing-script failure reads as a broken gate)? [Clarity, Plan §Technical Context, Quickstart §5]
- [x] CHK049 Is `next build` named as the sole condition under which a frontend type-safety claim may be made? [Measurability, Research §R10, Quickstart §5]
- [x] CHK050 Are the backend and MCP type gates (`npm run build` → `tsc`) named, so their presence is not confused with the frontend's absence? [Consistency, Plan §Technical Context]

## Determinism and testability of pure logic

- [x] CHK051 Are tie-breaking rules specified for every ordering the geometry function produces, so its output is assertable? [Measurability, Contract §tree-geometry.md rules 1–2]
- [x] CHK052 Is totality specified — empty input, a branch with no commits, and a dangling parent sha — rather than left to throw? [Edge Case, Contract §tree-geometry.md rule 6]
- [x] CHK053 Is purity stated as a requirement (no clock, no randomness, no I/O), with a determinism test required? [Measurability, Contract §tree-geometry.md rules 7, §Required tests]
- [x] CHK054 Are the colour function's required test cases enumerated individually, including the defensive trunk-reported-as-merged case? [Coverage, Contract §tree-geometry.md §A]
- [x] CHK055 Is the test approach constrained so it cannot restate the implementation's own mapping (no table test that iterates the same table)? [Clarity, Contract §tree-geometry.md §A §Required tests]

## Request-size and transport constraints

- [x] CHK056 Is the existing 100 KB body limit recorded as verified repository fact, with the arithmetic showing why an unchunked backfill exceeds it? [Traceability, Research §R2]
- [x] CHK057 Is the batch cap specified as a number the backend enforces, not only as guidance in the tool description? [Measurability, Contract §http-api.md §4 rule 5]
- [x] CHK058 Is the required error-handler change specified, including the status code and the fact that it is currently absent? [Gap closed, Research §R2, Contract §http-api.md §4 rule 10]

## Notes

- Items were checked only where a named passage in `research.md`, `data-model.md`, `plan.md`,
  `quickstart.md` or a contract supports them. The supporting section is cited on every item.
- Four items — CHK037, CHK047, CHK058 and CHK031 — record **gaps that planning found and closed**.
  CHK037 is the most consequential: adding `GitCommitTicket` without an explicit
  `onDelete: Cascade` would have made Prisma default the required relation to `Restrict` and
  silently broken deletion of any ticket that has a commit link, with no failing test to catch it
  unless one is written on purpose.
- CHK031 and CHK034 exist so that a check which *cannot* run on a given machine is recorded as not
  run, rather than quietly reported as passed.
