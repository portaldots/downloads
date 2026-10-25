import { describe, expect, it } from 'vitest';
import { escapeHtml, handleRequest } from '../src/index';
import { ghAsset, ghRelease, harness } from './helpers';

const pages = [
  [
    ghRelease('v6.1.0-beta.1', [ghAsset('PortalDots.zip')], true),
    ghRelease('v6.0.0', [ghAsset('PortalDots.zip')]),
    ghRelease('v5.2.0', [ghAsset('PortalDots.zip')]),
    ghRelease('v5.1.0', [ghAsset('PortalDots.zip')]),
  ],
];

async function get(path: string, method = 'GET') {
  const h = harness(pages);
  return handleRequest(new Request(`https://releases.example.com${path}`, { method }), h.deps);
}

describe('ルーティング', () => {
  it('GET / は GitHub へ 301', async () => {
    const res = await get('/');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://github.com/portaldots/downloads');
  });

  it('全レスポンスに CORS と noindex を付ける(404 と 405 も含む)', async () => {
    for (const [path, method] of [['/', 'GET'], ['/releases.json?current_major_version=6', 'GET'], ['/nothing', 'GET'], ['/', 'POST']]) {
      const res = await get(path, method);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    }
  });

  it('GET /releases.json は降順の配列', async () => {
    const res = await get('/releases.json?current_major_version=5');
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = (await res.json()) as Array<{ version: string }>;
    expect(body.map((r) => r.version)).toEqual(['5.2.0', '5.1.0']);
  });

  it('includes_prerelease=1 でプレリリースを含める。他の値では含めない', async () => {
    const on = (await (await get('/releases.json?current_major_version=6&includes_prerelease=1')).json()) as unknown[];
    const off = (await (await get('/releases.json?current_major_version=6&includes_prerelease=2')).json()) as unknown[];
    expect(on).toHaveLength(2);
    expect(off).toHaveLength(1);
  });

  it('current_major_version がない・0・不正なら 404', async () => {
    for (const q of ['', '?current_major_version=0', '?current_major_version=abc']) {
      expect((await get(`/releases.json${q}`)).status).toBe(404);
      expect((await get(`/releases${q}`)).status).toBe(404);
    }
  });

  it('該当なしの releases.json は空配列', async () => {
    expect(await (await get('/releases.json?current_major_version=99')).json()).toEqual([]);
  });

  it('latest.json は最新1件、該当なしは {}', async () => {
    const ok = (await (await get('/releases/latest.json?major_version=5')).json()) as { version: string };
    expect(ok.version).toBe('5.2.0');
    expect((await get('/releases/latest.json?major_version=0')).status).toBe(404);
    expect(await (await get('/releases/latest.json?major_version=99')).text()).toBe('{}');
  });

  it('latest.json は major_version がなければ 404', async () => {
    expect((await get('/releases/latest.json')).status).toBe(404);
  });

  it('/downloads/latest.zip は最新版の ZIP へ 302、該当なしは 404', async () => {
    const res = await get('/downloads/latest.zip?major_version=5');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(
      'https://github.com/portaldots/PortalDots/releases/download/v5.2.0/PortalDots.zip',
    );
    expect((await get('/downloads/latest.zip?major_version=99')).status).toBe(404);
    expect((await get('/downloads/latest.zip')).status).toBe(404);
  });

  it('latest.zip はプレリリースを選ばない', async () => {
    const res = await get('/downloads/latest.zip?major_version=6');
    expect(res.headers.get('Location')).toContain('/v6.0.0/');
  });

  it('/downloads/PortalDots-{version}.zip は SemVer なら 302、不正なら 404', async () => {
    const ok = await get('/downloads/PortalDots-6.0.0-beta.1.zip');
    expect(ok.status).toBe(302);
    expect(ok.headers.get('Location')).toBe(
      'https://github.com/portaldots/PortalDots/releases/download/v6.0.0-beta.1/PortalDots.zip',
    );
    expect((await get('/downloads/PortalDots-latest.zip')).status).toBe(404);
    expect((await get('/downloads/PortalDots-1.0.zip')).status).toBe(404);
    expect((await get('/downloads/PortalDots-01.0.0.zip')).status).toBe(404);
  });

  it('未定義のパスは 404、GET/HEAD 以外は 405', async () => {
    expect((await get('/foo')).status).toBe(404);
    expect((await get('/releases.json?current_major_version=6', 'POST')).status).toBe(405);
  });
});

describe('HTML 一覧', () => {
  it('バージョンへのリンクを含み、リクエストのホストを使う', async () => {
    const res = await get('/releases?current_major_version=5');
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<title>PortalDots 5 Releases</title>');
    expect(html).toContain('href="https://releases.example.com/downloads/PortalDots-5.2.0.zip"');
    expect(html).toContain('5.1.0');
  });

  it('値をHTMLエスケープする', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#039;&lt;/a&gt;');
  });
});
