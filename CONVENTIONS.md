# Conventions

Coding, testing, and architecture standards for the `studapart.stud` editor extension. These are blocking for contributors and agents.

## Product boundary

- The extension is a wrapper around a **user-installed** `stud` executable. The CLI remains the source of truth for Git, Jira, Linear, GitHub, and GitLab behavior.
- Never call Jira, Linear, GitHub, or GitLab HTTP APIs from the extension. Never reimplement a stud workflow in TypeScript.
- Never vendor, copy, or translate `stud-cli` PHP code.
- Do not bundle or download a stud runtime. SCI-113 records the later portable-install contract in `documentation/sci-113-managed-runtime.md` and does not add a downloader. Discovery is the explicit `stud.executablePath`, then `PATH`, then `~/.local/bin/stud`. Do not install stud from the extension.
- Machine contract with stud: spawn the executable with `--agent`, send one JSON object on stdin, read one JSON object on stdout. `success: false` carries an `error` string. Command schemas come from `stud help --agent`, not from hard-coded keys.

## Stack

- TypeScript 5 with `"strict": true`, CommonJS output, ES2022 target (`tsconfig.json`).
- Node.js 18+. The VS Code engine floor is declared in `package.json` (`engines.vscode`); it also pins `@types/vscode`.
- npm with a committed `package-lock.json`. No other package manager.
- Tests run with Node's built-in runner (`node --test`). No test framework dependency unless a ticket adds one.
- One VSIX runs in Cursor and VS Code. Use only the stable `vscode` API; no proposed APIs.

## Layout

```text
package.json          extension manifest: commands, settings, activation events
src/extension.ts      VS Code adapter: activation, command registration, output channel, settings, child processes
src/<feature>.ts      policy modules: pure functions and types, no `vscode` import
src/<feature>.test.ts node:test suites for the sibling module
out/                  compiled output (gitignored)
.vscode/              Extension Development Host launch and build tasks
```

## Architecture

- **Adapter vs policy.** Anything that imports `vscode` or `node:child_process` is an adapter and stays thin: read input, call a policy function, render the result. Decisions (validation, argument shaping, result formatting, error mapping) live in policy modules with no `vscode` import so that `node --test` can exercise them.
- **Manifest is product surface.** New commands and settings are declared in `package.json` under `contributes` with the `stud` category / `stud.` prefix, and referenced from code through exported constants, not string literals repeated across files.
- **Process execution.** Use `execFile` or `spawn` with an argument array. Never `exec`, never `shell: true`, never string-concatenate a command line. Set a timeout. Pass `windowsHide: true`.
- **Output.** User-facing results go to the `stud` output channel plus one notification (`showInformationMessage` / `showWarningMessage` / `showErrorMessage`). Do not write to `console` in shipped code.
- **Disposal.** Every disposable created in `activate` is pushed to `context.subscriptions`.
- **Errors.** Map process and parse failures to a user-readable summary and keep raw stderr/stdout in the output channel detail. Do not swallow errors silently.
- **Indirection.** Prefer inline code to single-use helpers; add a module or function when it owns a rule, removes branching, or is reused. No pass-through wrappers.

## Type safety and style

- `strict` compiler options stay on. No `any`; use `unknown` and narrow. Prefer `readonly` on data shapes and `as const` on fixed argument lists.
- Explicit types on exported functions and module-level constants; inference is fine for locals.
- Discriminated unions (`kind: 'run' | 'missing-path'`) over boolean flag soup.
- Imports: `node:` prefix for Node built-ins; no unused imports.
- Keep functions small (aim ≤ 40 lines, ≤ 4 parameters; group related parameters into an object). Nesting depth ≤ 3.
- Formatting follows the existing files: 2-space indent, single quotes, trailing commas, semicolons.

## Testing

- Every exported function in a policy module has node:test coverage for its happy path, blank/undefined input, and failure shapes.
- Tests assert **intent** (returned shape, classification, message content by regex), not exact rendered strings or incidental ordering.
- Tests are deterministic and do not spawn real `stud`, touch the network, or depend on the user's machine configuration.
- Manifest contracts (`package.json` commands, settings, `.vscode/launch.json`) are asserted in tests so drift fails fast.
- `src/extension.ts` is verified through the Extension Development Host (**Run Extension**, then the command palette); keep it thin enough that this manual check suffices.
- `npm test` must pass before commit. It compiles with `tsc` then runs all `out/**/*.test.js`.

## Documentation

- `README.md` documents commands, settings, limitations, and the development loop. Update it whenever a command, setting, or limitation changes.
- `CHANGELOG.md`: add behavior changes under the existing `## [Unreleased]` header; never create version headers by hand.
- Durable architecture decisions go to `documentation/adr-NNN-<slug>.md` (create `documentation/` and `documentation/index.md` on first use).

## Dependencies

- Runtime dependencies are avoided; the extension should ship with none unless a ticket proves the need.
- Dev dependencies are limited to `typescript`, `@types/node`, `@types/vscode`, and packaging tooling (`@vscode/vsce`) when packaging work lands.
