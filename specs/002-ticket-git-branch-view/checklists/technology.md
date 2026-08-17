# Technology Verification Checklist: Prisma / migrations / TypeScript

**Purpose**: Validate that the plan and tasks **specify** the technology-specific verification
this change requires, before implementation begins
**Created**: 2026-08-16
**Feature**: [spec.md](../spec.md)
**Active profiles**: `prisma`, `database-migrations`, `typescript-node`
**Audience**: The implementing agent and the human reviewer, before implementation starts

> These items ask whether the required verification is **specified** in plan.md / tasks.md /
> data-model.md — not whether it has been run. Running it belongs to implementation.

## Prisma schema semantics

- [x] CHK051 - Is the shape of the schema change stated precisely (scalar vs relation, nullability, default, index, uniqueness)? [Clarity, data-model.md §Stored change]
- [x] CHK052 - Is it stated explicitly whether this change introduces any referential action, rather than left to be inferred from optionality? [Completeness, data-model.md §Referential actions]
- [x] CHK053 - Are the **existing** relations' referential actions enumerated with the requirement that they remain byte-for-byte unchanged? [Completeness, data-model.md §Referential actions]
- [x] CHK054 - Is the load-bearing reason for `Ticket.column`'s explicit `onDelete: Restrict` recorded, so a future regeneration cannot silently relax it? [Traceability, data-model.md, research.md R3]
- [x] CHK055 - Is a `prisma validate` step specified? [Completeness, quickstart.md §2, plan.md §Testing Strategy]
- [x] CHK056 - Is a schema-to-migration drift check (`prisma migrate diff`) specified, with the expected result stated as "no difference"? [Completeness, Measurability, quickstart.md §2]
- [x] CHK057 - Is the decision to add **no** index and **no** unique constraint justified rather than merely omitted? [Clarity, research.md R3, Spec §FR-004]

## Migration safety

- [x] CHK058 - Is the migration's exact statement content specified, and are forbidden statement classes enumerated? [Completeness, Measurability, data-model.md §Migration]
- [x] CHK059 - Is an explicit check specified that the migration SQL contains no `CONSTRAINT`, `REFERENCES`, or index statement — the signature of a rewritten referential action? [Coverage, data-model.md, plan.md §Testing Strategy]
- [x] CHK060 - Is the backfill expectation stated explicitly (that there is none, and why that is correct)? [Completeness, data-model.md, Spec §FR-003]
- [x] CHK061 - Is locking/table-rewrite behavior on a populated database addressed? [Non-Functional, data-model.md §Migration, research.md R4]
- [x] CHK062 - Is a rollback path stated, including what data is lost? [Recovery, data-model.md §Migration]
- [x] CHK063 - Is it stated how and where the migration gets applied, and that the test suite exercises it? [Traceability, research.md R4, quickstart.md §3]
- [x] CHK064 - Is the survival of the SQL-only partial unique index from feature 001 — invisible to `prisma migrate diff` by design — covered by an explicit separate check? [Coverage, Gap-closure, research.md R3 item 4]
- [x] CHK065 - Is the migration directory naming consistent with the repository's existing convention? [Consistency, data-model.md, research.md R4]

## TypeScript / build / test verification

- [x] CHK066 - Are the repository-authoritative test commands named per package, rather than generically? [Clarity, plan.md §Testing Strategy, quickstart.md §3]
- [x] CHK067 - Is a typecheck/build step specified for every package whose types this change crosses? [Coverage, plan.md §Testing Strategy, quickstart.md §4]
- [x] CHK068 - Is the plugin suite's mandatory glob invocation form specified, rather than the directory form that fails on this platform? [Clarity, Constitution §II, plan.md, contracts/ui-and-skill.md]
- [x] CHK069 - Is integration coverage — not unit coverage alone — required for the changed HTTP behavior? [Completeness, Constitution §II, plan.md §Testing Strategy]
- [x] CHK070 - Is a regression expectation stated for the existing suites, including what it means if an existing assertion needs editing? [Consistency, plan.md §Testing Strategy]
- [x] CHK071 - Is the requirement that all new stack code be TypeScript, not JavaScript, reflected in the planned file list? [Consistency, Constitution §II, plan.md §Project Structure]

## Cross-layer propagation

