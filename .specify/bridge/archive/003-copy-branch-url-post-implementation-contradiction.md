# Post-implementation product contradiction — `003-copy-branch-url`

**Status**: `RESOLVED` — superseded by two human rulings on 2026-08-17. See "Resolution" immediately below.
**Raised**: 2026-08-17, by the V3.1 feature-orchestrator during Phase 7 (post-implementation `speckit-analyze`).
**Branch**: `003-copy-branch-url` @ `cfaa558`

> **This file is NON-AUTHORITATIVE and remains so.** It is the evidence that prompted a human
> decision, not the decision itself. The authoritative record of what was decided is
> `specs/003-copy-branch-url/spec.md` §Clarifications, Session 2026-08-17. Everything below the
> Resolution section is preserved unedited as the measured evidence the spec cites — including
> the options list, which is a snapshot of what was *offered*, not of what was chosen.

## Resolution (added 2026-08-17, after the rulings)

The human partner ruled twice, and the two rulings together divide the rule by URL **component**
rather than by forge:

1. **Query string** — decoration on the path-shaped forges (GitHub, GitLab, Bitbucket, and the
   unrecognised-host fallback), discarded there. **Addressing information on Azure DevOps**, where
   FR-005a's preserve-and-append-with-`&` behaviour is unchanged. This is option 1 below, scoped.
2. **Fragment** — decoration on **every** forge, Azure DevOps included, always discarded. This
   second ruling followed the discovery that exempting Azure entirely left
   `dev.azure.com/org/proj/_git/repo#readme` yielding `…/repo#readme?version=GBmain`: the version
   parameter lands inside the fragment, which a browser never sends as a query. Verified against
   the shipped module before ruling.

Options 2, 3 and 4 below were **rejected**, as were the two alternatives specific to the second
ruling (assembling the Azure URL by component order; declaring the class out of scope). SC-001
keeps its text and its "100%" in both cases — the rulings made the promise true rather than
narrowing it.

Propagated into `spec.md`, `plan.md`, `contracts/branchUrl.md`, `data-model.md`, `research.md`,
`quickstart.md` and all three checklists. Readiness `CHK033` is now checked and no checklist item
is open. The behaviour is **not yet built**: tasks `T016`-`T018` carry it, `T016` RED first, and
`T014` (the manual walkthrough) is still open.

## The contradiction in one line

Spec **SC-001** promises a clipboard value that opens the branch "in 100% of cases" for the four
named forges, while **FR-003 + FR-005/FR-005a**, implemented exactly as written, produce a broken
URL whenever the stored repository URL carries a query string or a fragment and the forge uses a
**path**-shaped URL (GitHub, GitLab, Bitbucket, and the unrecognised-host fallback).

Both are formal, top-level statements inside `spec.md`. Neither is subordinate to the other, and
no third statement arbitrates. They cannot both be true for this input class.

## Exact identifiers

| ID | Text (abridged) | Location |
|---|---|---|
| **SC-001** | "…pressing the copy control on a ticket with a branch yields, **in 100% of cases**, a clipboard value that **opens that branch in that repository in a browser**." | `specs/003-copy-branch-url/spec.md` §Success Criteria |
| **FR-003** | Normalisation is exactly: trim → SSH-to-https → strip trailing `.git` → strip trailing `/`. **No query or fragment handling.** | `specs/003-copy-branch-url/spec.md` §Functional Requirements |
| **FR-005** | "`<repo>/tree/<branch>` for GitHub and for unrecognised hosts, `<repo>/-/tree/<branch>` for GitLab, `<repo>/src/<branch>` for Bitbucket, and `<repo>?version=GB<branch>` for Azure DevOps." | same |
| **FR-005a** | The append-to-existing-query rule is scoped to "**a branch placed in a query parameter**" — i.e. Azure DevOps only. | same |
| Contract §Stage 2 | Same scoping: the `?`/`&` selection exists only for the query shape. | `specs/003-copy-branch-url/contracts/branchUrl.md` |

## Causal chain

1. **FR-003** defines the repository address. It strips whitespace, the SSH form, a trailing
   `.git` and a trailing `/`. It does **not** mention a query string or a fragment, so both
   survive normalisation intact.
2. **FR-005** then appends the branch path directly to that address for the three path-shaped
   forges and the fallback.
3. **FR-005a** makes the URL query-aware **only** where the branch itself travels in a query
   parameter — Azure DevOps. For the path shapes it is silent.
4. Therefore a repository URL ending in `?…` or `#…` produces a string with the branch path
   appended *after* the query or fragment, which no browser resolves to the branch.
