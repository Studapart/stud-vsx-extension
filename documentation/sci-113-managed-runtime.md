# SCI-113: Extension-managed stud-portable

Investigation only. This extension does not bundle, download, install, or update a stud runtime. v1 keeps the SCI-109 discovery order: `stud.executablePath`, then `PATH`, then `~/.local/bin/stud`. When nothing is found, the person installs stud themselves.

Managed runtime is a later milestone. This note is the contract for that milestone. It does not implement it.

## What ships today

Release `v4.1.0` of `Studapart/stud-cli` publishes exactly these assets:

- `stud-4.1.0.phar`
- `stud-portable-4.1.0-linux-amd64.tar.gz`
- `stud-portable-4.1.0-darwin-arm64.tar.gz`
- `checksums.txt`

There is no signature asset. SCI-98, the portable epic, deferred signing, notarization, and extension-managed updates. The tech spec for this issue names a SCI-106 signing record; that work item does not exist.

The name pattern is `stud-portable-<version>-<platform>.tar.gz`, next to `checksums.txt`, on `https://github.com/Studapart/stud-cli/releases/download/v<version>/`. The installer checks the archive with `sha256sum` or `shasum -a 256` against the matching line in `checksums.txt`.

`setup-stud.sh` still defaults to `--phar`. For this extension, the preferred later artifact is portable (`--portable`), not PHAR. Portable carries its own PHP. The Jira text for SCI-113 still calls PHAR the recommended default; that sentence matches the installer, and it does not match the extension preference.

## Platforms and editor hosts

Map the extension host, not the window the person is looking at. A WSL remote runs the extension inside Linux, so `process.platform` is `linux` even when the desktop is Windows.

| Extension host | Artifact | First managed milestone |
|----------------|----------|-------------------------|
| Linux x64, including WSL2 and an SSH remote on Linux x64 | `linux-amd64` | Supported |
| macOS Apple Silicon | `darwin-arm64` | Supported, with the Gatekeeper warning below |
| Native Windows (`win32`, not a WSL or Linux remote) | none | Refuse. Tell the person to open the workspace from WSL2 or macOS. |
| macOS Intel, Linux arm64, any other host | none | Refuse. The portable installer already rejects these and points at PHAR. This extension does not offer that fallback. |

## Trust

A checksum proves the archive matches `checksums.txt` from the same GitHub release. It does not prove the release itself is authentic: the archive and the checksum file are published together, and `v4.1.0` has no signature. Checksums are required before any later execution. They are not a signing program.

macOS remains unsigned and unnotarized. A valid checksum can still leave the binary quarantined. The later milestone shows this guidance and does not run it:

```bash
xattr -dr com.apple.quarantine "$HOME/.local/share/stud-portable/darwin-arm64/<version>"
```

System Settings approval may still be required. Do not claim the portable build is signed.

## Where a managed runtime would live

Use the installer's versioned layout, outside the workspace and outside extension storage:

- Bundle: `~/.local/share/stud-portable/<platform>/<version>/`
- Launcher symlink: `~/.local/bin/stud`

SCI-109 already discovers that symlink. A private extension directory would be a second install the current discovery order cannot see.

Refuse to replace `~/.local/bin/stud` when it exists and does not already point inside `~/.local/share/stud-portable/`. The installer has the same refusal unless `--force` is passed. The later milestone does not pass an equivalent of `--force`.

Do not download with `curl | bash`. Download the archive and `checksums.txt` as files, verify, then extract.

## Failure, rollback, offline

Describe these states. Do not build them in SCI-113.

- Download failed or the machine is offline: leave no version directory. The manual fallback stays "install stud yourself, or set `stud.executablePath`".
- Checksum mismatch or a missing `checksums.txt` line: delete the temp download. Do not extract and do not move the symlink.
- The archive has no executable `stud` launcher, or `stud --version` fails in the temp copy: do not install it.
- Interrupted update: previous version directories stay. Move the symlink only after the new copy has passed the smoke check. Rollback is repointing `~/.local/bin/stud` at an older version directory.
- Cleanup of old versions is opt-in. `stud update --quiet` already keeps old versions. The first milestone does not delete them.

There is no enterprise mirror setting. `STUD_INSTALL_VERSION` can pin a version, and the URL is still `github.com/Studapart/stud-cli`. A mirror is a follow-up, not part of the first milestone.

## Smallest later milestone

One explicit confirmation, only when discovery finds no stud, only on `linux-amd64` and `darwin-arm64`:

1. Download that platform's portable archive and `checksums.txt` from the GitHub release.
2. Verify SHA-256. On mismatch, stop.
3. Install into the versioned directory above and link `~/.local/bin/stud` only when that path is absent or already managed.
4. On macOS, show the quarantine guidance before the first run.
5. After a managed install exists, updates go through `stud update`, not a second downloader in the extension.

Out of that milestone: bundling a runtime in the VSIX, native Windows, PHAR, signing, auto-update on activation, enterprise mirrors, and replacing an unmanaged `stud`.

## Open questions

- Who publishes a signature, and which key the extension would trust, once signing exists.
- Whether a company mirror is required before any editor install is offered.
- How `stud update` behaves with no terminal when a later ticket wraps it. `stud update --quiet` is the candidate; this investigation does not run it.
