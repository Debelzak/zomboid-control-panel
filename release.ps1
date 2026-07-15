<#
.SYNOPSIS
    Full build, deploy, and GitHub release pipeline for Zomboid Control Panel.

.DESCRIPTION
    This script automates the entire release process:
    0. Pre-flight checks (uncommitted changes, network reachability)
    1. Bumps version in package.json (Dev1 + GitHub) — auto-increments if no -Version given
    2. Builds the client (Vite/React)
    3. Builds Windows + Linux binaries (esbuild + pkg)
    4. Builds Docker image
    5. Deploys PanelBridge.lua to the live PZ server
    6. Deploys the full release to \\garage\PZ\Admin_panel
    7. Syncs files to the GitHub working copy
    8. Commits and pushes to GitHub
    9. Creates a GitHub Release with Keep a Changelog format notes

.PARAMETER Version
    Explicit version string (e.g., "0.9.0"). If omitted, auto-increments based on -Bump.

.PARAMETER Bump
    Auto-increment type when -Version is not provided. Valid: major, minor, patch (default: patch).

.PARAMETER ReleaseTitle
    Custom release title. Defaults to "v<Version>".

.PARAMETER ReleaseNotes
    Path to a markdown file with release notes. If omitted, auto-generates from commits.

.PARAMETER SkipBuild
    Skip the client and exe build steps (use existing release/ folder).

.PARAMETER SkipDeploy
    Skip deploying to the live server.

.PARAMETER SkipGitHub
    Skip git commit/push and GitHub release creation.

.PARAMETER SkipDocker
    Skip building the Docker image.

.PARAMETER DryRun
    Show what would happen without making changes.

.EXAMPLE
    .\release.ps1                                          # Auto-increment patch
    .\release.ps1 -Version "0.9.0"                         # Explicit version
    .\release.ps1 -Bump minor                              # Auto-increment minor
    .\release.ps1 -Version "0.9.0" -SkipDocker             # Skip Docker build
    .\release.ps1 -DryRun                                  # Preview all steps
#>

param(
    [string]$Version = "",

    [ValidateSet("major", "minor", "patch")]
    [string]$Bump = "patch",

    [string]$ReleaseTitle = "",

    [string]$ReleaseNotes = "",

    [switch]$SkipBuild,
    [switch]$SkipDeploy,
    [switch]$SkipGitHub,
    [switch]$SkipDocker,
    [switch]$DryRun
)

# ============================================
# CONFIGURATION - Edit these paths as needed
# ============================================
$Dev1Dir          = "D:\Zomboid_dev_panel\Dev1"
$GitHubDir        = "D:\Zomboid_dev_panel\GitHub"
# PanelBridge.lua is a server-side drop-in, not a Workshop mod. PZ loads it
# directly from the base install's media/lua/server/ folder. There is NO
# client-side component (all handlers run server-side only).
$LivePanelBridgeDir = "\\garage\pz\LiveB42\Install\media\lua\server"
$LiveAdminPanel   = "\\garage\PZ\Admin_panel"
$GitHubRepo       = "fpsacha/zomboid-control-panel"

# Source paths (relative to Dev1Dir)
$PanelBridgeModDir = "pz-mod\PanelBridge"
$PanelBridgeSrc    = "pz-mod\PanelBridge\media\lua\server\PanelBridge.lua"
$ReleaseDir       = "release"
$WinExePath       = "release\ZomboidControlPanel.exe"
$LinuxBinPath     = "release\ZomboidControlPanel"
$WinZipPath       = "release\ZomboidControlPanel-windows.zip"
$LinuxTarPath     = "release\ZomboidControlPanel-linux.tar.gz"
$ChecksumsPath    = "release\checksums.txt"
$ManifestPath     = "release\release-manifest.json"

# ============================================
# HELPERS
# ============================================
$ErrorActionPreference = "Stop"

