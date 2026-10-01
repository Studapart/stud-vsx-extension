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
- **`stud.executablePath`** is an optional absolute path. When it is empty and **`stud.searchPath`** is on, the extension looks on `PATH` and then in `~/.local/bin/stud`. A found binary is not written back into settings.

## Limitations

This extension is a thin wrapper. It is not a CLI replacement.

- It does not bundle, download, or install a stud runtime. Install stud yourself so it is on `PATH` or at `~/.local/bin/stud`, or set `stud.executablePath`.
- It does not call Jira, Linear, GitHub, or GitLab. It does not reimplement Git or work-item workflows.
- It does not create or edit stud config files. Tokens in those files are not copied into the output channel.
- It does not ship a GUI panel.
- Open VSX listing and the Microsoft Marketplace are not part of this version. The same VSIX is meant to run in Cursor and VS Code via the extension development host or a sideload.

## Develop

Requires Node.js 18+. Contributor standards are in [`CONVENTIONS.md`](CONVENTIONS.md).

```bash
npm install
npm test
```

In Cursor or VS Code, open this folder and run **Run Extension**. That starts an Extension Development Host with this extension loaded. Open the command palette and run **stud: Validate stud**, **stud: Check Version**, **stud: Open Global Config**, **stud: Open Project Config**, or **stud: Reveal Config Locations**.

To build an installable VSIX, run the packaging script with the target file name. The version in the name is written to `package.json` before packaging. It needs Node.js 22 or newer because `@vscode/vsce` requires it.

```bash
npm run package -- --output-file stud-0.0.2.vsix
cursor --install-extension stud-0.0.2.vsix --force
```

Leave `stud.executablePath` empty to use discovery. Set it when the binary is somewhere else. Turn off `stud.searchPath` to require the explicit path.
