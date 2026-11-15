#!/usr/bin/env bash
# Start the Mars viewer (http://localhost:8080, or PORT=9000 ./start-viewer.sh).
# Installs the web dependencies on first run. Full setup: ./setup.sh
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$ROOT_DIR/web"
MIN_NODE=18

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js $MIN_NODE or newer (or run ./setup.sh), then run this script again." >&2
  exit 1
fi
if (( $(node -p 'process.versions.node.split(".")[0]') < MIN_NODE )); then
  echo "Node.js $MIN_NODE or newer is required (found $(node --version))." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required (it is included with Node.js)." >&2
  exit 1
fi

if [[ ! -f "$WEB_DIR/node_modules/cesium/Build/Cesium/Cesium.js" ]]; then
  echo "Installing the CesiumJS dependency..."
  if [[ -f "$WEB_DIR/package-lock.json" ]]; then
    (cd "$WEB_DIR" && npm ci --no-audit --no-fund)
  else
    (cd "$WEB_DIR" && npm install --no-audit --no-fund)
  fi
fi

cd "$WEB_DIR"
exec node serve.mjs "$@"
