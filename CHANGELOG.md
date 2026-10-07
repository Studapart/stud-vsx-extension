# Changelog

## [Unreleased]

- Add a stud activity-bar panel with Work items, Git and review, and Config. Mutations ask for confirmation before stud starts. Install and update stay on the command palette. The global config wizard, work item transitions, attachment upload, Confluence publish, deploy, release, docs commands, and clear cache are not offered.
- Ask for each visible stud help input before Validate Config, Sync, Commit, Push, Submit, and Show Work Item. `compact`, `quiet`, and `help` stay hidden. An empty Show Work Item key does not start stud.
- Add **stud: Install Portable stud** and **stud: Update Portable stud**. Install downloads the portable release only after confirmation when no stud executable is found. Update runs `stud update --quiet` for a managed portable link and does not use `--agent`.
- Add palette workflows for stud sync, commit, push, and submit. Commit, push, and submit ask for confirmation after the help prompt. Visible inputs are the confirmed JSON; `compact`, `quiet`, and `help` stay omitted.
- Run allowlisted stud agent commands in the workspace folder so stud can read `.git/stud.config`.
- Run an allowlist of read-only stud agent commands (`config:show`, `pr:comments`) and show success, CLI errors, and malformed output. Validate Config and Show Work Item use the help prompt. Anything else is refused.
- Open or reveal the global stud config (`~/.config/stud/config.yml`) and the project stud config (`.git/stud.config`) without creating files or printing their contents.
- Use the stud mark as the extension icon, on a white background. The transparent variant is kept in `resources/icon-a.png`.
- Add `npm run package -- --output-file stud-x.y.z.vsix` to build the VSIX; it sets the manifest version from the file name and needs Node.js 22+.
- Discover a user-installed stud on `PATH` and in `~/.local/bin/stud` when `stud.executablePath` is empty, and validate it with `stud help --agent`.
- Bootstrap a VS Code and Cursor extension that activates a stud version check and a `stud.executablePath` setting.
