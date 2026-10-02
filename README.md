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

## Limitations

This extension is a thin wrapper. It is not a CLI replacement.

- It does not bundle, download, or install a stud runtime. Install stud yourself so it is on `PATH` or at `~/.local/bin/stud`, or set `stud.executablePath`. A later managed portable install is described in [`documentation/sci-113-managed-runtime.md`](documentation/sci-113-managed-runtime.md) and is not part of this version.
- It does not call Jira, Linear, GitHub, or GitLab, and it does not run `git` or `gh` itself. Reads and the palette workflows go through `stud --agent`. A local stud install is required.
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

In Cursor or VS Code, open this folder and run **Run Extension**. That starts an Extension Development Host with this extension loaded. Open the command palette and run **stud: Validate stud**, **stud: Check Version**, **stud: Open Global Config**, **stud: Open Project Config**, **stud: Reveal Config Locations**, **stud: Show Config**, **stud: Validate Config**, **stud: Show Work Item**, **stud: Show Pull Request Comments**, **stud: Sync**, **stud: Commit**, **stud: Push**, or **stud: Submit**. Cancel the confirmation on a mutation and confirm stud was not started.

To build an installable VSIX, run the packaging script with the target file name. The version in the name is written to `package.json` before packaging. It needs Node.js 22 or newer because `@vscode/vsce` requires it.

```bash
npm run package -- --output-file stud-0.0.2.vsix
cursor --install-extension stud-0.0.2.vsix --force
```

Leave `stud.executablePath` empty to use discovery. Set it when the binary is somewhere else. Turn off `stud.searchPath` to require the explicit path.