5. **SC-001** claims this never happens, for any of the four named forges, without exception.

`spec.md` §Edge Cases lists "Azure DevOps repository URL that already carries a query string" but
has **no** entry for the path-forge equivalent, and `checklists/readiness.md` **CHK013** explicitly
scoped its query-append verification to the query-parameter case. The gap was never evaluated for
path forges — it is an omission in the requirements, not a mis-transcription of them.

## Current implementation behaviour (measured, not inferred)

Run against the shipped `frontend/src/lib/branchUrl.ts` at `cfaa558`:

| Input `gitRepoUrl` | `branch` | Actual output | Opens the branch? |
|---|---|---|---|
| `https://github.com/owner/repo?tab=readme` | `main` | `https://github.com/owner/repo?tab=readme/tree/main` | **No** |
| `https://github.com/owner/repo#readme` | `main` | `https://github.com/owner/repo#readme/tree/main` | **No** |
| `https://gitlab.com/owner/repo?ref_type=heads` | `main` | `https://gitlab.com/owner/repo?ref_type=heads/-/tree/main` | **No** |
| `https://dev.azure.com/org/proj/_git/repo?path=/x` | `main` | `https://dev.azure.com/org/proj/_git/repo?path=/x&version=GBmain` | **Yes** (FR-005a covers it) |

The code is **not defective against the functional requirements** — it implements FR-003, FR-005
and FR-005a precisely as written, and every one of the 32 unit vectors and 18 component cases
passes. The defect is that the requirements as written cannot satisfy SC-001.

The failure is also silent in the worst way for this feature: the control's accessible name still
reads `Copy branch URL` (a URL *was* produced), so the person is told a working URL is on the
clipboard. That is the exact condition FR-006/SC-004 exist to prevent, reached through an input
class no requirement anticipated.

## Why this is a product decision and not a code fix

Choosing what to do requires deciding what a stored repository URL *means* when it carries a
query or fragment — is that decoration to be discarded, or addressing information to be preserved?
The spec never says. Each answer changes observable product behaviour, and one of them changes the
meaning of a success criterion. That is the human partner's call, not the implementer's.

## Resolution options as they were offered *(historical — see Resolution above for what was chosen)*

1. **Discard query and fragment for path-shaped forges.** Normalise the repository address to
   `origin + pathname` before applying a path shape. `https://github.com/o/r?tab=readme` then
   yields `https://github.com/o/r/tree/main`. Makes SC-001 true as written. Requires amending
   FR-003 (add the stripping step), the contract's Stage 1, the Edge Cases list, and the code plus
   new vectors. Risk: discards information a user may have intended to keep.
2. **Preserve them and insert the branch path correctly**, i.e. build the URL from its parts so
   the branch lands in the path while the query and fragment stay at the end. Strictly more
   faithful, materially more complex, and the resulting URL is still unlikely to be what a forge
   expects. Same artifact edits as option 1.
3. **Narrow SC-001 and accept the behaviour.** Scope SC-001 to repository URLs that carry no query
   or fragment, and add this input class to the Edge Cases list as a named, accepted limitation.
   No code change. This is still a product decision — it changes what "100%" is promised to mean.
4. **Reject such values at derivation time** — treat a repository URL bearing a query or fragment
   as not usable, returning `null` so the control copies the branch name and honestly labels
   itself `Copy branch name`. Preserves SC-004's guarantee and never emits a broken URL, at the
   cost of the feature not working for those stored values.

Options 1 and 4 both restore the "never show `Copy branch URL` next to something that does not
open" property. Options 2 and 3 do not, or only partially.

## What the human should do next *(steps 1 and 2 are done; 3 and 4 remain)*

1. Run the installed Spec Kit clarify skill — in this repository, **`/speckit-clarify`** — and
   record the ruling in `spec.md` §Clarifications.
2. Run **`/spec-kit-bootstrap`** to propagate the resolved decision into `plan.md`,
   `contracts/branchUrl.md`, `data-model.md`, `quickstart.md` and the checklists, and to
   re-validate readiness.
3. If the ruling changes behaviour, the new tasks will be appended to `tasks.md`; re-run
   `/feature-orchestrator` to implement and verify them.
4. Task **T014** (the manual quickstart walkthrough) is still open and should be run after the
   ruling — it is the step that exercises a real browser navigation, which is exactly the failure
   mode above.

## What is NOT blocked

Everything else in this feature is implemented, reviewed and verified. See the run report and
`.superpowers/sdd/003-copy-branch-url/progress.md`. Nothing has been pushed, merged or published.
