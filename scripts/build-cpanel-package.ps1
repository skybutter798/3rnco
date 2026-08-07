[CmdletBinding()]
param(
    [string] $OutputRoot
)

$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $workspace "artifacts"
}

$required = @(
    "dist/client",
    "dist/server/index.js",
    "scripts/export-cpanel-static.mjs",
    "deploy/cpanel/.htaccess",
    "deploy/cpanel/.user.ini",
    "deploy/cpanel/uploads.htaccess",
    "server/php/public/index.php",
    "server/php/public/.htaccess",
    "server/php/src",
    "server/php/database/migrations"
)

foreach ($relativePath in $required) {
    $candidate = Join-Path $workspace $relativePath
    if (-not (Test-Path -LiteralPath $candidate)) {
        throw "Required build input is missing: $relativePath. Run npm run build and complete the PHP backend first."
    }
}

$stamp = [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssZ")
$releaseRoot = Join-Path $OutputRoot "cpanel-$stamp"
$siteStage = Join-Path $releaseRoot "public_html"
$appStage = Join-Path $releaseRoot "application"

New-Item -ItemType Directory -Path $siteStage -Force | Out-Null
New-Item -ItemType Directory -Path $appStage -Force | Out-Null

& node (Join-Path $workspace "scripts/export-cpanel-static.mjs") $siteStage "https://3rnco.com.my"
if ($LASTEXITCODE -ne 0) { throw "Unable to export the current Vinext build for cPanel." }

Copy-Item -LiteralPath (Join-Path $workspace "deploy/cpanel/.htaccess") -Destination (Join-Path $siteStage ".htaccess")
Copy-Item -LiteralPath (Join-Path $workspace "deploy/cpanel/.user.ini") -Destination (Join-Path $siteStage ".user.ini")

$apiStage = Join-Path $siteStage "api"
New-Item -ItemType Directory -Path $apiStage -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $workspace "server/php/public/index.php") -Destination (Join-Path $apiStage "index.php")
Copy-Item -LiteralPath (Join-Path $workspace "server/php/public/.htaccess") -Destination (Join-Path $apiStage ".htaccess")

$uploadStage = Join-Path $releaseRoot "shared-uploads"
New-Item -ItemType Directory -Path $uploadStage -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $workspace "deploy/cpanel/uploads.htaccess") -Destination (Join-Path $uploadStage ".htaccess")

foreach ($directory in @("database", "scripts", "src")) {
    Copy-Item -LiteralPath (Join-Path $workspace "server/php/$directory") -Destination $appStage -Recurse
}
foreach ($file in @("README.md", ".env.example")) {
    $source = Join-Path $workspace "server/php/$file"
    if (Test-Path -LiteralPath $source) {
        Copy-Item -LiteralPath $source -Destination $appStage
    }
}

$webArchive = Join-Path $releaseRoot "public-html.tar.gz"
$appArchive = Join-Path $releaseRoot "application.tar.gz"
$uploadsArchive = Join-Path $releaseRoot "shared-uploads.tar.gz"
& tar -czf $webArchive -C $siteStage .
if ($LASTEXITCODE -ne 0) { throw "Unable to create the public_html archive." }
& tar -czf $appArchive -C $appStage .
if ($LASTEXITCODE -ne 0) { throw "Unable to create the application archive." }
& tar -czf $uploadsArchive -C $uploadStage .
if ($LASTEXITCODE -ne 0) { throw "Unable to create the shared uploads archive." }

$hashes = Get-FileHash -Algorithm SHA256 -LiteralPath $webArchive, $appArchive, $uploadsArchive
$hashes | Format-Table -AutoSize
Write-Output "Release package: $releaseRoot"
