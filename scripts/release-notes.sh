#!/usr/bin/env bash
# Print the release notes for X.Y.Z from CHANGELOG.md. Refuses when that
# section has no notes, or when Unreleased still has notes after the cut.
#
# Usage: scripts/release-notes.sh X.Y.Z
set -euo pipefail

cd "$(dirname "$0")/.."

die() {
  echo "error: $*" >&2
  exit 1
}

if [ $# -ne 1 ]; then
  die "usage: $0 X.Y.Z"
fi
version="$1"

notes="$(bash scripts/changelog-section.sh CHANGELOG.md "$version")"
[ -n "$(tr -d '[:space:]' <<< "$notes")" ] || die "CHANGELOG.md has no notes under $version"
[ -z "$(bash scripts/changelog-section.sh CHANGELOG.md Unreleased 2>/dev/null | tr -d '[:space:]')" ] || die "CHANGELOG.md has notes under Unreleased after the cut"

printf '%s\n' "$notes"
