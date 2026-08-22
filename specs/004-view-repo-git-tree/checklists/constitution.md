# Constitution Compliance Checklist: View repo — a graphical tree of the repository history

**Purpose**: Validate that the requirements and design artifacts express every obligation
constitution v1.0.0 places on this feature, before any implementation begins. These items test
what the artifacts *say*, not what code does.
**Created**: 2026-08-21
**Feature**: [spec.md](../spec.md) | [plan.md](../plan.md)

## Principle I — Module Boundaries & Single Source of Truth

- [x] CHK001 Is the frontend's role stated as HTTP-consumer-only, with no write path of its own? [Completeness, Spec §FR-003]
- [x] CHK002 Are the invariants the backend must enforce enumerated, rather than left to be discovered during implementation? [Completeness, Contract §http-api.md §4]
- [x] CHK003 Is it explicit that the MCP tool holds no rule the backend does not also enforce, and opens no database connection? [Clarity, Contract §mcp-tool.md]
- [x] CHK004 Is the boundary between agent-derived and backend-validated data drawn unambiguously for branch state? [Clarity, Research §R4, Data-model §GitBranchState]
- [x] CHK005 Are the requirements free of any second write path for repository history? [Consistency, Spec §FR-018]

## Principle II — TypeScript & Test Discipline (NON-NEGOTIABLE)

- [x] CHK006 Is every new stack file identified as TypeScript, with the plugin's ESM-only rule preserved? [Completeness, Plan §Project Structure]
- [x] CHK007 Are the four suite commands stated in the exact forms the constitution requires, including the plugin glob form? [Clarity, Plan §Technical Context, Quickstart §7]
- [x] CHK008 Are integration-level requirements identified for backend HTTP behaviour, rather than unit coverage alone? [Coverage, Quickstart §2]
- [x] CHK009 Are the pure functions specified as testable without rendering, with their required cases enumerated? [Measurability, Contract §tree-geometry.md]
- [x] CHK010 Is a regression test required for the one change that could silently break existing behaviour (ticket deletion under the new foreign key)? [Coverage, Research §R7]

## Principle III — Security Posture & Scope Honesty

- [x] CHK011 Is the prohibition on storing tokens, credentials and filesystem paths stated as a requirement rather than implied? [Completeness, Spec §FR-027]
- [x] CHK012 Do the requirements forbid implying per-user isolation or ownership that does not exist? [Completeness, Spec §FR-030]
- [x] CHK013 Is it explicit that no existing security control is weakened — specifically that the 100 KB body limit is preserved rather than raised? [Consistency, Research §R2, Plan §Constitution Check]
- [x] CHK014 Is the authorization expectation for the new endpoints stated (authenticated, no per-project restriction), matching the system's actual posture? [Clarity, Contract §http-api.md preamble]
- [x] CHK015 Is the rejection of the forge-API alternative traceable to the token-storage and outbound-network constraints, so it cannot be silently reintroduced? [Traceability, Research §R1]

## Principle IV — Plugin Portability & Silent-Failure Avoidance

- [x] CHK016 Is the plugin change scoped to instructions only, with no new file, no dependency and no `plugin.json` edit? [Clarity, Contract §mcp-tool.md §Plugin instructions]
- [x] CHK017 Is reading the "cuatro trampas" section of `docs/ticket-sync.md` before the plugin change stated as an obligation? [Completeness, Plan §Constitution Check]
- [x] CHK018 Are the requirements explicit that a sync which cannot complete must report why, rather than failing silently? [Completeness, Spec §FR-020]
- [x] CHK019 Is the one known silent-failure path (oversize body surfacing as `500 INTERNAL`) identified with its required remedy? [Gap closed, Research §R2, Contract §http-api.md §4 rule 10]
- [x] CHK020 Are over-cap batches and unknown ticket ids specified as rejections with reasons, rather than as silent trimming or skipping? [Clarity, Contract §http-api.md §4 rules 5, 6, 8]
- [x] CHK021 Is the decision to avoid a per-tool-use git hook recorded with its rationale, so it is not reintroduced as a convenience? [Traceability, Spec §FR-020, Research §R3]

## Principle V — Configuration, Secrets & Reproducible Environments

- [x] CHK022 Is a committed Prisma migration stated as mandatory, with its directory, naming convention and application path identified? [Completeness, Research §R8, Data-model §Migration]
- [x] CHK023 Is it explicitly recorded that this feature adds no new environment variable, so the absence of an `.env.example` change is a decision rather than an omission? [Gap closed, Plan §Constitution Check, Quickstart §Prerequisites]
- [x] CHK024 Is the README obligation for user-visible behaviour captured as a numbered requirement? [Completeness, Spec §FR-031]
- [x] CHK025 Are schema-drift checks specified, rather than assuming the migration and schema agree? [Measurability, Research §R9]

## Development Workflow & Quality Gates

- [x] CHK026 Is the branch topology recorded — a topic branch cut from `main`, not stacked on an unrelated feature branch? [Traceability, Plan header, Design §Branch topology decision]
- [x] CHK027 Are the type gates identified per package, including the fact that the frontend has only `next build`? [Clarity, Plan §Technical Context]
- [x] CHK028 Is the ordering constraint that the backend is verified before SVG work begins stated as a phase boundary rather than a preference? [Clarity, Plan §Implementation Phasing step 4]

## Notes

- All 28 items were evaluated against the artifacts as they stand on 2026-08-21 and are checked
  only where a concrete passage supports them; the referencing section is named on every item.
- CHK019 and CHK023 were **gaps found during planning and closed there**, not items that passed on
  first reading. CHK019 in particular: without the `entity.too.large` mapping, an oversize sync
  reports `500 INTERNAL / "Unexpected error"`, which breaches both FR-020 and Principle IV.
- No item on this checklist is a post-launch metric. Every one is answerable from the artifacts
  before a line of code is written.
