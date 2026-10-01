# Changelog

## [Unreleased]

- Open or reveal the global stud config (`~/.config/stud/config.yml`) and the project stud config (`.git/stud.config`) without creating files or printing their contents.
- Use the stud mark as the extension icon, on a white background. The transparent variant is kept in `resources/icon-a.png`.
- Add `npm run package -- --output-file stud-x.y.z.vsix` to build the VSIX; it sets the manifest version from the file name and needs Node.js 22+.
- Discover a user-installed stud on `PATH` and in `~/.local/bin/stud` when `stud.executablePath` is empty, and validate it with `stud help --agent`.
- Bootstrap a VS Code and Cursor extension that activates a stud version check and a `stud.executablePath` setting.
