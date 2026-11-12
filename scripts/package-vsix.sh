#!/usr/bin/env bash
# Build stud-<version>.vsix from package.json.
#
# Usage: scripts/package-vsix.sh
#
# Requires Node.js 22 or newer for @vscode/vsce. The extension does not ship a
# runtime; this only packages it.
set -euo pipefail

if [ $# -ne 0 ]; then
  echo "usage: $0" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 22 ]; then
  echo "error: @vscode/vsce needs Node.js 22 or newer; found $(node --version)." >&2
  echo "Put a newer node first on PATH, then run this script again." >&2
  exit 1
fi

version="$(node -p 'require("./package.json").version')"

npm test
npm ci --prefix scripts/vsce --ignore-scripts --no-audit --no-fund
scripts/vsce/node_modules/.bin/vsce package --out "stud-$version.vsix"
