<?php

namespace App\Http\Controllers\Downloads;

use App\Http\Controllers\Controller;
use App\Services\ReleaseInfoService;
use Illuminate\Http\Request;

class DownloadLatestZipAction extends Controller
{
    /**
     * @var ReleaseInfoService
     */
    private $releaseInfoService;

    public function __construct(ReleaseInfoService $releaseInfoService)
    {
        $this->releaseInfoService = $releaseInfoService;
    }

    public function __invoke(Request $request)
    {
        $major_version = filter_var($request->input('major_version'), FILTER_VALIDATE_INT);

        if (empty($major_version)) {
            abort(404);
        }

        $releases = $this->releaseInfoService->getAllReleases($major_version);

        if (count($releases) === 0) {
            abort(404);
        }

        $latest_release_version = $releases[0]->getVersion()->getFullVersion();

        return redirect(
            "https://github.com/portaldots/PortalDots/releases/download/v{$latest_release_version}/PortalDots.zip"
        );
    }
}
