# Change Log

All notable changes to the "ci-command-guard" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-22

### Added
- **GitHub Actions Workflow Analysis**: Statically parse and validate `.github/workflows/**/*.{yml,yaml}` files using AST positions.
- **Package Manager Script Verification**: Validate `npm`, `pnpm`, `yarn`, and `bun` script invocations against workspace `package.json` files.
- **Working-Directory Precedence**: Resolve effective directories using GitHub Actions precedence hierarchy (step $\succ$ job $\succ$ workflow $\succ$ workspace root).
- **Local Script & Executable Checks**: Statically verify local file invocations (`node`, `bash`, `sh`, `python3`, `python`, and `./<script>`) relative to effective working directories.
- **Conservative Analysis Model**: Intentionally exclude GitHub Actions expressions (`${{ ... }}`), shell variables (`$VAR`, `${VAR}`), command substitutions, inline scripts (`node -e`, `bash -c`), comments, and commands following dynamic directory changes (`cd ...`) to avoid false positives.
- **Deterministic Typo Correction**: Single-typo Levenshtein distance ($\le 2$) and case-insensitive matching for unambiguous script and directory names. Ambiguous candidates (e.g., `pest` matching `test`, `rest`, and `best`) are never guessed.
- **Native VS Code Diagnostics**: Precise token-level squiggles and rich explanations in the Problems panel detailing what, where, why, and suggested action.
- **Quick Fixes (`Ctrl+.` / `Cmd+.`)**: Safe single-reference quick fixes preserving surrounding YAML structure and comments.
- **Bulk Safe Fixes**:
  - `ci-command-guard.fixAllInFile`: Fix all safe issues in the active workflow file.
  - `ci-command-guard.fixAllInWorkspace`: Fix all safe issues across all workflow files in the workspace.
- **Native Modal Review Dialog**: Modal confirmation listing an exact summary of proposed file modifications with single native Cancel and dismiss safety.
- **Stale-Fix Protection**: Validate `expectedOriginalText`, range bounds, token overlap, and document version state before applying single or bulk edits. Aborts cleanly if any document changed since the scan.
- **Full Undo Support**: All modifications apply through standard VS Code `WorkspaceEdit`, allowing seamless undo (`Ctrl+Z`).
- **100% Local & Offline**: Operates completely on the local machine with zero AI/LLM calls, zero telemetry, and zero network access.
