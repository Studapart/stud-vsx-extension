#!/usr/bin/env bash
# Deploy the current release/vX.Y.Z: merge into master, tag it, rebase develop
# onto master, then push. The master push starts the release workflow.
#
# Usage: scripts/deploy-release.sh   (run from release/vX.Y.Z)
# Checks the release notes, installs from the lockfile, and runs the tests first.
# A failed check or a rebase conflict stops before anything is pushed.
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

bash scripts/release-notes.sh "$version" > /dev/null || die "release notes check failed; nothing was pushed"
npm ci --no-audit --no-fund || die "npm ci failed; nothing was pushed"
npm test || die "npm test failed; nothing was pushed"

git fetch origin
for base in master develop; do
  git rev-parse -q --verify "refs/heads/$base" >/dev/null || die "no local $base; create it with: git branch $base origin/$base"
  [ "$(git rev-parse "$base")" = "$(git rev-parse "origin/$base")" ] || die "$base differs from origin/$base; reset or pull it first"
done
develop_base="$(git rev-parse origin/develop)"
git merge-base --is-ancestor origin/master "$branch" || die "origin/master has commits $branch lacks; delete $branch, rebase develop onto origin/master, and cut again"

git checkout master
git merge --no-ff "$branch" -m "chore(release): merge version $version"
git tag -a "$tag" -m "Release $tag"

git checkout develop
git rebase master

git push --atomic origin "$tag" master
git push --force-with-lease="develop:$develop_base" origin develop

# Runs after the tag, master and develop are pushed. A failure here leaves the
# release branch behind; it does not undo the deploy.
cleanup_branch() {
  local remote_branch
  remote_branch="$(git ls-remote --heads origin "refs/heads/$branch")" || return 1
  if [ -n "$remote_branch" ]; then
    git push origin --delete "$branch" || return 1
  fi
  git branch -d "$branch"
}

if ! cleanup_branch; then
  echo "warning: deployed $tag, but could not remove $branch; delete it on origin and locally" >&2
fi
echo "deployed $tag; the push to master starts the release workflow"
