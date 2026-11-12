#!/usr/bin/env bash
# Decide whether the release workflow publishes vX.Y.Z built from <sha>.
#
# Usage: scripts/release-check.sh X.Y.Z <sha>
# Prints "publish" or "skip". Any other outcome prints an error and exits 1.
# Needs gh and jq, with GH_TOKEN and GH_REPO (owner/repo) set.
set -euo pipefail

die() {
  echo "error: $*" >&2
  exit 1
}

if [ $# -ne 2 ]; then
  die "usage: $0 X.Y.Z <sha>"
fi
command -v gh >/dev/null 2>&1 || die "gh is required"
command -v jq >/dev/null 2>&1 || die "jq is required"
[ -n "${GH_REPO:-}" ] || die "GH_REPO is required"
version="$1"
sha="$2"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version '$version' is not X.Y.Z"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "'$sha' is not a commit SHA"
tag="v$version"
archive="stud-$version.vsix"
err="$(mktemp)"
trap 'rm -f "$err"' EXIT

if details="$(gh release view "$tag" --json isDraft,assets 2>"$err")"; then
  if [ "$(jq -r .isDraft <<< "$details")" = true ]; then
    die "$tag is a draft; delete it, then re-run"
  fi
  if jq -e --arg asset "$archive" '.assets[].name | select(. == $asset)' <<< "$details" > /dev/null; then
    echo skip
    exit 0
  fi
  die "release $tag exists without $archive"
elif ! grep -qF 'release not found' "$err"; then
  cat "$err" >&2
  die "could not look up release $tag"
fi

if ref="$(gh api "repos/$GH_REPO/git/ref/tags/$tag" --jq '.object.type + " " + .object.sha' 2>"$err")"; then
  read -r type object <<< "$ref"
  if [ "$type" = tag ]; then
    object="$(gh api "repos/$GH_REPO/git/tags/$object" --jq .object.sha)" || die "could not read annotated tag $tag"
  fi
  [ "$object" = "$sha" ] || die "tag $tag points at $object, not $sha"
elif ! grep -q 'HTTP 404' "$err"; then
  cat "$err" >&2
  die "could not look up tag $tag"
fi

echo publish
