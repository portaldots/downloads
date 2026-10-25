import { fullVersion, parseVersion, spaceship, versionCompare } from './version';

const PER_PAGE = 100;
const MAX_PAGES = 10;
const ZIP_ASSET_NAME = 'PortalDots.zip';
const FRESH_SECONDS = 120;
// 期限切れでも GitHub 障害時に返せるよう、Cache API 側には長めに残す
const RETAIN_SECONDS = 7 * 24 * 60 * 60;
const CACHE_KEY = 'https://portaldots-releases.invalid/candidates/v1';

export interface Release {
  version: string;
  published_at: string;
  html_url: string;
  browser_download_url: string;
  size: number;
  body: string;
}

// 全メジャーバージョン分の、PortalDots.zip を持つリリース
export interface Candidate {
  release: Release;
  prerelease: boolean;
}

export interface Deps {
  fetchFn: typeof fetch;
  cache: Cache;
  githubToken?: string;
  waitUntil?: (p: Promise<unknown>) => void;
  now?: () => number;
}

interface GithubAsset {
  name?: string;
  size: number;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
  body: string | null;
  assets?: GithubAsset[];
}

export function findZipAsset(assets: GithubAsset[]): GithubAsset | null {
  const named = assets.find((a) => a.name === ZIP_ASSET_NAME);
  if (named) return named;
  // PortalDots_v1.2.2.zip のように別名の成果物を1つだけ持つ旧リリースは、その成果物を使う
  if (assets.length === 1) return assets[0];
  return null;
}

// Carbon の toIso8601String() と同じ形式 (2026-01-01T00:00:00+00:00)
function toIso8601(value: string | null, now: number): string {
  const date = value === null ? new Date(now) : new Date(value);
  return date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

async function fetchCandidates(deps: Deps): Promise<Candidate[]> {
  const result: Candidate[] = [];
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'portaldots-releases-worker',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (deps.githubToken) headers.Authorization = `Bearer ${deps.githubToken}`;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/repos/portaldots/PortalDots/releases?per_page=${PER_PAGE}&page=${page}`;
    const res = await deps.fetchFn(url, { headers });
    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
    const releases = (await res.json()) as unknown;
    if (!Array.isArray(releases)) throw new Error('GitHub API returned a non-array');

    for (const r of releases as GithubRelease[]) {
      const version = parseVersion(r.tag_name);
      if (!version) continue;
      const asset = findZipAsset(r.assets ?? []);
      if (!asset) continue;
      result.push({
        prerelease: Boolean(r.prerelease),
        release: {
          version: fullVersion(version),
          published_at: toIso8601(r.published_at, (deps.now ?? Date.now)()),
          html_url: r.html_url,
          browser_download_url: asset.browser_download_url,
          size: asset.size,
          body: r.body ?? '',
        },
      });
    }
    if (releases.length < PER_PAGE) break;
  }
  return result;
}

async function loadCandidates(deps: Deps): Promise<Candidate[]> {
  const now = (deps.now ?? Date.now)();
  const cacheRequest = new Request(CACHE_KEY);
  const cached = await deps.cache.match(cacheRequest);
  let stale: Candidate[] | null = null;

  if (cached) {
    const fetchedAt = Number(cached.headers.get('X-Fetched-At') ?? 0);
    const data = (await cached.json()) as Candidate[];
    if (now - fetchedAt < FRESH_SECONDS * 1000) return data;
    stale = data;
  }

  try {
    const fresh = await fetchCandidates(deps);
    const put = deps.cache.put(
      cacheRequest,
      new Response(JSON.stringify(fresh), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${RETAIN_SECONDS}`,
          'X-Fetched-At': String(now),
        },
      }),
    );
    if (deps.waitUntil) deps.waitUntil(put);
    else await put;
    return fresh;
  } catch (e) {
    console.error('failed to fetch releases from GitHub', e);
    // GitHub 障害時は期限切れでもキャッシュを返す。なければ空
    return stale ?? [];
  }
}

// 指定メジャーバージョンのリリースを、バージョン降順で返す
export async function getAllReleases(
  deps: Deps,
  majorVersion: number,
  includesPrerelease = false,
): Promise<Release[]> {
  const candidates = await loadCandidates(deps);
  const filtered = candidates.filter((c) => {
    const v = parseVersion(c.release.version);
    if (!v || v.major !== majorVersion) return false;
    if (c.prerelease && !includesPrerelease) return false;
    return true;
  });

  return filtered
    .map((c) => c.release)
    .sort((a, b) => {
      const result = versionCompare(b.version, a.version);
      if (result !== 0) return result;
      // プレリリースバージョンで比較する
      return spaceship(parseVersion(b.version)!.prerelease, parseVersion(a.version)!.prerelease);
    });
}
