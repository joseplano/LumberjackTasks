const FORGE_SHAPES: Array<{ domains: string[]; shape: (repo: string, branch: string) => string }> = [
  {
    domains: ['github.com'],
    shape: (repo, branch) => `${repo}/tree/${branch}`,
  },
  {
    domains: ['gitlab.com'],
    shape: (repo, branch) => `${repo}/-/tree/${branch}`,
  },
  {
    domains: ['bitbucket.org'],
    shape: (repo, branch) => `${repo}/src/${branch}`,
  },
  {
    domains: ['dev.azure.com', 'visualstudio.com'],
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

  if (normalised.endsWith('.git')) {
    normalised = normalised.slice(0, -'.git'.length);
  } else if (normalised.endsWith('.git/')) {
    normalised = `${normalised.slice(0, -'.git/'.length)}/`;
  }

  if (normalised.endsWith('/')) {
    normalised = normalised.slice(0, -1);
  }

  let url: URL;
  try {
    url = new URL(normalised);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }

  const repo = normalised;

  for (const forge of FORGE_SHAPES) {
    if (forge.domains.some((domain) => matchesDomain(url.hostname, domain))) {
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
  }

  return `${repo}/tree/${branch}`;
}
