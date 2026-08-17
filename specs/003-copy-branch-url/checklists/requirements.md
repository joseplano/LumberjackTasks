# Specification Quality Checklist: Copy the branch URL, not just the branch name

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-16
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — the spec speaks of "the copy control", "the project's repository URL" and "a URL addressing the branch"; module names, function signatures and file paths appear only in `plan.md`, `research.md` and `contracts/`
- [x] Focused on user value and business needs — every story is framed as reaching the branch in the forge, or as the control staying trustworthy when it cannot
- [x] Written for non-technical stakeholders — the forge URL shapes are shown as concrete examples rather than as code
- [x] All mandatory sections completed — User Scenarios & Testing, Requirements, Success Criteria, plus Clarifications and Assumptions

## Requirement Completeness

- [x] No `[NEEDS CLARIFICATION]` markers remain
- [x] Requirements are testable and unambiguous — each of FR-001…FR-011 names an observable outcome; the normalisation order in FR-003 and the shape table in FR-005 are exact
- [x] Success criteria are measurable — SC-001…SC-007 are stated as counts, byte-for-byte equalities, or "in 100% of cases"
- [x] Success criteria are technology-agnostic — they describe the clipboard, the accessible name, and "no figure changes", never a module or framework
- [x] All acceptance scenarios are defined — three prioritised stories, each independently testable, covering the URL path, the fallback path and the stored-URL variants
- [x] Edge cases are identified — thirteen, each traced to the requirement that governs it. Two of them were added by the 2026-08-17 rulings: a query string or fragment on a path-shaped forge, and a fragment on Azure DevOps
- [x] Scope is clearly bounded — the Assumptions section lists what is out of scope (save-time validation, deep links, per-forge configuration, agent-reported branch behaviour)
- [x] Dependencies and assumptions identified — both inputs are named as already present, and the empty-`gitRepoUrl` state of this very project is called out as expected behaviour rather than a defect

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria — every FR is referenced from at least one acceptance scenario, edge case or success criterion
- [x] User scenarios cover primary flows — copy a URL, copy a name when no URL is available, and copy correctly from URLs stored in any common form
- [x] Feature meets measurable outcomes defined in Success Criteria — SC-001…SC-007 collectively cover both payload kinds, both copy mechanisms, the naming invariant and the "nothing else moves" claim
- [x] No implementation leakage into requirements — FR-011 states the derivation must be exercisable without rendering a UI, which is a testability requirement, not a design instruction; the module choice that satisfies it lives in the plan
