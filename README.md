# stud

Editor extension for [stud](https://github.com/Studapart/stud-cli). It runs a **user-installed** `stud` executable from Cursor or VS Code. The CLI stays the source of truth.

Extension id: `studapart.stud`.

## What this version does

- Activates from the command palette and from the **Stud** activity bar. The button uses `resources/icon-activitybar.svg`, a 24×24 single-color stud mark. The Extensions view still uses the full-color icon on white.
- That panel contains **Work items**, **Git and review**, and **Config**. Work items groups list, create, projects, filters, and Confluence actions, then **Active work items** from stud. Git and review holds git, status, and pull-request actions. Config holds stud config, one project field, and config file shortcuts. A row can show, start, take over, update, download, switch, or rename. Search runs JQL. A named filter fills the same list. Git actions include flatten, sync, commit, undo, push, submit, a safe force-push, and branch cleanup. Config can show or validate stud config, set one project field, and open the global file for a Jira API token or Linear API key. Mutations ask you to confirm. Cancelling runs nothing. A second stud action waits until the first finishes.
- **stud: Check Version** runs the resolved stud executable with `--version` and writes the result to the **stud** output channel.
- **stud: Validate stud** runs `help --agent` with `{}` on stdin and checks for a JSON success envelope.
- **stud: Open Global Config** opens `~/.config/stud/config.yml` when it exists. If it is missing, the extension tells you to run `stud init` and does not create the file.
- **stud: Open Project Config** opens `.git/stud.config` for the workspace folder. With several folders, it asks which one to use. With none open, it says so. A missing file points at `stud config:project-init`.
- **stud: Reveal Config Locations** lists those paths and whether each file is present. It does not print config contents.
- **stud: Show Config** and **stud: Show Pull Request Comments** run those stud commands with `--agent` and `{}` on stdin.
- **stud: Validate Config**, **stud: Sync**, **stud: Commit**, **stud: Push**, **stud: Submit**, and **stud: Show Work Item** ask for each visible input from that command's `stud help --agent`, prefilled with the reported default. `compact`, `quiet`, and `help` are not asked. Sync asks nothing when those are its only inputs. Show Work Item asks for the key and the provider. An empty key does not start stud. Sync, Commit, Push, and Submit still ask you to confirm after the prompt. Sync names the fetch and rebase. Push names force-with-lease, which stud may use when a push is rejected. Cancelling a prompt step or the confirmation runs no workflow. Stud receives the JSON you confirmed. The extension does not read config files to fill those defaults. Palette stud commands run in the workspace folder so stud can read `.git/stud.config`.
- **`stud.executablePath`** is an optional absolute path. When it is empty and **`stud.searchPath`** is on, the extension looks on `PATH` and then in `~/.local/bin/stud`. A found binary is not written back into settings.
- **stud: Install Portable stud** asks you to confirm, then downloads the portable release for Linux x64 or macOS Apple Silicon when no stud executable is found. It checks SHA-256 and links `~/.local/bin/stud`. Cancelling downloads nothing.
- **stud: Update Portable stud** runs `stud update --quiet` only when that link already points at the portable install. The Extensions view Update button does not run it.

## Limitations

This extension is a thin wrapper. It is not a CLI replacement.

- It does not bundle a stud runtime. **stud: Install Portable stud** is the only download. It runs only after you confirm, only on Linux x64 (including WSL and SSH) or macOS Apple Silicon, and only when `stud.executablePath` is empty and search finds no executable. Other hosts, a set path, and an unmanaged `~/.local/bin/stud` are refused. macOS builds are unsigned. The manual fallback is still to install stud yourself.
- It does not call Jira, Linear, or GitLab. The install downloads the stud-cli GitHub release and its checksum. It does not run `git` or `gh`. Other commands go through `stud --agent`.
- **stud: Sync**, **stud: Commit**, **stud: Push**, and **stud: Submit** do not run until you confirm. Cancelling an input prompt runs nothing either. The side panel asks the same way before flatten, undo, safe force-push, cleaning merged branches, start, take over, update, rename, switch, create, pull-request comment, and saving one project field. Commands that are not on the panel or the palette are refused. The panel does not offer install, update, the global config wizard, work item transitions, attachment upload, Confluence publish, deploy, release, docs check, docs generate, or clear cache.
- It does not create or edit stud config files. A project setting is one field on stdin to `stud config:project-init`. A Jira API token or Linear API key opens the global config file and does not run the wizard. Tokens are not copied into the output channel.
- Open VSX listing and the Microsoft Marketplace are not part of this version. The same VSIX is meant to run in Cursor and VS Code via the extension development host or a sideload.

## Develop

Requires Node.js 18+. Contributor standards are in [`CONVENTIONS.md`](CONVENTIONS.md).

```bash
npm install
npm test
```

Pull requests into `develop` run the tests on Node.js 18, `actionlint` and `shellcheck`, and a package build. They never publish. The release script tests also need `git`, `jq` and `bash`.

In Cursor or VS Code, open this folder and run **Run Extension**. That starts an Extension Development Host with this extension loaded. Open the **stud** activity bar and confirm Work items, Git and review, and Config are there. Cancel a confirmation on Flatten or Commit and confirm stud does not start. Open the command palette and run **stud: Validate stud**, **stud: Check Version**, **stud: Open Global Config**, **stud: Open Project Config**, **stud: Reveal Config Locations**, **stud: Show Config**, **stud: Validate Config**, **stud: Show Work Item**, **stud: Show Pull Request Comments**, **stud: Sync**, **stud: Commit**, **stud: Push**, **stud: Submit**, **stud: Install Portable stud**, or **stud: Update Portable stud**. Cancel a prompt step or the confirmation on a mutation or install and confirm the workflow was not started and nothing was downloaded. Install and update stay on the command palette.

To build an installable VSIX, run `npm run package`. It writes `stud-<version>.vsix` from the version in `package.json` and runs the tests first. It needs Node.js 22 or newer because `@vscode/vsce` requires it. The packaging tool is locked in `scripts/vsce/`. To upgrade it, edit `scripts/vsce/package.json`, run `npm install --prefix scripts/vsce --ignore-scripts` on Node.js 22 or newer, and open a pull request.

```bash
npm run package
cursor --install-extension stud-0.0.1.vsix --force
```

Leave `stud.executablePath` empty to use discovery. Set it when the binary is somewhere else. Turn off `stud.searchPath` to require the explicit path.

## Install from a release

Each release is on the GitHub releases page with its `stud-<version>.vsix` attached. Download that file, then install it:

- Cursor: `cursor --install-extension stud-<version>.vsix --force`, or **Extensions** → **…** → **Install from VSIX**.
- VS Code: `code --install-extension stud-<version>.vsix --force`, or **Extensions** → **…** → **Install from VSIX**.

To confirm the installed version, run `cursor --list-extensions --show-versions` (or `code ...`) and look for `studapart.stud@<version>`.

## Release

Releases follow git flow. `develop` is where work lands, `master` is the release branch, and each release is `release/vX.Y.Z` cut from `develop`. Versions are semantic (`X.Y.Z`) and live only in `package.json`.

1. Merge the changes into `develop` and add their notes under `## [Unreleased]` in `CHANGELOG.md`.
2. Run `npm run release` on a clean `develop` that matches `origin/develop`. The default bumps the patch version. Use `npm run release -- minor`, `npm run release -- major`, or `npm run release -- X.Y.Z` for another version. This creates `release/vX.Y.Z` with the version bump and moved notes, and does not push.
3. Check the branch, then run `npm run deploy` from `release/vX.Y.Z`. Before it fetches or pushes, it checks the release notes, installs dependencies from the lockfile, and runs `npm test`. It requires local `master` and `develop` to match `origin`, and it refuses when `origin/master` has commits the release branch lacks. It merges the branch into `master`, tags `vX.Y.Z`, rebases `develop` onto `master`, then pushes the tag and `master` together (atomically) and `develop` with lease. A rebase conflict stops it before anything is pushed.
4. The push to `master` starts `.github/workflows/release.yml`. The build job reads with a token that can only read repository contents, and it builds `stud-X.Y.Z.vsix` with the changelog notes. The publish job runs no npm code. It holds the only write token, checks the release again, and creates the GitHub release `vX.Y.Z` with that file and the notes. A run for a version whose release already has the archive does nothing. A run fails and needs a look when the release is a draft, when it exists without the archive, or when the tag `vX.Y.Z` names another commit.

Rebasing `develop` rewrites its commits. Update any open pull requests that were based on it. Do not force-push `master`. To roll back a release, revert the change on `develop` and release the next patch version. Do not reuse the version: its tag already names the released commit, so a later push with the same version does nothing or fails.

### If deploy stops

- **Rebase conflict:** nothing was pushed. Resolve the conflict and run `git rebase --continue`; the tag already exists. Then finish the deploy: `git push --atomic origin vX.Y.Z master`, then push `develop` with the SHA deploy fetched. Do that before any later fetch: `git push --force-with-lease="develop:$(git rev-parse origin/develop)" origin develop`. If a later fetch moved `origin/develop`, use `git rev-parse 'origin/develop@{1}'`. If it did not move, `origin/develop` is still the right SHA. Then `git push origin --delete release/vX.Y.Z` if the release branch is on origin, and `git branch -d release/vX.Y.Z`.
- **Refused before pushing** (release notes, the lockfile install, `npm test`, or `origin/master` has commits the release branch lacks): nothing was pushed. For the notes, the lockfile, or the tests, fix the problem on `release/vX.Y.Z` and run `npm run deploy` again. For the `origin/master` refusal, run `git checkout develop && git branch -D release/vX.Y.Z`, then `git rebase origin/master` on `develop`, push it with `git push --force-with-lease origin develop`, and run `npm run release` again.
- **Rejected tag and `master` push:** nothing was published, because the push is atomic. Undo the local merge, tag, and rebase, fix the cause, and run `npm run deploy` again: `git fetch origin`, `git checkout master && git reset --hard origin/master`, `git tag -d vX.Y.Z`, `git checkout develop && git reset --hard origin/develop`, then `git checkout release/vX.Y.Z`.
- **Rejected `develop` push:** `master` and the tag are published. Do not re-run deploy. Pick up any commits someone pushed to `develop` during the deploy, then replay `develop` on `master`: `git checkout develop && git fetch origin && git reset --hard origin/develop && git rebase origin/master`, then `git push --force-with-lease origin develop` and `git branch -d release/vX.Y.Z`. Resetting first keeps those commits; rebasing the local copy alone would drop them.
- **Failed release build or publish:** the tag and `master` are published. For a transient failure, re-run failed jobs from the Actions tab. If the `release` artifact has expired, re-run all jobs. If `publish` reports a draft, delete that draft, then re-run failed jobs. If the release run was cancelled, or a later run reports that the tag points at another commit, re-run that commit's run from the Actions tab. For a build that fails every time, do not re-tag the same version; cut the next patch version instead.
