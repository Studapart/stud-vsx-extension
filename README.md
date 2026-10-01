# stud

Editor extension for [stud](https://github.com/Studapart/stud-cli). It runs a **user-installed** `stud` executable from Cursor or VS Code. The CLI stays the source of truth.

Extension id: `studapart.stud`.

## What this version does

- Activates from the command palette.
- **stud: Check Version** runs `<stud.executablePath> --version` and writes the result to the **stud** output channel.
- **`stud.executablePath`** is the absolute path to that executable.

## Limitations

This extension is a thin wrapper. It is not a CLI replacement.

- It does not bundle or download a stud runtime. Install stud yourself (PHAR or portable), then set `stud.executablePath`.
- It does not search `PATH` or apply other discovery rules. That belongs to a later change.
- It does not call Jira, Linear, GitHub, or GitLab. It does not reimplement Git or work-item workflows.
- It does not ship a GUI panel.
- Open VSX listing and the Microsoft Marketplace are not part of this version. The same VSIX is meant to run in Cursor and VS Code via the extension development host or a sideload.

## Develop

Requires Node.js 18+.

```bash
npm install
npm test
```

In Cursor or VS Code, open this folder and run **Run Extension**. That starts an Extension Development Host with this extension loaded. Open the command palette and run **stud: Check Version**.

Set `stud.executablePath` in Settings before expecting a version string. An empty setting reports that the path is missing and does not guess a binary.
