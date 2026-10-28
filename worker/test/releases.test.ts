import { describe, expect, it } from 'vitest';
import { getAllReleases } from '../src/releases';
import { ghAsset, ghRelease, harness } from './helpers';

describe('getAllReleases (ReleaseInfoServiceTest 相当)', () => {
  it('複数の成果物があるリリースでもPortalDots.zipを選ぶ', async () => {
    const h = harness([[ghRelease('v6.0.0', [ghAsset('PortalDots-update.zip'), ghAsset('PortalDots.zip')])]]);
    const releases = await getAllReleases(h.deps, 6);
    expect(releases).toHaveLength(1);
    expect(releases[0].browser_download_url.endsWith('/PortalDots.zip')).toBe(true);
  });

  it('PortalDots.zipがないリリースは除外する', async () => {
    const h = harness([
      [
        ghRelease('v6.0.1', [ghAsset('a.zip'), ghAsset('b.json')]),
        ghRelease('v6.0.0', []),
        ghRelease('v5.0.2', [ghAsset('PortalDots.zip')]),
      ],
    ]);
    expect(await getAllReleases(h.deps, 6)).toEqual([]);
  });

  it('成果物が1つだけの旧リリースはその成果物を使う', async () => {
    const h = harness([[ghRelease('v1.2.2', [ghAsset('PortalDots_v1.2.2.zip')])]]);
    const releases = await getAllReleases(h.deps, 1);
    expect(releases).toHaveLength(1);
    expect(releases[0].browser_download_url.endsWith('/PortalDots_v1.2.2.zip')).toBe(true);
  });

  it('100件を超えるリリースは次のページも取得する', async () => {
    const first = Array.from({ length: 100 }, (_, i) => ghRelease(`v4.0.${i}`, [ghAsset('PortalDots.zip')]));
    const second = [ghRelease('v6.0.0', [ghAsset('PortalDots.zip')])];
    const h = harness([first, second]);
    const releases = await getAllReleases(h.deps, 6);
    expect(releases.map((r) => r.version)).toEqual(['6.0.0']);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[0].url).toContain('per_page=100&page=1');
  });

  it('最大10ページで取得を打ち切る', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ghRelease(`v4.0.${i}`, [ghAsset('PortalDots.zip')]));
    const h = harness(Array.from({ length: 12 }, () => full));
    await getAllReleases(h.deps, 4);
    expect(h.calls).toHaveLength(10);
  });
});

describe('絞り込みとソート', () => {
  const pages = [
    [
      ghRelease('v6.0.0-beta.1', [ghAsset('PortalDots.zip')], true),
      ghRelease('v6.0.0', [ghAsset('PortalDots.zip')]),
      ghRelease('v6.0.0-rc.1', [ghAsset('PortalDots.zip')], true),
      ghRelease('v5.10.0', [ghAsset('PortalDots.zip')]),
      ghRelease('v5.9.1', [ghAsset('PortalDots.zip')]),
      ghRelease('v5.2.0', [ghAsset('PortalDots.zip')]),
      ghRelease('not-semver', [ghAsset('PortalDots.zip')]),
      ghRelease('v01.0.0', [ghAsset('PortalDots.zip')]),
    ],
  ];

  it('メジャーバージョンで絞り込み、バージョン降順に並べる', async () => {
    const h = harness(pages);
    expect((await getAllReleases(h.deps, 5)).map((r) => r.version)).toEqual(['5.10.0', '5.9.1', '5.2.0']);
  });

  it('プレリリースは既定で除外する', async () => {
    const h = harness(pages);
    expect((await getAllReleases(h.deps, 6)).map((r) => r.version)).toEqual(['6.0.0']);
  });

  it('プレリリースを含める場合、正式版 > rc > beta の順になる', async () => {
    const h = harness(pages);
    expect((await getAllReleases(h.deps, 6, true)).map((r) => r.version)).toEqual([
      '6.0.0',
      '6.0.0-rc.1',
      '6.0.0-beta.1',
    ]);
  });

  it('該当するメジャーバージョンがなければ空', async () => {
    const h = harness(pages);
    expect(await getAllReleases(h.deps, 99)).toEqual([]);
  });

  it('JSON の形式(キーと published_at)が PHP 版と同じ', async () => {
    const h = harness(pages);
    const [r] = await getAllReleases(h.deps, 5);
    expect(Object.keys(r)).toEqual(['version', 'published_at', 'html_url', 'browser_download_url', 'size', 'body']);
    expect(r.published_at).toBe('2026-01-01T00:00:00+00:00');
    expect(r.size).toBe(100);
  });
});