- [x] CHK072 - Is every consumer of the changed read shape identified (backend response, shared frontend types, detail component, card component, MCP relay)? [Coverage, plan.md §Project Structure, contracts/]
- [x] CHK073 - Is it specified which consumers are deliberately **not** propagated to (backlog item shape, create/edit form, reports), so their absence is a decision rather than an oversight? [Coverage, Gap-closure, contracts/rest-api.md, contracts/ui-and-skill.md]
- [x] CHK074 - Is the query-count expectation for the list read specified, given the added relation load? [Non-Functional, research.md R2, plan.md §Performance Goals]
- [x] CHK075 - Is it specified that the derivation lives in exactly one layer, with the others forbidden from reimplementing it? [Consistency, research.md R1, contracts/mcp-tools.md §Explicitly forbidden]
- [x] CHK081 - Is it specified that the relation loaded to resolve the parent's value must be consumed and dropped rather than serialized, so it cannot leak into the published shape as an unintended field? [Gap-closure, Spec §FR-015a, research.md R2, contracts/rest-api.md]
- [x] CHK082 - Is it specified that ticket objects **nested** inside a read response (the `subtickets` array) carry the same three fields, given that the shared frontend type declares them as required? [Coverage, Gap-closure, Spec §FR-015, data-model.md §Read shape]

## Constitution-specific gates for touched packages

- [x] CHK076 - Is the prohibition on `plugin/` gaining a runtime dependency or `node_modules` restated for this change? [Dependency, Constitution §IV, contracts/ui-and-skill.md]
- [x] CHK077 - Is the requirement to read `docs/ticket-sync.md` before editing anything under `plugin/` captured as a step? [Traceability, Constitution §IV]
- [x] CHK078 - Is `plugin/.claude-plugin/plugin.json` explicitly listed as not-to-be-modified, with the silent MCP-server failure mode noted? [Coverage, Constitution §IV, plan.md, contracts/ui-and-skill.md]
- [x] CHK079 - Is it stated that no MCP tool name changes, and that renaming one would be a breaking change? [Consistency, Constitution §Runtime Contracts, contracts/mcp-tools.md]
- [x] CHK080 - Is the absence of any new environment variable stated, so the `.env.example` obligation is knowingly not triggered? [Completeness, Constitution §V, plan.md §Constitution Check]
- [x] CHK085 - Are the Prisma CLI invocations written into the artifacts valid for the version actually installed in `backend/`, verified against that CLI's own `--help`, rather than carried over from an earlier major version? [Clarity, Measurability, Gap-closure, quickstart.md §2, research.md R3, tasks.md T006]

## Notes

- **CHK064** is the item most likely to be skipped by a routine check and is the reason this
  gate exists. `prisma migrate diff` compares the migration history against the Prisma
  datamodel; the partial unique index `kanban_columns_projectId_completion_key` exists only in
  feature 001's hand-written `migration.sql` because Prisma's schema language cannot express a
  filtered unique index. A drift check would therefore report "no difference" even if that index
  had been dropped. It is asserted separately for that reason.
- **CHK081** and **CHK082** were added during the first analyze pass, which found two real
  defects: the planned `include` of the parent relation would have serialized a `parent` object
  into every ticket in the public payload (a fourth added field contradicting
  `contracts/rest-api.md`), and the `subtickets` array nested in the detail response would have
  omitted the three fields while the shared frontend `Ticket` type declares them as required —
  a type that would have been dishonest at runtime. Both were repaired in spec, contracts,
  research, data-model, plan, and tasks before this gate was marked complete.
- **CHK085** was added after the documented drift check proved unrunnable as written. The
  artifacts specified `prisma migrate diff --from-migrations ./prisma/migrations
  --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url <db>`, a Prisma 6 command,
  while `backend/` has Prisma **7.8.0** installed. In Prisma 7 `--to-schema-datamodel` is
  `--to-schema`, `migrate diff` has no `--shadow-database-url`, and `--from-migrations` aborts
  here with `Could not determine the connector from the migrations directory (missing
  migration_lock.toml)` because this repository's migrations are hand-authored. A verification
  command that cannot run is worse than none: it reads as a passed gate. The corrected form is
  `npx prisma migrate deploy` followed by `npx prisma migrate diff --from-config-datasource
  --to-schema ./prisma/schema.prisma --exit-code`, expecting exit code `0`.
- **CHK052–CHK054** exist because the repository's own schema carries a warning comment that
  Prisma's default `onDelete` is derived from relation optionality, and that an inferred
  `SetNull` on `Ticket.column` would fabricate completed tickets with no history row and no
  audit entry. This feature adds a scalar column and must not disturb that; the check makes the
  claim falsifiable instead of assumed.
