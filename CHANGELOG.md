# Changelog

## [Unreleased]

- Build the release archive with a token that can only read repository contents. The job that creates the GitHub release runs no npm code and holds the only write token, so a compromised build dependency cannot change a release.
- Publish a release only when its tag names the built commit. A draft release or a release that exists without its archive stops the release workflow with a message; delete the draft and re-run it.
- Check the release notes and run the tests before `npm run deploy` pushes anything. A failed check stops the deploy with nothing pushed.
- Warn instead of failing the deploy when the release branch cannot be deleted after the tag, `master` and `develop` are pushed.
- Run the tests on Node.js 18, `actionlint` and `shellcheck`, and a package build on every pull request into `develop`. Pull requests never publish.
- Package the extension with a locked `@vscode/vsce` 4.1.0 instead of fetching it at release time.

## [0.0.1] - 2026-11-09

- Add a release pipeline: `npm run release` cuts `release/vX.Y.Z` from `develop`, `npm run deploy` merges it into `master` and tags it, and a push to `master` publishes `stud-X.Y.Z.vsix` as a GitHub release. The version is reset to 0.0.1.
- Validate Config shows per-provider results (Jira, Linear, GitHub, GitLab) instead of a generic failure when stud returns connectivity data, and sends `compact: false` on `config:validate --agent`.
- Group Stud panel actions by section. Work-item and Confluence actions live under Work items. Git actions, including status, live under Git and review. Config holds stud config and file shortcuts only. Panel tree clicks use one internal command so labels stay plain.
- Use `resources/icon-activitybar.svg`, a 24×24 single-color stud mark, for the activity bar. The marketplace icon stays `resources/icon.png` on a white background.
- Show the stud mark on the activity bar. The button is named Stud and opens Work items, Git and review, and Config. The container id is `stud-panel`, because a dot in that id is rejected and the views are then placed in Explorer.
- Add a stud activity-bar panel with Work items, Git and review, and Config. Mutations ask for confirmation before stud starts. Install and update stay on the command palette. The global config wizard, work item transitions, attachment upload, Confluence publish, deploy, release, docs commands, and clear cache are not offered.
- Ask for each visible stud help input before Validate Config, Sync, Commit, Push, Submit, and Show Work Item. `compact`, `quiet`, and `help` stay hidden. An empty Show Work Item key does not start stud.
- Add **stud: Install Portable stud** and **stud: Update Portable stud**. Install downloads the portable release only after confirmation when no stud executable is found. Update runs `stud update --quiet` for a managed portable link and does not use `--agent`.
- Add palette workflows for stud sync, commit, push, and submit. Commit, push, and submit ask for confirmation after the help prompt. Visible inputs are the confirmed JSON; `compact`, `quiet`, and `help` stay omitted.
- Run allowlisted stud agent commands in the workspace folder so stud can read `.git/stud.config`.
- Run an allowlist of read-only stud agent commands (`config:show`, `pr:comments`) and show success, CLI errors, and malformed output. Validate Config and Show Work Item use the help prompt. Anything else is refused.
- Open or reveal the global stud config (`~/.config/stud/config.yml`) and the project stud config (`.git/stud.config`) without creating files or printing their contents.
- Use the stud mark as the extension icon, on a white background. The transparent variant is kept in `resources/icon-a.png`.
- Add `npm run package` to build `stud-<version>.vsix` from `package.json`; it needs Node.js 22+.
- Discover a user-installed stud on `PATH` and in `~/.local/bin/stud` when `stud.executablePath` is empty, and validate it with `stud help --agent`.
- Bootstrap a VS Code and Cursor extension that activates a stud version check and a `stud.executablePath` setting.
