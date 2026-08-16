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
| 3 | Strip one trailing `.git` | `https://github.com/o/r.git` → `https://github.com/o/r` |
| 4 | Strip one trailing `/` | `https://github.com/o/r/` → `https://github.com/o/r` |
| 5 | Require an `http:` or `https:` scheme and a parseable URL; otherwise the result is `null` | `not a url`, `ftp://h/o/r`, `""` → `null` |

Rule 2 applies only to the `git@host:path` shorthand. A value that already carries a scheme is left to rule 5 to judge — so `ssh://git@host/owner/repo.git` is **not** converted and returns `null` (spec §Edge Cases).

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
| `https://gitlab.com/owner/repo` | `feature/x` | `https://gitlab.com/owner/repo/-/tree/feature/x` |
| `https://gitlab.example.com/owner/repo` | `main` | `https://gitlab.example.com/owner/repo/tree/main` (unrecognised host → GitHub shape) |
| `https://bitbucket.org/owner/repo` | `feature/x` | `https://bitbucket.org/owner/repo/src/feature/x` |
| `https://dev.azure.com/org/proj/_git/repo` | `feature/x` | `https://dev.azure.com/org/proj/_git/repo?version=GBfeature%2Fx` |
| `https://org.visualstudio.com/proj/_git/repo` | `main` | `https://org.visualstudio.com/proj/_git/repo?version=GBmain` |
| `https://dev.azure.com/org/proj/_git/repo?path=/x` | `main` | `https://dev.azure.com/org/proj/_git/repo?path=/x&version=GBmain` |
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
