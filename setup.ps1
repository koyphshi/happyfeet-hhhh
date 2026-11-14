# Mars project: install Rust, Bevy dependencies and CesiumJS.
# Run from PowerShell:  powershell -ExecutionPolicy Bypass -File .\setup.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

function Step($title, [scriptblock]$body) {
    Write-Host "`n== $title" -ForegroundColor Cyan
    $global:LASTEXITCODE = 0
    & $body
    if ($LASTEXITCODE -ne 0) { throw "Step failed: $title (exit code $LASTEXITCODE)" }
}

# 1. MSVC C++ build tools + Windows SDK (Rust's default Windows toolchain needs them)
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

# 2. Rust via rustup
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
if (-not (Have 'rustup')) {
    Step "Downloading and running rustup" {
        $exe = Join-Path $env:TEMP 'rustup-init.exe'
        Invoke-WebRequest -Uri 'https://win.rustup.rs/x86_64' -OutFile $exe
        & $exe -y --default-toolchain stable --profile default
    }
}
Step "Updating Rust to the latest stable" { rustup update stable }
rustc --version
cargo --version

# 3. Bevy: download and compile all dependencies once (first build takes several minutes)
Step "Downloading Bevy and its dependencies" { cargo fetch }
Step "Compiling Bevy (one-time, cached afterwards)" { cargo build }

# 4. CesiumJS
if (-not (Have 'npm')) {
    Step "Installing Node.js LTS" {
        winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
    }
    throw "Node.js was just installed. Open a NEW PowerShell window and run this script again."
}
Push-Location web
try {
    Step "Installing CesiumJS (npm)" { npm install cesium }
} finally {
    Pop-Location
}

Write-Host "`nAll done." -ForegroundColor Green
Write-Host "Rust:   $(rustc --version)"
Write-Host "Cesium: $(node -p "require('./web/node_modules/cesium/package.json').version")"
Write-Host "Try it: cargo run   (opens an empty Bevy window)"