function Write-Step($step, $msg) {
    Write-Host ""
    Write-Host "[$step] $msg" -ForegroundColor Cyan
    Write-Host ("-" * 60) -ForegroundColor DarkGray
}

function Write-Ok($msg)   { Write-Host "  OK: $msg" -ForegroundColor Green }
function Write-Skip($msg) { Write-Host "  SKIP: $msg" -ForegroundColor Yellow }
function Write-Dry($msg)  { Write-Host "  DRY RUN: $msg" -ForegroundColor Magenta }
function Write-Warn($msg) { Write-Host "  WARN: $msg" -ForegroundColor Yellow }

# ============================================
# AUTO-VERSION: Increment from current package.json if no -Version given
# ============================================
if (-not $Version) {
    $pkgContent = Get-Content (Join-Path $Dev1Dir "package.json") -Raw | ConvertFrom-Json
    $currentVersion = $pkgContent.version
    # Strip any pre-release suffix for numeric parsing
    $numericPart = ($currentVersion -split '-')[0]
    $parts = $numericPart -split '\.'
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]($parts[2] -replace '[^0-9]', '')

    switch ($Bump) {
        "major" { $major++; $minor = 0; $patch = 0 }
        "minor" { $minor++; $patch = 0 }
        "patch" { $patch++ }
    }
    $Version = "$major.$minor.$patch"
    Write-Host "  Auto-incremented version: $currentVersion -> $Version (bump: $Bump)" -ForegroundColor Magenta
}

$TagName = "v$Version"
if (-not $ReleaseTitle) { $ReleaseTitle = "$TagName" }

Write-Host ""
Write-Host "============================================" -ForegroundColor White
Write-Host " Zomboid Control Panel - Release Pipeline"   -ForegroundColor White
Write-Host "============================================" -ForegroundColor White
Write-Host " Version:  $Version"
Write-Host " Tag:      $TagName"
Write-Host " Title:    $ReleaseTitle"
Write-Host " DryRun:   $DryRun"
Write-Host ""

# ============================================
# STEP 0: Pre-flight checks
# ============================================
Write-Step "0/9" "Pre-flight checks"

# Check for uncommitted changes in Dev1/
Push-Location $Dev1Dir
try { $gitStatus = git status --porcelain 2>$null } catch { $gitStatus = $null }
Pop-Location
if ($gitStatus) {
    Write-Warn "Uncommitted changes detected in Dev1/:"
    $gitStatus | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkYellow }
    $confirm = Read-Host "  Continue with uncommitted changes? (y/N)"
    if ($confirm -ne 'y') {
        Write-Host "  Aborted." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Ok "No uncommitted changes in Dev1/"
}

# Verify \\garage is reachable (unless skipping deploy)
if (-not $SkipDeploy) {
    # Test-Path on a bare \\host (no share) can fail even when shares are reachable.
    # Check a known share path instead. Use single-backslash form (double-escaped
    # form "\\\\garage\\PZ" doesn't parse as a valid UNC on some PowerShell versions).
    if (Test-Path '\\garage\PZ' -ErrorAction SilentlyContinue) {
        Write-Ok "\\garage is reachable"
    } else {
        Write-Host "  ERROR: \\garage\PZ is not reachable. Use -SkipDeploy to skip deployment." -ForegroundColor Red
        exit 1
    }
}

# ============================================
# STEP 1: Bump version in package.json files
# ============================================
Write-Step "1/9" "Bumping version to $Version"

$packageFiles = @(
    (Join-Path $Dev1Dir "package.json"),
    (Join-Path $GitHubDir "package.json")
)

foreach ($pkgFile in $packageFiles) {
    if (Test-Path $pkgFile) {
        $content = Get-Content $pkgFile -Raw
        $newContent = $content -replace '"version":\s*"[^"]*"', "`"version`": `"$Version`""
        if ($DryRun) {
            Write-Dry "Would update $pkgFile"
        } else {
            # Set-Content intermittently throws "Stream was not readable" in some
            # shells even when the file is writable; direct file I/O is reliable.
            [System.IO.File]::WriteAllText($pkgFile, $newContent, [System.Text.UTF8Encoding]::new($false))
            Write-Ok "Updated $pkgFile"
        }
    } else {
        Write-Warning "Package file not found: $pkgFile"
    }
}

