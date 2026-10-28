import type { Deps } from '../src/releases';

export function ghRelease(tag: string, assets: Array<Record<string, unknown>>, prerelease = false) {
  return {
    tag_name: tag,
    prerelease,
    published_at: '2026-01-01T00:00:00Z',
    html_url: `https://github.com/portaldots/PortalDots/releases/tag/${tag}`,
    body: 'notes',
    assets,
  };
}

export function ghAsset(name: string) {
  return {
    name,
    size: 100,
    browser_download_url: `https://github.com/portaldots/PortalDots/releases/download/x/${name}`,
  };
}

export class MemoryCache {
  store = new Map<string, Response>();
  async match(req: Request | string) {
    const key = typeof req === 'string' ? req : req.url;
    return this.store.get(key)?.clone();
  }
  async put(req: Request | string, res: Response) {
    this.store.set(typeof req === 'string' ? req : req.url, res.clone());
  }
}

export interface Harness {
  deps: Deps;
  cache: MemoryCache;
  calls: Array<{ url: string; headers: Record<string, string> }>;
  setNow(ms: number): void;
  setFail(fail: boolean): void;
}

// pages: GitHub API の各ページの応答
export function harness(pages: unknown[][], githubToken?: string): Harness {
  const cache = new MemoryCache();
  const calls: Harness['calls'] = [];
  let now = 1_000_000;
  let fail = false;
  const fetchFn = (async (input: string, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    if (fail) return new Response('error', { status: 500 });
    const page = Number(new URL(String(input)).searchParams.get('page'));
    return new Response(JSON.stringify(pages[page - 1] ?? []), { status: 200 });
  }) as unknown as typeof fetch;
  return {
    deps: { fetchFn, cache: cache as unknown as Cache, githubToken, now: () => now },
    cache,
    calls,
    setNow: (ms) => {
      now = ms;
    },
    setFail: (f) => {
      fail = f;
    },
  };
}
