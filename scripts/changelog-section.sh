#!/usr/bin/env bash
# Print the body of one CHANGELOG.md version section.
#
# Usage: scripts/changelog-section.sh <changelog> <heading>
#   <heading> is Unreleased or X.Y.Z
# Exits 1, with a message on stderr, when the heading does not exist.
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: $0 <changelog> <heading>" >&2
  exit 2
fi

awk -v heading="$2" -v changelog="$1" '
  !found && index($0, "## [" heading "]") == 1 { found = 1; inside = 1; next }
  inside && /^## / { exit }
  inside { print }
  END {
    if (!found) {
      print "error: " changelog " has no \"## [" heading "]\" section" > "/dev/stderr"
    }
    exit found ? 0 : 1
  }
' "$1"