# ============================================
# STEP 2: Build client
# ============================================
Write-Step "2/9" "Building client (Vite/React)"

if ($SkipBuild) {
    Write-Skip "Build skipped (-SkipBuild)"
} elseif ($DryRun) {
    Write-Dry "Would run: cd client && npm run build"
} else {
    Push-Location (Join-Path $Dev1Dir "client")
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "Client build failed" }
        Write-Ok "Client built successfully"
    } finally {
        Pop-Location
    }
}

# ============================================
# STEP 3: Build binaries
# ============================================
Write-Step "3/9" "Building Windows + Linux binaries (esbuild + pkg)"

if ($SkipBuild) {
    Write-Skip "Build skipped (-SkipBuild)"
} elseif ($DryRun) {
    Write-Dry "Would run: npm run build:exe:all, then create ZomboidControlPanel-windows.zip"
} else {
    Push-Location $Dev1Dir
    try {
        npm run build:exe:all
        if ($LASTEXITCODE -ne 0) { throw "Binary build failed" }
        
        $winExe = Join-Path $Dev1Dir $WinExePath
        $linuxBin = Join-Path $Dev1Dir $LinuxBinPath
        $checksums = Join-Path $Dev1Dir $ChecksumsPath
        $manifest = Join-Path $Dev1Dir $ManifestPath
        
        if (-not (Test-Path $winExe)) { throw "Windows binary not found at $winExe" }
        if (-not (Test-Path $linuxBin)) { throw "Linux binary not found at $linuxBin" }
        if (-not (Test-Path $checksums)) { throw "Checksums file not found at $checksums" }
        if (-not (Test-Path $manifest)) { throw "Release manifest not found at $manifest" }

        $winSize = [math]::Round((Get-Item $winExe).Length / 1MB, 1)
        $linuxSize = [math]::Round((Get-Item $linuxBin).Length / 1MB, 1)
        Write-Ok "Windows binary built: $winSize MB"
        Write-Ok "Linux binary built: $linuxSize MB"
        Write-Ok "Checksums and manifest generated"

        # Package Windows release archive (full folder with client/dist, pz-mod, scripts etc.)
        # Belt-and-braces: explicitly exclude data/db.json and data/backups so a stray
        # runtime database from local testing can never end up in a public release
        # (issue #5: clobbering users' admin/server config on extract).
        $zipPath = Join-Path $Dev1Dir $WinZipPath
        if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
        $releaseFolder = Join-Path $Dev1Dir $ReleaseDir
        $strayDb = Join-Path $releaseFolder "data\db.json"
        if (Test-Path $strayDb) {
            Write-Warn "Removing stray data\db.json from release\ before archiving"
            Remove-Item $strayDb -Force
        }
        $strayBackups = Join-Path $releaseFolder "data\backups"
        if (Test-Path $strayBackups) {
            Write-Warn "Removing stray data\backups\ from release\ before archiving"
            Remove-Item $strayBackups -Recurse -Force
        }
        Compress-Archive -Path "$releaseFolder\*" -DestinationPath $zipPath
        $zipSize = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
        Write-Ok "Windows archive created: ZomboidControlPanel-windows.zip ($zipSize MB)"

        # Package Linux release archive (tar.gz to preserve +x permissions)
        $tarPath = Join-Path $Dev1Dir $LinuxTarPath
        if (Test-Path $tarPath) { Remove-Item $tarPath -Force }
        Push-Location $releaseFolder
        tar -czf $tarPath --exclude="ZomboidControlPanel.exe" --exclude="ZomboidControlPanel-windows.zip" --exclude="ZomboidControlPanel-linux.tar.gz" --exclude="Start.bat" --exclude="data/db.json" --exclude="data/backups" *
        Pop-Location
        $tarSize = [math]::Round((Get-Item $tarPath).Length / 1MB, 1)
        Write-Ok "Linux archive created: ZomboidControlPanel-linux.tar.gz ($tarSize MB)"

        $releaseArtifacts = @(
            @{ platform = "win";   kind = "binary"; file = "ZomboidControlPanel.exe";          path = $winExe },
            @{ platform = "linux"; kind = "binary"; file = "ZomboidControlPanel";              path = $linuxBin },
            @{ platform = "win";   kind = "archive"; file = "ZomboidControlPanel-windows.zip"; path = $zipPath },
            @{ platform = "linux"; kind = "archive"; file = "ZomboidControlPanel-linux.tar.gz"; path = $tarPath }
        )

        $checksumLines = @()
        $manifestArtifacts = @()
        foreach ($artifact in $releaseArtifacts) {
            $hash = (Get-FileHash -Algorithm SHA256 -Path $artifact.path).Hash.ToLowerInvariant()
            $checksumLines += "$hash  $($artifact.file)"
            $manifestArtifacts += [pscustomobject]@{
                platform = $artifact.platform
                kind = $artifact.kind
                file = $artifact.file
                sha256 = $hash
            }
        }
        Set-Content -Path $checksums -Value ($checksumLines -join "`n") -NoNewline
        Add-Content -Path $checksums -Value ""
        $manifestObject = [pscustomobject]@{
            version = $Version
            builtAt = (Get-Date).ToUniversalTime().ToString("o")
            hostPlatform = "win32"
            targets = @("win", "linux")
            artifacts = $manifestArtifacts
        }
        $manifestObject | ConvertTo-Json -Depth 5 | Set-Content -Path $manifest -NoNewline
        Write-Ok "Checksums and manifest updated for binaries + archives"
    } finally {
        Pop-Location
    }

    # Post-build verification
    $clientDist = Join-Path $Dev1Dir "client\dist"
    if (-not (Test-Path $clientDist) -or (Get-ChildItem $clientDist -Recurse -File).Count -eq 0) {
        throw "Build verification failed: client/dist/ is empty or missing"
    }
    Write-Ok "Build verification passed (exe + client/dist validated)"
}

