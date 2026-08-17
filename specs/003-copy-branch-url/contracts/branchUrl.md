# Contract: `buildBranchUrl`

**Module**: `frontend/src/lib/branchUrl.ts` | **Feature**: `003-copy-branch-url`

```ts
export function buildBranchUrl(gitRepoUrl: string, branch: string): string | null;
```

A pure, total function. It performs no I/O, mutates nothing, reads no module-level state, and never throws for any string input. `null` means "no branch URL exists for this input" and is the caller's signal to fall back to the branch name (spec FR-004).

## Stage 1 — normalise `gitRepoUrl` to a repository address

Applied in this order (spec FR-003):

| # | Rule | Example |
|---|---|---|
| 1 | Strip leading/trailing whitespace | `"  https://github.com/o/r  "` → `https://github.com/o/r` |
| 2 | Convert the SSH remote form `git@<host>:<path>` to `https://<host>/<path>` | `git@github.com:o/r.git` → `https://github.com/o/r.git` |
| 3 | Strip one trailing `.git`. It counts as trailing when it ends the value **or** when the only thing following it is the `/` that rule 4 will remove; in that second case the `/` is left in place for rule 4 to take | `https://github.com/o/r.git` → `https://github.com/o/r`; `https://github.com/o/r.git/` → `https://github.com/o/r/` |
| 4 | Strip one trailing `/` | `https://github.com/o/r/` → `https://github.com/o/r`; and so `https://github.com/o/r.git/` reduces to `https://github.com/o/r`, which is what FR-003b requires |
| 5 | Require an `http:` or `https:` scheme and a parseable URL; otherwise the result is `null` | `not a url`, `ftp://h/o/r`, `""` → `null` |
| 6a | **Fragment — every shape, unconditionally.** Discard the fragment, before the shape is selected and regardless of which shape Stage 2 goes on to select, Azure DevOps included (spec FR-003e) | `https://github.com/o/r#readme` → `https://github.com/o/r`; `https://dev.azure.com/o/p/_git/r#readme` → `https://dev.azure.com/o/p/_git/r`; `https://dev.azure.com/o/p/_git/r?path=/x#readme` → `https://dev.azure.com/o/p/_git/r` (the query survives; only the fragment goes) |
| 6b | **Query — path shapes only**, i.e. every Stage 2 row except the Azure DevOps row: GitHub, GitLab, Bitbucket and the unrecognised-host fallback. Discard the query string too, so that what remains is `origin + pathname` (spec FR-003e) | `https://github.com/o/r?tab=readme` → `https://github.com/o/r`; `https://github.com/o/r?tab=readme#top` → `https://github.com/o/r`; `https://dev.azure.com/o/p/_git/r?path=/x` → unchanged, the query is kept for Stage 2 to append to |
| 6c | After 6a and 6b, **re-apply rules 3 and 4** to what remains, because a query or a fragment can hide a trailing `.git` or `/` from them | `https://github.com/o/r.git?tab=readme` → `https://github.com/o/r`; `https://org.visualstudio.com/p/_git/r.git#readme` → `https://org.visualstudio.com/p/_git/r` |

Rule 2 applies only to the `git@host:path` shorthand. A value that already carries a scheme is left to rule 5 to judge — so `ssh://git@host/owner/repo.git` is **not** converted and returns `null` (spec §Edge Cases).

Rules 1–5 and 6a apply to every shape. Only **6b** is conditional on the shape Stage 2 selects, so it is evaluated once the host is known. It does **not** apply to the Azure DevOps row: there the branch itself travels in a query parameter, so a stored query is addressing information (`?path=/x`) rather than decoration, and it is preserved and appended to exactly as Stage 2 already specifies (spec FR-003e, FR-005a). A fragment is never addressing information on any forge, which is why 6a is unconditional.

Rule 6 exists because without it the branch would be appended *after* the `?` or the `#`, and the result is a string no browser resolves to the branch while the control still announced `Copy branch URL` — the mis-promise FR-006/SC-004 exist to prevent. It fails in both shapes, for the same reason: on a path shape as `https://github.com/o/r?tab=readme/tree/main`, and on the query shape as `https://dev.azure.com/o/p/_git/r#readme?version=GBmain`, where the version parameter lands *inside* the fragment and a browser never sends it as a query. Both halves were resolved by the human partner's rulings of 2026-08-17 (spec §Clarifications): the first ruling settled the query on the path shapes, the second made the fragment rule universal.

## Stage 2 — shape the branch URL from the host

Host matching is case-insensitive and on domain boundaries: the hostname either equals the forge domain or ends with `.` + the forge domain. Substring matching is forbidden (spec FR-003d; research R4).

| Host matches | Result |
|---|---|
| `github.com` | `<repo>/tree/<branch-path>` |
| `gitlab.com` | `<repo>/-/tree/<branch-path>` |
| `bitbucket.org` | `<repo>/src/<branch-path>` |
| `dev.azure.com`, `visualstudio.com` | `<repo>?version=GB<branch-query>` |
| anything else | `<repo>/tree/<branch-path>` (the GitHub shape) |

Where (spec FR-005a):

- `<branch-path>` is the branch with its slashes left literal and no percent-encoding applied by this function.
- `<branch-query>` is `encodeURIComponent(branch)`.
- For the query shape, if `<repo>` already contains `?`, the parameter is appended with `&` instead of `?`.

## Return value

