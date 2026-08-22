param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Z][A-Z0-9]*-[0-9]{3}$')]
    [string]$Id,
    [Parameter(Mandatory = $true)]
    [string[]]$AllowedPath
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Normalize([string]$Value) {
    return $Value.Replace('\', '/').TrimStart('./')
}

$allowed = @($AllowedPath | ForEach-Object { Normalize $_ })
$trackedChanged = @()
$trackedChanged += & git -C $Root diff --name-only
$trackedChanged += & git -C $Root diff --cached --name-only
$trackedChanged = @($trackedChanged | ForEach-Object { Normalize $_ } | Sort-Object -Unique)
$untracked = @(& git -C $Root ls-files --others --exclude-standard | ForEach-Object { Normalize $_ } | Sort-Object -Unique)
$changed = @($trackedChanged + $untracked | Sort-Object -Unique)

$globalAllowed = @(
    'docs/modernization/STATUS.md',
    'docs/modernization/STATUS_ARCHIVE.md',
    'docs/modernization/WORK_PACKAGES.md',
    'docs/modernization/DECISIONS.md',
    'docs/modernization/RISK_REGISTER.md',
    "docs/modernization/evidence/$Id/"
)
$initialHandoff = @('V2_MODERNIZATION_PLAN.md', 'AGENTS.md', 'docs/modernization/', 'scripts/modernization/')

$unexpected = foreach ($path in $changed) {
    $ok = $false
    foreach ($prefix in @($allowed + $globalAllowed)) {
        if ($path -eq $prefix.TrimEnd('/') -or $path.StartsWith($prefix)) { $ok = $true; break }
    }
    if (-not $ok -and $path -in $untracked) {
        foreach ($prefix in $initialHandoff) {
            if ($path -eq $prefix.TrimEnd('/') -or $path.StartsWith($prefix)) { $ok = $true; break }
        }
    }
    if (-not $ok) { $path }
}

if (@($unexpected).Count -gt 0) {
    Write-Output "FAIL work-package=$Id"
    $unexpected | ForEach-Object { Write-Output "UNOWNED $_" }
    exit 1
}

Write-Output "PASS work-package=$Id changed=$($changed.Count)"