# ============================================
# STEP 4: Build Docker image
# ============================================
Write-Step "4/9" "Building Docker image"

if ($SkipDocker) {
    Write-Skip "Docker build skipped (-SkipDocker)"
} elseif ($DryRun) {
    Write-Dry "Would run: docker build -t zomboid-panel:$TagName"
} else {
    $dockerAvailable = Get-Command docker -ErrorAction SilentlyContinue
    if ($dockerAvailable) {
        Push-Location $Dev1Dir
        try {
            docker build -t "zomboid-panel:$TagName" -t "zomboid-panel:latest" .
            if ($LASTEXITCODE -ne 0) { throw "Docker build failed" }
            Write-Ok "Docker image built: zomboid-panel:$TagName"
        } finally {
            Pop-Location
        }
    } else {
        Write-Warn "Docker not found on PATH — skipping Docker build"
    }
}

# ============================================
# STEP 5: Deploy PanelBridge.lua (server-side drop-in) to live PZ server
# ============================================
Write-Step "5/9" "Deploying PanelBridge.lua to live server"

if ($SkipDeploy) {
    Write-Skip "Deploy skipped (-SkipDeploy)"
} elseif ($DryRun) {
    Write-Dry "Would copy PanelBridge.lua to $LivePanelBridgeDir"
} else {
    $bridgeSrc = Join-Path $Dev1Dir $PanelBridgeSrc
    # Ensure target dir exists (Install/media/lua/server)
    New-Item -Path $LivePanelBridgeDir -ItemType Directory -Force | Out-Null
    # Server-side drop-in: one Lua file, no mod.info, no client file
    Copy-Item $bridgeSrc "$LivePanelBridgeDir\PanelBridge.lua" -Force
    Write-Ok "PanelBridge.lua deployed to $LivePanelBridgeDir"
}

