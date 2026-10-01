#!/usr/bin/env bash
# Build the extension VSIX.
#
# Usage: scripts/package-vsix.sh --output-file stud-x.y.z.vsix
#
# The version in the file name is written to package.json and package-lock.json
# so the packaged manifest matches the file. Requires Node.js 22 or newer for
# @vscode/vsce. The extension does not ship a runtime; this only packages it.

set -euo pipefail

usage() {
  echo "usage: $0 --output-file stud-x.y.z.vsix" >&2
  exit 2
}

output_file=""
while [ $# -gt 0 ]; do
  case "$1" in
    --output-file)
      [ $# -ge 2 ] || usage
      output_file="$2"
      shift 2
      ;;
    --output-file=*)
      output_file="${1#--output-file=}"
      shift
      ;;
    *)
      usage
      ;;
  esac
done

[ -n "$output_file" ] || usage

file_name="$(basename "$output_file")"
if [[ ! "$file_name" =~ ^stud-([0-9]+\.[0-9]+\.[0-9]+)\.vsix$ ]]; then
  echo "error: output file must be named stud-x.y.z.vsix, got '$file_name'" >&2
  exit 2
fi
version="${BASH_REMATCH[1]}"

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 22 ]; then
  echo "error: @vscode/vsce needs Node.js 22 or newer; found $(node --version)." >&2
  echo "Put a newer node first on PATH, then run this script again." >&2
  exit 1
fi

cd "$(dirname "$0")/.."

npm version "$version" --no-git-tag-version --allow-same-version >/dev/null
npm test
npx --yes @vscode/vsce@4 package --out "$output_file"
