#!/usr/bin/env bash
# Cut release/vX.Y.Z from origin/develop and bump the version on that branch.
#
# Usage: scripts/cut-release.sh [major|minor|patch|X.Y.Z]   (default: patch)
# Run from a clean develop that matches origin/develop. Does not push;
# scripts/deploy-release.sh pushes the tag and master; the release workflow publishes.
set -euo pipefail

cd "$(dirname "$0")/.."

die() {
  echo "error: $*" >&2
  exit 1
}

if [ $# -gt 1 ]; then
  die "usage: $0 [major|minor|patch|X.Y.Z]"
fi
bump="${1:-patch}"

[ "$(git branch --show-current)" = develop ] || die "run from develop"
[ -z "$(git status --porcelain)" ] || die "working tree is not clean"

git fetch origin --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/develop)" ] || die "develop differs from origin/develop; pull first"

current="$(node -p 'require("./package.json").version')"
[[ "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || die "package.json version '$current' is not X.Y.Z"
major="${BASH_REMATCH[1]}"
minor="${BASH_REMATCH[2]}"
patch="${BASH_REMATCH[3]}"

case "$bump" in
  major) next="$((major + 1)).0.0" ;;
  minor) next="$major.$((minor + 1)).0" ;;
  patch) next="$major.$minor.$((patch + 1))" ;;
  *)
    [[ "$bump" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "argument must be major, minor, patch, or X.Y.Z; got '$bump'"
    next="$bump"
    ;;
esac

tag="v$next"
remote_tags="$(git ls-remote --tags origin "refs/tags/$tag")"
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null || [ -n "$remote_tags" ]; then
  die "tag $tag already exists"
fi

notes="$(bash scripts/changelog-section.sh CHANGELOG.md Unreleased | tr -d '[:space:]')"
[ -n "$notes" ] || die "CHANGELOG.md has no notes under Unreleased"

git checkout --no-track -b "release/$tag" origin/develop
npm version "$next" --no-git-tag-version --allow-same-version >/dev/null

release_date="${RELEASE_DATE:-$(date -u +%F)}"
awk -v heading="## [$next] - $release_date" '
  { print }
  !done && index($0, "## [Unreleased]") == 1 { print ""; print heading; done = 1 }
' CHANGELOG.md > CHANGELOG.md.new
mv CHANGELOG.md.new CHANGELOG.md

git add -A
git commit -m "chore(release): bump version to $next"
echo "cut release/$tag; run npm run deploy when it is ready"