# ============================================
# STEP 6: Deploy full release to Admin Panel
# ============================================
Write-Step "6/9" "Deploying release to $LiveAdminPanel"

if ($SkipDeploy) {
    Write-Skip "Deploy skipped (-SkipDeploy)"
} elseif ($DryRun) {
    Write-Dry "Would run deploy.ps1 and restart local backend"
} else {
    Push-Location $Dev1Dir
    try {
        & ".\deploy.ps1"
        Write-Ok "Release deployed to $LiveAdminPanel"
    } finally {
        Pop-Location
    }

    # Restart local dev backend so the UI version badge updates immediately
    $port3001 = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue |
                Select-Object -First 1 -ExpandProperty OwningProcess
    if ($port3001 -and $port3001 -ne 0) {
        Stop-Process -Id $port3001 -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        Start-Process -FilePath "node" -ArgumentList "server/index.js" -WorkingDirectory $Dev1Dir -WindowStyle Hidden
        Write-Ok "Local backend restarted (PID $port3001 stopped, new instance launched)"
    } else {
        Write-Ok "No local backend running on port 3001 — skipping restart"
    }
}

# ============================================
# STEP 7: Sync files to GitHub working copy
# ============================================
Write-Step "7/9" "Syncing files to GitHub folder"

if ($SkipGitHub) {
    Write-Skip "GitHub sync skipped (-SkipGitHub)"
} elseif ($DryRun) {
    Write-Dry "Would sync Dev1 files to GitHub folder"
} else {
    # Sync key files from Dev1 to GitHub (excluding node_modules, .env, db.json, dist, release)
    $syncItems = @(
        ".github",
        "server",
        "pz-mod",
        "Screenshots",
        "client\src",
        "client\public",
        "client\index.html",
        "client\package.json",
        "client\tsconfig.json",
        "client\vite.config.ts",
        "client\tailwind.config.js",
        "client\postcss.config.js",
        "client\components.json",
        "package.json",
        "package-lock.json",
        "build.js",
        "server.cjs",
        "nodemon.json",
        "client\package-lock.json",
        "Start.bat",
        "deploy.ps1",
        "deploy-safe.ps1",
        "deploy-remote.ps1",
        "release.ps1",
        "Dockerfile",
        "docker-compose.yml",
        "zomboid-panel.service",
        "README.md",
        "LICENSE"
    )
    
    foreach ($item in $syncItems) {
        $srcPath = Join-Path $Dev1Dir $item
        $dstPath = Join-Path $GitHubDir $item
        
        if (Test-Path $srcPath) {
            $dstDir = Split-Path $dstPath -Parent
            if (-not (Test-Path $dstDir)) {
                New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
            }
            
            if ((Get-Item $srcPath).PSIsContainer) {
                # It's a directory - use robocopy for mirror
                robocopy $srcPath $dstPath /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
            } else {
                Copy-Item $srcPath $dstPath -Force
            }
        }
    }
    
    # Always sync PanelBridge.lua specifically
    $pbSrc = Join-Path $Dev1Dir $PanelBridgeSrc
    $pbDst = Join-Path $GitHubDir $PanelBridgeSrc
    $pbDstDir = Split-Path $pbDst -Parent
    if (-not (Test-Path $pbDstDir)) { New-Item -ItemType Directory -Path $pbDstDir -Force | Out-Null }
    Copy-Item $pbSrc $pbDst -Force
    
    Write-Ok "Files synced to GitHub folder"
}

# ============================================
# STEP 8: Git commit and push
# ============================================
Write-Step "8/9" "Committing and pushing to GitHub"