describe('キャッシュと GitHub 障害時の挙動', () => {
  const pages = [[ghRelease('v6.0.0', [ghAsset('PortalDots.zip')])]];

  it('120秒以内は GitHub を再取得しない', async () => {
    const h = harness(pages);
    await getAllReleases(h.deps, 6);
    h.setNow(1_000_000 + 119_000);
    await getAllReleases(h.deps, 5);
    expect(h.calls).toHaveLength(1);
  });

  it('120秒を過ぎたら再取得する', async () => {
    const h = harness(pages);
    await getAllReleases(h.deps, 6);
    h.setNow(1_000_000 + 121_000);
    await getAllReleases(h.deps, 6);
    expect(h.calls).toHaveLength(2);
  });

  it('GitHub が失敗したとき、期限切れでもキャッシュがあれば返す', async () => {
    const h = harness(pages);
    await getAllReleases(h.deps, 6);
    h.setNow(1_000_000 + 10 * 60_000);
    h.setFail(true);
    expect((await getAllReleases(h.deps, 6)).map((r) => r.version)).toEqual(['6.0.0']);
  });

  it('GitHub の障害中は、30秒の間は再取得せず期限切れのキャッシュを返す', async () => {
    const h = harness(pages);
    await getAllReleases(h.deps, 6);
    h.setNow(1_000_000 + 10 * 60_000);
    h.setFail(true);
    await getAllReleases(h.deps, 6);
    h.setNow(1_000_000 + 10 * 60_000 + 29_000);
    await getAllReleases(h.deps, 6);
    expect(h.calls).toHaveLength(2);
    h.setNow(1_000_000 + 10 * 60_000 + 31_000);
    await getAllReleases(h.deps, 6);
    expect(h.calls).toHaveLength(3);
  });

  it('GitHub が失敗し、キャッシュもなければ空配列。失敗はキャッシュしない', async () => {
    const h = harness(pages);
    h.setFail(true);
    expect(await getAllReleases(h.deps, 6)).toEqual([]);
    h.setFail(false);
    expect(await getAllReleases(h.deps, 6)).toHaveLength(1);
  });

  it('2ページ目で失敗した場合は空(部分的な結果を返さない)', async () => {
    const first = Array.from({ length: 100 }, (_, i) => ghRelease(`v6.0.${i}`, [ghAsset('PortalDots.zip')]));
    const h = harness([first]);
    const original = h.deps.fetchFn;
    h.deps.fetchFn = (async (input: string, init?: RequestInit) =>
      String(input).includes('page=2') ? new Response('x', { status: 502 }) : original(input, init)) as typeof fetch;
    expect(await getAllReleases(h.deps, 6)).toEqual([]);
  });

  it('GITHUB_TOKEN があれば Authorization ヘッダーを付け、なければ付けない', async () => {
    const withToken = harness(pages, 'dummy-token');
    await getAllReleases(withToken.deps, 6);
    expect(withToken.calls[0].headers.Authorization).toBe('Bearer dummy-token');

    const without = harness(pages);
    await getAllReleases(without.deps, 6);
    expect(without.calls[0].headers.Authorization).toBeUndefined();
  });
});