| `gitRepoUrl` | `branch` | Result |
|---|---|---|
| `""` or whitespace only | any | `null` |
| not normalisable to an `http`/`https` URL | any | `null` |
| normalisable | `""` or whitespace only | `null` |
| normalisable | non-empty | the branch URL, per the table above |

The empty-branch row exists to keep the function total. The UI never reaches it: the branch block renders no copy control when there is no effective branch (spec FR-009).

## Worked examples (test vectors)

| `gitRepoUrl` | `branch` | Result |
|---|---|---|
| `https://github.com/owner/repo` | `main` | `https://github.com/owner/repo/tree/main` |
| `https://github.com/owner/repo` | `feature/x` | `https://github.com/owner/repo/tree/feature/x` |
| `git@github.com:owner/repo.git` | `main` | `https://github.com/owner/repo/tree/main` |
| `https://github.com/owner/repo.git` | `main` | `https://github.com/owner/repo/tree/main` |
| `  https://github.com/owner/repo/  ` | `main` | `https://github.com/owner/repo/tree/main` |
| `https://github.com/owner/repo.git/` | `main` | `https://github.com/owner/repo/tree/main` (rule 3 then rule 4 — the FR-003b combined form) |
| `https://github.com/owner/repo?tab=readme` | `main` | `https://github.com/owner/repo/tree/main` (rule 6b — query discarded on a path shape) |
| `https://github.com/owner/repo#readme` | `main` | `https://github.com/owner/repo/tree/main` (rule 6a — fragment discarded) |
| `https://github.com/owner/repo?tab=readme#top` | `feature/x` | `https://github.com/owner/repo/tree/feature/x` (rules 6a and 6b — both discarded) |
| `https://github.com/owner/repo.git?tab=readme` | `main` | `https://github.com/owner/repo/tree/main` (rule 6b, then rule 6c re-applies rules 3–4 to what remains) |
| `https://gitlab.com/owner/repo` | `feature/x` | `https://gitlab.com/owner/repo/-/tree/feature/x` |
| `https://gitlab.com/owner/repo?ref_type=heads` | `main` | `https://gitlab.com/owner/repo/-/tree/main` (rule 6b) |
| `https://gitlab.example.com/owner/repo` | `main` | `https://gitlab.example.com/owner/repo/tree/main` (unrecognised host → GitHub shape) |
| `https://bitbucket.org/owner/repo` | `feature/x` | `https://bitbucket.org/owner/repo/src/feature/x` |
| `https://bitbucket.org/owner/repo#readme` | `main` | `https://bitbucket.org/owner/repo/src/main` (rule 6a) |
| `https://git.internal.example/owner/repo?utm_source=x#top` | `main` | `https://git.internal.example/owner/repo/tree/main` (rules 6a and 6b apply to the fallback shape too — it is a path shape) |
| `https://dev.azure.com/org/proj/_git/repo` | `feature/x` | `https://dev.azure.com/org/proj/_git/repo?version=GBfeature%2Fx` |
| `https://org.visualstudio.com/proj/_git/repo` | `main` | `https://org.visualstudio.com/proj/_git/repo?version=GBmain` |
| `https://dev.azure.com/org/proj/_git/repo?path=/x` | `main` | `https://dev.azure.com/org/proj/_git/repo?path=/x&version=GBmain` (rule 6b does **not** apply here — the query is preserved and appended to with `&`) |
| `https://dev.azure.com/org/proj/_git/repo#readme` | `main` | `https://dev.azure.com/org/proj/_git/repo?version=GBmain` (rule 6a — the fragment is discarded on Azure DevOps too; without it the result is `…/repo#readme?version=GBmain`, which does not open) |
| `https://dev.azure.com/org/proj/_git/repo?path=/x#readme` | `main` | `https://dev.azure.com/org/proj/_git/repo?path=/x&version=GBmain` (rules 6a and 6b together: the fragment goes, the query stays — identical to the query-only row above) |
| `https://org.visualstudio.com/proj/_git/repo#path=/x&version=GBmaster` | `main` | `https://org.visualstudio.com/proj/_git/repo?version=GBmain` (rule 6a on the legacy hash-routed domain — the stored hash carries a *stale* branch selector, and keeping it would both hide the new parameter inside the fragment and address the wrong branch) |
| `https://git.internal.example/owner/repo` | `main` | `https://git.internal.example/owner/repo/tree/main` |
| `https://github.com.evil.example/owner/repo` | `main` | `https://github.com.evil.example/owner/repo/tree/main` (not GitHub, but the fallback shape is the same string — the point is that the host is *not* classified as GitHub) |
| `""` | `main` | `null` |
| `   ` | `main` | `null` |
| `not a url` | `main` | `null` |
| `ftp://host/owner/repo` | `main` | `null` |
| `ssh://git@github.com/owner/repo.git` | `main` | `null` (only the `git@host:path` shorthand is converted) |
| `https://github.com/owner/repo` | `""` | `null` |

## Caller contract — `TicketDetailModal`

- The copied payload is `buildBranchUrl(project.gitRepoUrl, detail.effectiveBranch) ?? detail.effectiveBranch` (spec FR-001, FR-004).
- The control's `aria-label` and `title` are both `Copy branch URL` when the call returned a string, `Copy branch name` when it returned `null` (spec FR-006). Both must be derived from the *same* evaluation as the payload, so the name and the clipboard can never disagree (spec SC-004).
- The copy mechanism, its non-secure-context fallback and the `Copiado` confirmation are unchanged; the payload is decided before the mechanism is selected (spec FR-007).
