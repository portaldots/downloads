<?php

namespace Tests\Unit;

use App\Services\ReleaseInfoService;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use Illuminate\Cache\ArrayStore;
use Illuminate\Cache\Repository;
use PHPUnit\Framework\TestCase;

class ReleaseInfoServiceTest extends TestCase
{
    private function release(string $tag, array $assets, bool $prerelease = false): array
    {
        return [
            'tag_name' => $tag,
            'prerelease' => $prerelease,
            'published_at' => '2026-01-01T00:00:00Z',
            'html_url' => "https://github.com/portaldots/PortalDots/releases/tag/{$tag}",
            'body' => 'notes',
            'assets' => $assets,
        ];
    }

    private function asset(string $name): array
    {
        return [
            'name' => $name,
            'size' => 100,
            'browser_download_url' => "https://github.com/portaldots/PortalDots/releases/download/x/{$name}",
        ];
    }

    private function service(array $pages): ReleaseInfoService
    {
        $responses = array_map(fn ($page) => new Response(200, [], json_encode($page)), $pages);
        $client = new Client(['handler' => HandlerStack::create(new MockHandler($responses))]);

        return new ReleaseInfoService($client, new Repository(new ArrayStore()));
    }

    public function test_複数の成果物があるリリースでもPortalDotsZipを選ぶ(): void
    {
        $service = $this->service([[
            $this->release('v6.0.0', [
                $this->asset('PortalDots-update.zip'),
                $this->asset('PortalDots.zip'),
            ]),
        ]]);

        $releases = $service->getAllReleases(6);

        $this->assertCount(1, $releases);
        $this->assertStringEndsWith('/PortalDots.zip', $releases[0]->getBrowserDownloadUrl());
    }

    public function test_PortalDotsZipがないリリースは除外する(): void
    {
        $service = $this->service([[
            $this->release('v6.0.1', [$this->asset('a.zip'), $this->asset('b.json')]),
            $this->release('v6.0.0', []),
            $this->release('v5.0.2', [$this->asset('PortalDots.zip')]),
        ]]);

        $this->assertSame([], $service->getAllReleases(6));
    }

    public function test_成果物が1つだけの旧リリースはその成果物を使う(): void
    {
        $service = $this->service([[
            $this->release('v1.2.2', [$this->asset('PortalDots_v1.2.2.zip')]),
        ]]);

        $releases = $service->getAllReleases(1);

        $this->assertCount(1, $releases);
        $this->assertStringEndsWith('/PortalDots_v1.2.2.zip', $releases[0]->getBrowserDownloadUrl());
    }

    public function test_100件を超えるリリースは次のページも取得する(): void
    {
        $first = [];
        for ($i = 0; $i < 100; $i++) {
            $first[] = $this->release('v4.0.' . $i, [$this->asset('PortalDots.zip')]);
        }
        $second = [$this->release('v6.0.0', [$this->asset('PortalDots.zip')])];

        $releases = $this->service([$first, $second])->getAllReleases(6);

        $this->assertCount(1, $releases);
        $this->assertSame('6.0.0', $releases[0]->getVersion()->getFullVersion());
    }
}