if ($SkipGitHub) {
    Write-Skip "GitHub push skipped (-SkipGitHub)"
} elseif ($DryRun) {
    Write-Dry "Would commit and push to $GitHubRepo"
} else {
    Push-Location $GitHubDir
    try {
        git add -A
        
        # Check if there are changes to commit
        $status = git status --porcelain
        if ($status) {
            git commit -m "Release $TagName"
            if ($LASTEXITCODE -ne 0) { throw "Git commit failed" }
            
            git push
            if ($LASTEXITCODE -ne 0) { throw "Git push failed" }
            
            Write-Ok "Committed and pushed to GitHub"
        } else {
            Write-Ok "No changes to commit (already up to date)"
        }
    } finally {
        Pop-Location
    }
}

# ============================================
# STEP 9: Create GitHub Release with archives
# ============================================
Write-Step "9/9" "Creating GitHub Release $TagName"

if ($SkipGitHub) {
    Write-Skip "GitHub release skipped (-SkipGitHub)"
} elseif ($DryRun) {
    Write-Dry "Would create release $TagName on $GitHubRepo with Windows archive (Linux archive added by CI)"
} else {
    # Windows archive is built locally; Linux tar.gz (with +x) is produced by CI on tag push.
    # Both raw binaries (.exe and the Linux ELF) are uploaded separately so the
    # in-app auto-updater can pull them directly — it refuses archives by design.
    $assetPaths = @(
        (Join-Path $Dev1Dir $WinZipPath),
        (Join-Path $Dev1Dir $LinuxTarPath),
        (Join-Path $Dev1Dir $WinExePath),
        (Join-Path $Dev1Dir $LinuxBinPath),
        (Join-Path $Dev1Dir $ChecksumsPath),
        (Join-Path $Dev1Dir $ManifestPath)
    )

    foreach ($asset in $assetPaths) {
        if (-not (Test-Path $asset)) {
            throw "Required release asset missing: $asset"
        }
    }
    
    # Build gh release command
    $ghArgs = @(
        "release", "create", $TagName,
        "--repo", $GitHubRepo,
        "--title", $ReleaseTitle,
        "--latest"
    )
    
    # Add release notes
    if ($ReleaseNotes -and (Test-Path $ReleaseNotes)) {
        $ghArgs += "--notes-file"
        $ghArgs += $ReleaseNotes
    } else {
        # Auto-generate Keep a Changelog format from commit messages
        $lastTag = git -C $GitHubDir tag --sort=-creatordate | Select-Object -First 1
        if ($lastTag -and $lastTag -ne $TagName) {
            $log = git -C $GitHubDir log "$lastTag..HEAD" --format="%s" --no-merges 2>$null

            # Categorize commits by prefix
            $added = @()
            $fixed = @()
            $changed = @()
            $removed = @()
            $deprecated = @()
            $security = @()
            $breaking = @()
            $skipped = @("docs:", "chore:", "style:")

            if ($log) {
                foreach ($line in $log) {
                    $msg = $line.Trim()
                    # Skip docs/chore/style commits
                    $skip = $false
                    foreach ($prefix in $skipped) {
                        if ($msg -match "^${prefix}") { $skip = $true; break }
                    }
                    if ($skip) { continue }

                    # Strip prefix and categorize
                    if ($msg -match "^breaking:\s*(.+)") { $breaking += $Matches[1] }
                    elseif ($msg -match "^feat:\s*(.+)")     { $added += $Matches[1] }
                    elseif ($msg -match "^add:\s*(.+)")      { $added += $Matches[1] }
                    elseif ($msg -match "^fix:\s*(.+)")      { $fixed += $Matches[1] }
                    elseif ($msg -match "^security:\s*(.+)") { $security += $Matches[1] }
                    elseif ($msg -match "^remove:\s*(.+)")   { $removed += $Matches[1] }
                    elseif ($msg -match "^deprecate:\s*(.+)"){ $deprecated += $Matches[1] }
                    elseif ($msg -match "^change:\s*(.+)")   { $changed += $Matches[1] }
                    elseif ($msg -match "^refactor:\s*(.+)") { $changed += $Matches[1] }
                    elseif ($msg -match "^perf:\s*(.+)")     { $changed += $Matches[1] }
                    else { $changed += $msg }
                }
            }

            # Build Keep a Changelog format
            $autoNotes = "## $ReleaseTitle`n"
            if ($breaking.Count -gt 0) {
                $autoNotes += "`n### BREAKING CHANGES`n"
                foreach ($item in $breaking) { $autoNotes += "- $item`n" }
            }
            if ($added.Count -gt 0) {
                $autoNotes += "`n### Added`n"
                foreach ($item in $added) { $autoNotes += "- $item`n" }
            }
            if ($changed.Count -gt 0) {
                $autoNotes += "`n### Changed`n"
                foreach ($item in $changed) { $autoNotes += "- $item`n" }
            }
            if ($fixed.Count -gt 0) {
                $autoNotes += "`n### Fixed`n"
                foreach ($item in $fixed) { $autoNotes += "- $item`n" }
            }
            if ($removed.Count -gt 0) {
                $autoNotes += "`n### Removed`n"
                foreach ($item in $removed) { $autoNotes += "- $item`n" }
            }
            if ($deprecated.Count -gt 0) {
                $autoNotes += "`n### Deprecated`n"
                foreach ($item in $deprecated) { $autoNotes += "- $item`n" }
            }
            if ($security.Count -gt 0) {
                $autoNotes += "`n### Security`n"
                foreach ($item in $security) { $autoNotes += "- $item`n" }
            }
            $autoNotes += "`n---`n"
            $autoNotes += "`n### Downloads`n"
            $autoNotes += "- **ZomboidControlPanel-windows.zip** \u2014 Windows full package (extract and run Start.bat)`n"
            $autoNotes += "- **ZomboidControlPanel-linux.tar.gz** \u2014 Linux full package (extract and run ./start.sh)`n"
            $autoNotes += "- **checksums.txt** \u2014 SHA256 verification hashes`n"
            $ghArgs += "--notes"
            $ghArgs += $autoNotes
        } else {
            $ghArgs += "--generate-notes"
        }
    }

    # Add release assets
    $ghArgs += $assetPaths
    
    & gh @ghArgs
    
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "GitHub release creation failed. You can retry with:"
        Write-Host "  gh release create $TagName --repo $GitHubRepo --title `"$ReleaseTitle`" --prerelease <asset paths>" -ForegroundColor Yellow
    } else {
        Write-Ok "GitHub Release $TagName created with all assets uploaded"
    }
}

# ============================================
# DONE
# ============================================
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " Release $TagName complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host " Checklist:" -ForegroundColor White
Write-Host "   [x] Pre-flight checks passed" -ForegroundColor Green
if (-not $SkipBuild)  { Write-Host "   [x] Client built" -ForegroundColor Green }
if (-not $SkipBuild)  { Write-Host "   [x] Windows + Linux binaries created" -ForegroundColor Green }
if (-not $SkipBuild)  { Write-Host "   [x] Windows + Linux archives packaged" -ForegroundColor Green }
if (-not $SkipDocker) { Write-Host "   [x] Docker image built" -ForegroundColor Green }
if (-not $SkipDeploy) { Write-Host "   [x] PanelBridge mod deployed to PZ server" -ForegroundColor Green }
if (-not $SkipDeploy) { Write-Host "   [x] Release deployed to Admin Panel" -ForegroundColor Green }
if (-not $SkipGitHub) { Write-Host "   [x] Pushed to GitHub" -ForegroundColor Green }
if (-not $SkipGitHub) { Write-Host "   [x] GitHub Release created (Keep a Changelog format)" -ForegroundColor Green }
Write-Host ""
