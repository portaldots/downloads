import { getAllReleases, type Deps, type Release } from './releases';
import { filterInt, fullVersion, parseVersion } from './version';

export interface Env {
  GITHUB_TOKEN?: string;
}

const GITHUB_REPO_URL = 'https://github.com/portaldots/downloads';
const DOWNLOAD_BASE = 'https://github.com/portaldots/PortalDots/releases/download';

export const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

function renderIndex(origin: string, majorVersion: number, releases: Release[]): string {
  const items = releases
    .map(
      (r) => `            <li>
                <a href="${escapeHtml(`${origin}/downloads/PortalDots-${r.version}.zip`)}">
                    ${escapeHtml(r.version)}
                </a>
            </li>`,
    )
    .join('\n');
  return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="ie=edge">
    <title>PortalDots ${majorVersion} Releases</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
            line-height: 1.4;
        }
    </style>
</head>
<body>
    <h1>PortalDots ${majorVersion} からアップデート可能なリリース</h1>
    <p>下記のバージョンのうち、現在お使いの PortalDots より新しいバージョンにアップデートできます。</p>
    <ul>
${items}
    </ul>
</body>
</html>
`;
}

// PHP の $request->input() と同様、同名パラメータが複数あれば最後の値を使う
function param(url: URL, name: string): string | null {
  const all = url.searchParams.getAll(name);
  return all.length ? all[all.length - 1] : null;
}

// empty() が真になる 0 / null は 404 扱い
function majorParam(url: URL, name: string): number | null {
  const v = filterInt(param(url, name));
  return v === null || v === 0 ? null : v;
}

const notFound = () =>
  new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

const redirect = (location: string, status: 301 | 302 = 302) =>
  new Response(null, { status, headers: { Location: location } });

const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

async function route(request: Request, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/') return redirect(GITHUB_REPO_URL, 301);

  if (path === '/releases' || path === '/releases.json') {
    const major = majorParam(url, 'current_major_version');
    if (major === null) return notFound();
    const releases = await getAllReleases(deps, major, filterInt(param(url, 'includes_prerelease')) === 1);
    if (path === '/releases.json') return json(releases);
    return new Response(renderIndex(url.origin, major, releases), {
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    });
  }

  if (path === '/releases/latest.json') {
    const major = majorParam(url, 'major_version');
    if (major === null) return notFound();
    const releases = await getAllReleases(deps, major, filterInt(param(url, 'includes_prerelease')) === 1);
    return json(releases.length === 0 ? {} : releases[0]);
  }

  if (path === '/downloads/latest.zip') {
    const major = majorParam(url, 'major_version');
    if (major === null) return notFound();
    const releases = await getAllReleases(deps, major);
    if (releases.length === 0) return notFound();
    return redirect(`${DOWNLOAD_BASE}/v${releases[0].version}/PortalDots.zip`);
  }

  const zip = /^\/downloads\/PortalDots-([A-Za-z0-9.-]+)\.zip$/.exec(path);
  if (zip) {
    const version = parseVersion(zip[1]);
    if (!version) return notFound();
    return redirect(`${DOWNLOAD_BASE}/v${fullVersion(version)}/PortalDots.zip`);
  }

  return notFound();
}

export async function handleRequest(request: Request, deps: Deps): Promise<Response> {
  let response: Response;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response = new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  } else {
    response = await route(request, deps);
    if (request.method === 'HEAD') response = new Response(null, response);
  }
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, {
      fetchFn: (input, init) => fetch(input, init),
      cache: caches.default,
      githubToken: env.GITHUB_TOKEN,
      waitUntil: (p) => ctx.waitUntil(p),
    });
  },
} satisfies ExportedHandler<Env>;
