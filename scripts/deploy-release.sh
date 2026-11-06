#!/usr/bin/env bash
# Deploy the current release/vX.Y.Z: merge into master, tag it, rebase develop
# onto master, then push. The master push starts the release workflow.
#
# Usage: scripts/deploy-release.sh   (run from release/vX.Y.Z)
# A merge or rebase conflict stops before anything is pushed.
set -euo pipefail

cd "$(dirname "$0")/.."

die() {
  echo "error: $*" >&2
  exit 1
}

if [ $# -ne 0 ]; then
  die "usage: $0"
fi

branch="$(git branch --show-current)"
[[ "$branch" =~ ^release/v([0-9]+\.[0-9]+\.[0-9]+)$ ]] || die "run from release/vX.Y.Z; on '$branch'"
version="${BASH_REMATCH[1]}"
tag="v$version"

[ "$(node -p 'require("./package.json").version')" = "$version" ] || die "package.json version is not $version"
[ -z "$(git status --porcelain)" ] || die "working tree is not clean"

git fetch origin

git checkout master
git pull --ff-only origin master
git merge --no-ff "$branch" -m "chore(release): merge version $version"
git tag -a "$tag" -m "Release $tag"

git checkout develop
git pull --ff-only origin develop
git rebase master

git push origin "$tag"
git push origin master
git push --force-with-lease origin develop

remote_branch="$(git ls-remote --heads origin "$branch")"
if [ -n "$remote_branch" ]; then
  git push origin --delete "$branch"
fi
git branch -d "$branch"
echo "deployed $tag; the push to master starts the release workflow"
