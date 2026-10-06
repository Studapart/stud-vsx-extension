# stud

Editor extension for [stud](https://github.com/Studapart/stud-cli). It runs a **user-installed** `stud` executable from Cursor or VS Code. The CLI stays the source of truth.

Extension id: `studapart.stud`.

## What this version does

- Activates from the command palette.
- **stud: Check Version** runs the resolved stud executable with `--version` and writes the result to the **stud** output channel.
- **stud: Validate stud** runs `help --agent` with `{}` on stdin and checks for a JSON success envelope.
- **stud: Open Global Config** opens `~/.config/stud/config.yml` when it exists. If it is missing, the extension tells you to run `stud init` and does not create the file.
- **stud: Open Project Config** opens `.git/stud.config` for the workspace folder. With several folders, it asks which one to use. With none open, it says so. A missing file points at `stud config:project-init`.
- **stud: Reveal Config Locations** lists those paths and whether each file is present. It does not print config contents.
- **stud: Show Config**, **stud: Validate Config**, and **stud: Show Pull Request Comments** run those stud commands with `--agent` and `{}` on stdin.
- **stud: Show Work Item** asks for a key and runs `items:show --agent` with only that key. These commands run in the workspace folder so stud can read `.git/stud.config`. Stud chooses the issue tracker.
- **stud: Sync**, **stud: Commit**, **stud: Push**, and **stud: Submit** ask you to confirm before they run. Sync names the fetch and rebase. Push names force-with-lease, which stud may use when a push is rejected. Each command sends `{}`, so staging, the commit message, labels, and the issue tracker stay with stud. Cancelling the confirmation runs nothing. A second command waits until the first stud process finishes.
- **`stud.executablePath`** is an optional absolute path. When it is empty and **`stud.searchPath`** is on, the extension looks on `PATH` and then in `~/.local/bin/stud`. A found binary is not written back into settings.
- **stud: Install Portable stud** asks you to confirm, then downloads the portable release for Linux x64 or macOS Apple Silicon when no stud executable is found. It checks SHA-256 and links `~/.local/bin/stud`. Cancelling downloads nothing.
- **stud: Update Portable stud** runs `stud update --quiet` only when that link already points at the portable install. The Extensions view Update button does not run it.

## Limitations

This extension is a thin wrapper. It is not a CLI replacement.

- It does not bundle a stud runtime. **stud: Install Portable stud** is the only download. It runs only after you confirm, only on Linux x64 (including WSL and SSH) or macOS Apple Silicon, and only when `stud.executablePath` is empty and search finds no executable. Other hosts, a set path, and an unmanaged `~/.local/bin/stud` are refused. macOS builds are unsigned. The manual fallback is still to install stud yourself.
- It does not call Jira, Linear, or GitLab. The install downloads the stud-cli GitHub release and its checksum. It does not run `git` or `gh`. Other commands go through `stud --agent`.
- **stud: Sync**, **stud: Commit**, **stud: Push**, and **stud: Submit** do not run until you confirm. Commands that are not on the palette are refused.
- It does not create or edit stud config files. Tokens in those files are not copied into the output channel.
- It does not ship a GUI panel.
- Open VSX listing and the Microsoft Marketplace are not part of this version. The same VSIX is meant to run in Cursor and VS Code via the extension development host or a sideload.

## Develop

Requires Node.js 18+. Contributor standards are in [`CONVENTIONS.md`](CONVENTIONS.md).

```bash
npm install
npm test
```

In Cursor or VS Code, open this folder and run **Run Extension**. That starts an Extension Development Host with this extension loaded. Open the command palette and run **stud: Validate stud**, **stud: Check Version**, **stud: Open Global Config**, **stud: Open Project Config**, **stud: Reveal Config Locations**, **stud: Show Config**, **stud: Validate Config**, **stud: Show Work Item**, **stud: Show Pull Request Comments**, **stud: Sync**, **stud: Commit**, **stud: Push**, **stud: Submit**, **stud: Install Portable stud**, or **stud: Update Portable stud**. Cancel the confirmation on a mutation or install and confirm stud was not started and nothing was downloaded.

To build an installable VSIX, run the packaging script with the target file name. The version in the name is written to `package.json` before packaging. It needs Node.js 22 or newer because `@vscode/vsce` requires it.

```bash
npm run package -- --output-file stud-0.0.2.vsix
cursor --install-extension stud-0.0.2.vsix --force
```

Leave `stud.executablePath` empty to use discovery. Set it when the binary is somewhere else. Turn off `stud.searchPath` to require the explicit path.
