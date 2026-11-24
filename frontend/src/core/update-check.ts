// Whether a newer build than this one is published on GitHub. Builds from main go out as the
// rolling "snapshot" release while the version number stays put, so builds are told apart by
// commit: GitHub's compare API says whether the release tag is ahead of the commit we were built from.

export const UPDATE_TAG = 'snapshot';

export interface UpdateInfo {
  newer: boolean;
  changes: number; // commits in the release that this build does not have (desktop)
  url: string;     // the release page with the downloads (desktop)
  build?: string;  // the build the site serves now (browser)
}

type Fetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export function releaseUrl(repo: string): string {
  return `https://github.com/${repo}/releases/tag/${UPDATE_TAG}`;
}

// Throws when GitHub cannot answer (offline, rate limit, a commit it does not know such as a
// local one). "diverged" (a branch build) and "behind" (newer than the release) are not updates.
export async function checkForUpdate(repo: string, commit: string, fetchFn: Fetch, signal?: AbortSignal): Promise<UpdateInfo> {
  if (!/^\w[\w.-]*\/\w[\w.-]*$/.test(repo) || !/^[0-9a-f]{7,40}$/i.test(commit)) throw new Error('No build commit to compare');
  const res = await fetchFn(`https://api.github.com/repos/${repo}/compare/${commit}...${UPDATE_TAG}?per_page=1`, {
    headers: { Accept: 'application/vnd.github+json' }, signal
  });
  if (!res.ok) throw new Error(res.status === 404 ? 'GitHub does not know this build' : `GitHub answered ${res.status}`);
  const body = await res.json();
  const changes = Number(body?.ahead_by) || 0;
  return { newer: body?.status === 'ahead' && changes > 0, changes, url: releaseUrl(repo) };
}

// The browser build: whoever runs the proxy decides the version, so the page asks its own site,
// never GitHub. the frontend build writes the build id into index.html (the build this page runs,
// which a tab left open or a page from the service worker's cache keeps) and into version.json
// (the build the site serves now). Any other build there is news, even an older one put back.
export const WEB_VERSION_FILE = 'version.json';

export async function checkDeployed(url: string, build: string, fetchFn: Fetch, signal?: AbortSignal): Promise<UpdateInfo> {
  if (!/^[0-9a-f]{6,64}$/.test(build)) throw new Error('No build id to compare');
  const res = await fetchFn(url, { signal });
  if (!res.ok) throw new Error(`The site answered ${res.status}`);
  const served = (await res.json())?.build;
  if (typeof served !== 'string' || !/^[0-9a-f]{6,64}$/.test(served)) throw new Error('The site sent no build id');
  return { newer: served !== build, changes: 0, url: '', build: served };
}
