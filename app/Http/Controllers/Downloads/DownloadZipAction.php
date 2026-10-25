<?php

namespace App\Http\Controllers\Downloads;

use App\Http\Controllers\Controller;
use App\Services\ValueObjects\Version;

class DownloadZipAction extends Controller
{
    public function __invoke(string $version)
    {
        $version_info = Version::parse($version);

        if (empty($version_info)) {
            abort(404);
        }

        return redirect(
            "https://github.com/portaldots/PortalDots/releases/download/v{$version_info->getFullVersion()}/PortalDots.zip"
        );
    }
}
