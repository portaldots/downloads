<?php

declare(strict_types=1);

namespace App\Services;

use GuzzleHttp\Client;
use Illuminate\Contracts\Cache\Repository as Cache;
use App\Services\ValueObjects\Version;
use App\Services\ValueObjects\Release;
use Carbon\CarbonImmutable;

class ReleaseInfoService
{
    private const PER_PAGE = 100;

    private const MAX_PAGES = 10;

    private const ZIP_ASSET_NAME = 'PortalDots.zip';

    /**
     * @var Client
     */
    private $client;

    /**
     * @var Cache
     */
    private $cache;

    /**
     * @param Client $client
     * @param Cache  $cache
     */
    public function __construct(Client $client, Cache $cache)
    {
        $this->client = $client;
        $this->cache = $cache;
    }

    /**
     * 指定されたメジャーバージョン内の全リリース情報を取得する
     *
     * @return Release[]
     */
    public function getAllReleases(Int $major_version, Bool $includes_prerelease = false): array
    {
        return $this->cache->remember(
            'getAllReleases/' . $major_version . ($includes_prerelease ? '-prelease' : ''),
            120,
            function () use ($major_version, $includes_prerelease) {
                $result = [];

                // 公開済みリリースを全ページ取得する(1ページ100件、念のため最大10ページ)
                for ($page = 1; $page <= self::MAX_PAGES; $page++) {
                    $path = sprintf(
                        'https://api.github.com/repos/portaldots/PortalDots/releases?per_page=%d&page=%d',
                        self::PER_PAGE,
                        $page
                    );
                    try {
                        $releases = json_decode((string) $this->client->get($path)->getBody());
                    } catch (\Exception $e) {
                        return [];
                    }

                    if (!is_array($releases)) {
                        return [];
                    }

                    foreach ($releases as $release) {
                        $version_info = Version::parse($release->tag_name);

                        if (empty($version_info)) {
                            continue;
                        }

                        if ($version_info->getMajor() !== $major_version) {
                            continue;
                        }

                        if ($release->prerelease && !$includes_prerelease) {
                            continue;
                        }

                        // 署名済み更新ZIPやmetadataなど複数の成果物を持つリリースがあるため、
                        // 先頭の成果物ではなく PortalDots.zip を名前で選ぶ
                        $zip_asset = $this->findZipAsset($release->assets ?? []);
                        if ($zip_asset === null) {
                            continue;
                        }

                        $result[] = new Release(
                            $version_info,
                            new CarbonImmutable($release->published_at),
                            $release->html_url,
                            $zip_asset->browser_download_url,
                            $zip_asset->size,
                            (string) $release->body
                        );
                    }

                    if (count($releases) < self::PER_PAGE) {
                        break;
                    }
                }

                // バージョン順にソートする
                usort($result, function (Release $a, Release $b) {
                    if (($compare_result = version_compare($b->getVersion()->getFullVersion(), $a->getVersion()->getFullVersion())) === 0) {
                        // プレリリースバージョンで比較する
                        return $b->getVersion()->getPrerelease() <=> $a->getVersion()->getPrerelease();
                    }
                    return $compare_result;
                });

                return $result;
            }
        );
    }

    /**
     * リリースの成果物から PortalDots.zip を探す。見つからなければ null
     *
     * @param array $assets
     * @return object|null
     */
    private function findZipAsset(array $assets)
    {
        foreach ($assets as $asset) {
            if (($asset->name ?? null) === self::ZIP_ASSET_NAME) {
                return $asset;
            }
        }

        // PortalDots_v1.2.2.zip のように別名の成果物を1つだけ持つ旧リリースは、その成果物を使う
        if (count($assets) === 1) {
            return $assets[0];
        }

        return null;
    }
}
