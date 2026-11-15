# Mars project setup (Windows).
#   Web viewer (Node.js + CesiumJS) and, unless -WebOnly is given, the Rust/Bevy prototype.
# Run from PowerShell:  powershell -ExecutionPolicy Bypass -File .\setup.ps1 [-WebOnly]
# Or double-click setup.bat. Safe to run again: it skips what is already installed.
param(
    [switch]$WebOnly   # only the web viewer: skip MSVC build tools, Rust and the Bevy build
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$MinNode = 18   # serve.mjs uses the built-in fetch() and AbortSignal.timeout()

function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

function Step($title, [scriptblock]$body) {
    Write-Host "`n== $title" -ForegroundColor Cyan
    $global:LASTEXITCODE = 0
    & $body
    if ($LASTEXITCODE -ne 0) { throw "Step failed: $title (exit code $LASTEXITCODE)" }
}

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User') + ";$env:USERPROFILE\.cargo\bin"
}

# ---------------------------------------------------------------- 1. Node.js (web viewer)
Refresh-Path
$nodeMajor = 0
if (Have 'node') { $nodeMajor = [int]((node --version) -replace '^v(\d+).*', '$1') }
if ($nodeMajor -lt $MinNode) {
    if (-not (Have 'winget')) {
        throw "Node.js $MinNode or newer is required (found: $(if ($nodeMajor) { "v$nodeMajor" } else { 'none' })). Install the LTS from https://nodejs.org and run this script again."
    }
    Step "Installing Node.js LTS (needs $MinNode+, found $(if ($nodeMajor) { "v$nodeMajor" } else { 'none' }))" {
        if ($nodeMajor) { winget upgrade --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements }
        else { winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements }
    }
    Refresh-Path
    if (-not (Have 'node')) {
        throw "Node.js was just installed. Open a NEW PowerShell window and run this script again."
    }
}
Write-Host "`n== Node.js $(node --version), npm $(npm --version)" -ForegroundColor Green

# ---------------------------------------------------------------- 2. Web dependencies (CesiumJS)
# npm ci installs exactly the versions in package-lock.json (Cesium 1.147), so everyone on
# the team gets the same build; npm install is the fallback if the lock file is missing.
Push-Location web
try {
    if (Test-Path package-lock.json) {
        Step "Installing web dependencies from package-lock.json (CesiumJS)" { npm ci --no-audit --no-fund }
    } else {
        Step "Installing web dependencies (CesiumJS)" { npm install --no-audit --no-fund }
    }
    if (-not (Test-Path 'node_modules/cesium/Build/Cesium/Cesium.js')) { throw "CesiumJS did not install (Build/Cesium/Cesium.js missing)." }
    # Downloaded elevation and tile caches live here (git-ignored); serve.mjs fills them on demand.
    New-Item -ItemType Directory -Force data | Out-Null
} finally {
    Pop-Location
}

# ---------------------------------------------------------------- 3. Rust + Bevy (optional prototype)
if (-not $WebOnly) {
    # MSVC C++ build tools + Windows SDK (Rust's default Windows toolchain needs them)
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    $hasVC = $false
    if (Test-Path $vswhere) {
        $found = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        $hasVC = [bool]$found
    }
    $hasSDK = Test-Path "${env:ProgramFiles(x86)}\Windows Kits\10\Lib"
    if ($hasVC -and $hasSDK) {
        Write-Host "`n== MSVC build tools and Windows SDK already installed" -ForegroundColor Green
    } else {
        Step "Installing Visual Studio Build Tools (C++ workload). Accept the admin prompt." {
            winget install --id Microsoft.VisualStudio.2022.BuildTools -e `
                --accept-package-agreements --accept-source-agreements `
                --override "--passive --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
        }
    }

    # Rust via rustup (Cargo.toml uses edition 2024: Rust 1.85 or newer)
    if (-not (Have 'rustup')) {
        Step "Downloading and running rustup" {
            $exe = Join-Path $env:TEMP 'rustup-init.exe'
            Invoke-WebRequest -Uri 'https://win.rustup.rs/x86_64' -OutFile $exe
            & $exe -y --default-toolchain stable --profile default
        }
        Refresh-Path
    }
    Step "Updating Rust to the latest stable" { rustup update stable }

    # Bevy: download and compile all dependencies once (first build takes several minutes)
    Step "Downloading Bevy and its dependencies" { cargo fetch }
    Step "Compiling Bevy (one-time, cached afterwards)" { cargo build }
}

# ---------------------------------------------------------------- summary
Write-Host "`nAll done." -ForegroundColor Green
Write-Host "Node:   $(node --version)"
Write-Host "Cesium: $(node -p "require('./web/node_modules/cesium/package.json').version")"
if (-not $WebOnly) { Write-Host "Rust:   $(rustc --version)" }
Write-Host ""
Write-Host "Start the Mars viewer:  start-viewer.bat   (then open http://localhost:8080/)"
Write-Host "  Another port:         set PORT=9000 && start-viewer.bat"
Write-Host "  Run only ONE viewer server at a time: they share the elevation cache in web\data."
if (-not $WebOnly) { Write-Host "Bevy prototype:         cargo run   (opens an empty Bevy window)" }
