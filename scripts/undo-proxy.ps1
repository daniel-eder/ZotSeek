# Zotero Extension Proxy Undo for Windows
$extId = "zotseek@zotero.org"

# Locate Zotero profiles
$profilesDir = "$env:APPDATA\Zotero\Zotero\Profiles"
if (-not (Test-Path $profilesDir)) {
    Write-Error "Zotero profile directory not found at $profilesDir"
    exit 1
}

$profile = Get-ChildItem -Path $profilesDir -Filter "*.default*" | Select-Object -First 1
if (-not $profile) {
    Write-Error "No Zotero profile found."
    exit 1
}

$extDir = Join-Path $profile.FullName "extensions"
$proxyFile = Join-Path $extDir $extId

if (Test-Path $proxyFile) {
    Remove-Item -Path $proxyFile -Force
    Write-Host "Extension proxy removed at: $proxyFile"
} else {
    Write-Host "Extension proxy not found at: $proxyFile. Nothing to undo."
}

# Force Zotero to re-scan extensions by removing version/build ID from prefs.js
$prefsFile = Join-Path $profile.FullName "prefs.js"
if (Test-Path $prefsFile) {
    Write-Host "Forcing Zotero to re-scan extensions folder..."
    $prefsContent = Get-Content -Path $prefsFile
    $newContent = $prefsContent | Where-Object { 
        $_ -notmatch "extensions\.lastAppBuildId" -and $_ -notmatch "extensions\.lastAppVersion" 
    }
    Set-Content -Path $prefsFile -Value $newContent
    Write-Host "Updated prefs.js (removed extension version markers)"
}

Write-Host "Note: Ensure Zotero is CLOSED for the re-scan to take effect."
Write-Host "Restart Zotero to apply changes."
