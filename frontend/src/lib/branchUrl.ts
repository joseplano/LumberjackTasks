const FORGE_SHAPES: Array<{
  domains: string[];
  /**
   * True when the branch travels in a query parameter rather than a path segment.
   * A stored query string is then addressing information rather than decoration,
   * so contract rule 6b must not discard it (FR-003e, FR-005a).
   */
  branchInQuery: boolean;
  shape: (repo: string, branch: string) => string;
}> = [
  {
    domains: ['github.com'],
    branchInQuery: false,
    shape: (repo, branch) => `${repo}/tree/${branch}`,
  },
  {
    domains: ['gitlab.com'],
    branchInQuery: false,
    shape: (repo, branch) => `${repo}/-/tree/${branch}`,
  },
  {
    domains: ['bitbucket.org'],
    branchInQuery: false,
    shape: (repo, branch) => `${repo}/src/${branch}`,
  },
  {
    domains: ['dev.azure.com', 'visualstudio.com'],
    branchInQuery: true,
    shape: (repo, branch) => {
      const separator = repo.includes('?') ? '&' : '?';
      return `${repo}${separator}version=GB${encodeURIComponent(branch)}`;
    },
  },
];

function matchesDomain(hostname: string, domain: string): boolean {
  const lowerHost = hostname.toLowerCase();
  const lowerDomain = domain.toLowerCase();
  return lowerHost === lowerDomain || lowerHost.endsWith(`.${lowerDomain}`);
}

/** Contract rules 3 and 4: strip a trailing `.git`, then a trailing `/`. */
function stripTrailingSuffixes(value: string): string {
  let result = value;

  if (result.endsWith('.git')) {
    result = result.slice(0, -'.git'.length);
  } else if (result.endsWith('.git/')) {
    result = `${result.slice(0, -'.git/'.length)}/`;
  }

  if (result.endsWith('/')) {
    result = result.slice(0, -1);
  }

  return result;
}

/**
 * Truncates at the first occurrence of `delimiter`, preserving the original
 * casing of everything before it. Deliberately string-based rather than rebuilt
 * from `URL.origin`/`URL.pathname`, because those lower-case the scheme and host
 * and the contract keeps the stored value's casing in the result.
 */
function discardFrom(value: string, delimiter: string): string {
  const index = value.indexOf(delimiter);
  return index === -1 ? value : value.slice(0, index);
}

/**
 * Normalises and shapes a git repository URL plus branch name into a browsable
 * branch URL for known forges (GitHub, GitLab, Bitbucket, Azure DevOps), falling
 * back to the GitHub shape for unrecognised hosts.
 *
 * Pure and total: never throws, performs no I/O, and holds no module-level state.
 * Returns `null` when no branch URL can be derived, signalling the caller to fall
 * back to the branch name.
 */
export function buildBranchUrl(gitRepoUrl: string, branch: string): string | null {
  if (branch.trim() === '') {
    return null;
  }

  let normalised = gitRepoUrl.trim();
  if (normalised === '') {
    return null;
  }

  const sshShorthandMatch = /^git@([^:]+):(.+)$/.exec(normalised);
  if (sshShorthandMatch) {
    const [, host, path] = sshShorthandMatch;
    normalised = `https://${host}/${path}`;
  }

  normalised = stripTrailingSuffixes(normalised);

  let url: URL;
  try {
    url = new URL(normalised);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }

  const forge =
    FORGE_SHAPES.find((candidate) =>
      candidate.domains.some((domain) => matchesDomain(url.hostname, domain))
    ) ?? null;

  // Rule 6a: a fragment is decoration on every shape, Azure DevOps included, and
  // is always discarded. Keeping it would bury the branch behind the `#` — and on
  // the query shape it would swallow `?version=GB…` inside the fragment, which a
  // browser never sends as a query.
  let repo = discardFrom(normalised, '#');

  // Rule 6b: a query string is decoration only where the branch goes into a path
  // segment. Where the branch itself travels in a query parameter, the stored
  // query is addressing information and is preserved for the shape to append to.
  if (forge === null || !forge.branchInQuery) {
    repo = discardFrom(repo, '?');
  }

  // Rule 6c: re-apply rules 3 and 4, because a discarded query or fragment can
  // expose a trailing `.git` or `/` that they could not see the first time.
  repo = stripTrailingSuffixes(repo);

  if (forge !== null) {
    try {
      return forge.shape(repo, branch);
    } catch {
      // A branch string that cannot be percent-encoded (e.g. a lone UTF-16
      // surrogate) has no valid URL representation. Per contract, `null`
      // signals the caller to fall back to the branch name (FR-004) —
      // never throw, never emit a partial/unencoded URL.
      return null;
    }
  }

  return `${repo}/tree/${branch}`;
}
