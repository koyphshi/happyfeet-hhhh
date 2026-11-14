#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$ROOT_DIR/web"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js 18 or newer, then run this script again." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required (it is included with Node.js)." >&2
  exit 1
fi

if [[ ! -f "$WEB_DIR/node_modules/cesium/Build/Cesium/Cesium.js" ]]; then
  echo "Installing the CesiumJS dependency..."
  (cd "$WEB_DIR" && npm install)
fi

cd "$WEB_DIR"
exec node serve.mjs
