#!/usr/bin/env bash
# Mars project setup (Linux / macOS).
#   Web viewer (Node.js + CesiumJS) and, with --with-rust, the Rust/Bevy prototype.
# Usage: ./setup.sh [--with-rust]
# Safe to run again: it skips what is already installed.
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$ROOT_DIR/web"
MIN_NODE=18   # serve.mjs uses the built-in fetch() and AbortSignal.timeout()
WITH_RUST=0
for arg in "$@"; do
  case "$arg" in
    --with-rust) WITH_RUST=1 ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[36m== %s\033[0m\n' "$1"; }
ok()   { printf '\n\033[32m== %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------- 1. Node.js
node_major=0
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
fi
if (( node_major < MIN_NODE )); then
  echo "Node.js $MIN_NODE or newer is required (found: ${node_major/#0/none})." >&2
  if [[ "$(uname)" == "Darwin" ]]; then
    echo "  macOS:  brew install node   (or the LTS installer from https://nodejs.org)" >&2
  else
    echo "  Linux:  use your package manager's nodejs ${MIN_NODE}+ package, nvm (https://github.com/nvm-sh/nvm)," >&2
    echo "          or the LTS from https://nodejs.org" >&2
  fi
  echo "Then run ./setup.sh again." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is missing (it normally comes with Node.js). Install it, then run ./setup.sh again." >&2
  exit 1
fi
ok "Node.js $(node --version), npm $(npm --version)"

# ---------------------------------------------------------------- 2. Web dependencies (CesiumJS)
# npm ci installs exactly the versions in package-lock.json (Cesium 1.147).
cd "$WEB_DIR"
if [[ -f package-lock.json ]]; then
  step "Installing web dependencies from package-lock.json (CesiumJS)"
  npm ci --no-audit --no-fund
else
  step "Installing web dependencies (CesiumJS)"
  npm install --no-audit --no-fund
fi
[[ -f node_modules/cesium/Build/Cesium/Cesium.js ]] || { echo "CesiumJS did not install." >&2; exit 1; }
mkdir -p data   # elevation and tile caches (git-ignored), filled on demand by serve.mjs
cd "$ROOT_DIR"

# ---------------------------------------------------------------- 3. Rust + Bevy (optional)
if (( WITH_RUST )); then
  if ! command -v rustup >/dev/null 2>&1; then
    step "Installing Rust (rustup)"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile default
    # shellcheck disable=SC1091
    source "$HOME/.cargo/env"
  fi
  step "Updating Rust to the latest stable"
  rustup update stable
  if [[ "$(uname)" == "Linux" ]]; then
    echo "Bevy on Linux also needs system libraries, e.g. on Debian/Ubuntu:"
    echo "  sudo apt install g++ pkg-config libx11-dev libasound2-dev libudev-dev libxkbcommon-x11-0 libwayland-dev libxkbcommon-dev"
  fi
  step "Downloading and compiling Bevy (one-time, several minutes)"
  cargo fetch
  cargo build
fi

# ---------------------------------------------------------------- summary
ok "All done."
echo "Node:   $(node --version)"
echo "Cesium: $(node -p "require('$WEB_DIR/node_modules/cesium/package.json').version")"
(( WITH_RUST )) && echo "Rust:   $(rustc --version)"
echo
echo "Start the Mars viewer:  ./start-viewer.sh   (then open http://localhost:8080/)"
echo "  Another port:         PORT=9000 ./start-viewer.sh"
echo "  Run only ONE viewer server at a time: they share the elevation cache in web/data."
