# CI Command Guard

**Catch broken GitHub Actions command and path references before CI runs.**

A lightweight, deterministic developer tool for Visual Studio Code that statically validates script invocations, package scripts, working directories, and local file references in `.github/workflows/**/*.{yml,yaml}` files against your repository.

---

## The Problem

Developers frequently push commits only to wait several minutes for GitHub Actions runners to start, fail on a simple typo in an `npm run` script name, an uncommitted local helper script, or a mismatched `working-directory` path, and repeat the cycle.

While traditional YAML schema linters ensure syntactic validity of the workflow, they **do not check whether the referenced package scripts or local files actually exist in your repository**.

**CI Command Guard** bridges this gap by statically analyzing commands against your local repository filesystem and `package.json` files **before** you commit and push.

---

## 100% Local & Deterministic

- **Zero AI / External API calls**: Does not call any cloud service, LLM, backend, or external endpoint.
- **Zero Telemetry / Tracking**: Does not collect, log, or transmit any data.
- **No API Keys or Login Required**: Works out of the box offline.
- **Deterministic**: Consistent, reproducible diagnostics and safe corrections every time.

---

## Supported Checks

### 1. Package.json Script Verification
Validates that package manager script commands reference scripts declared in the applicable `package.json`:
- **Supported Package Managers**: `npm`, `pnpm`, `yarn`, `bun`.
- **Supported Syntax**:
  - `npm run <script>`
  - `pnpm run <script>` and `pnpm <script>`
  - `yarn run <script>` and `yarn <script>`
  - `bun run <script>` and `bun <script>`
  - Standard commands like `npm test` and `npm start`
- **Typo Correction**: Deterministic case-insensitive matching and single-typo Levenshtein distance matching ($\le 2$). If a typo unambiguously corresponds to an existing script, a safe Quick Fix is offered.
- **Ambiguity Guard**: If multiple declared scripts tie in similarity (e.g., `pest` matching `test`, `rest`, and `best`), no automatic fix is fabricated; manual correction is required.
- **Package Manager Reserved Subcommands**: Built-in commands such as `install`, `add`, `remove`, `update`, `exec`, `dlx`, `create`, `publish` are never falsely flagged as script names.

### 2. Static Working-Directory References
Checks explicit workflow `working-directory` declarations and `defaults.run.working-directory` settings:
- **Precedence**: Evaluates effective directory using GitHub Actions precedence:
  $$\text{Step } \texttt{working-directory} \succ \text{Job } \texttt{defaults.run.working-directory} \succ \text{Workflow } \texttt{defaults.run.working-directory} \succ \text{Repository root } (\texttt{.})$$
- **Verification**: Verifies that literal directory paths exist in the workspace.
- **Safe Correction**: Detects case-only mismatches (e.g. `packages/Frontend` vs `packages/frontend`) and offers an exact Quick Fix. Missing directories without a unique match require manual creation or correction.

### 3. Local Script and File References
Validates static local file invocations in `run:` steps:
- **Supported Launchers**:
  - `node <path>` (e.g., `node scripts/build.js`, `node ./scripts/generate.mjs`)
  - `bash <path>` (e.g., `bash ./scripts/release.sh`)
  - `sh <path>` (e.g., `sh scripts/check.sh`)
  - `python3 <path>` / `python <path>` (e.g., `python3 scripts/validate.py`)
  - Direct execution: `./<path>` (e.g., `./scripts/deploy.sh`)
- **Context Resolution**: Resolves paths relative to the step's effective working directory.
- **Case Correction**: Flags case-only mismatches and offers safe corrections.

### 4. Intentional Exclusions (Zero False Positives)
To preserve developer trust, CI Command Guard explicitly ignores:
- Remote action references in `uses:` (e.g., `actions/checkout@v4`).
- GitHub Actions expressions (e.g., `${{ matrix.script }}` or `${{ env.PATH }}`).
- Shell environment variables (e.g., `$CUSTOM_SCRIPT`, `${SCRIPT_NAME}`).
- Shell command substitutions (e.g., `$(find ...)` or backticks).
- Inline script evaluations (e.g., `node -e "..."` or `bash -c "..."`).
- Comments (full-line `# ...` and trailing `# ...`).
- Quoted string arguments inside `echo "..."` commands.
- Chained commands following dynamic directory changes (`cd <dir>`).

---

## User Experience

### Native Diagnostics
Findings appear natively in the **Problems panel** (`Ctrl+Shift+M` / `Cmd+Shift+M`) with squiggles highlighting the exact target token.

Each diagnostic explains:
1. **What**: The specific broken reference name.
2. **Where**: Where the extension looked for it (e.g. `package.json at ./packages/frontend/package.json`).
3. **Why**: Why the reference is considered broken.
4. **Action / Suggested Fix**: What can safely be done to correct it.

### Primary Fix Experience (`Ctrl+.`)
Placing the cursor on a diagnostic and pressing `Ctrl+.` (or `Cmd+.` on macOS) displays the Quick Fix menu:

1. **Fix this reference**: Replaces the selected, unambiguously fixable token with the safe correction. Leaves surrounding YAML indentation and comments untouched.
2. **Fix all safe issues in this workflow**: Batches all safe fixes in the active workflow file.
3. **Fix all safe issues in workspace**: Batches all safe fixes across all workflows in the workspace.

*Note: If an issue is ambiguous or requires manual file creation, no misleading automatic fix is offered for that specific finding, although wider bulk options remain available for other safe issues.*

### Bulk Fix Review & Safety Guarantee
Before any multi-edit or workspace-wide change is applied:
- A review modal presents an exact breakdown of proposed changes per file.
- Clicking **Cancel** leaves every file completely unchanged.
- Document versions and character offsets are validated prior to execution. If a file was modified while the review was open, the entire operation safely aborts before applying anything.
- All applied edits use native VS Code `WorkspaceEdit`, allowing full Undo (`Ctrl+Z`).

---

## Commands

Access via the VS Code Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Title | Description |
|---|---|---|
| `ci-command-guard.scanCurrentFile` | **CI Command Guard: Scan Current File** | Scans the active GitHub Actions workflow and reports status. |
| `ci-command-guard.scanWorkspace` | **CI Command Guard: Scan Workspace** | Scans all workflows across all workspace folders. |
| `ci-command-guard.fixAllInFile` | **CI Command Guard: Fix All Safe Issues in Current Workflow** | Opens review modal for all safe fixes in the current workflow. |
| `ci-command-guard.fixAllInWorkspace` | **CI Command Guard: Fix All Safe Issues in Workspace** | Opens review modal for all safe fixes across the workspace. |

---

## Development & Testing

### Prerequisites
- Node.js $\ge 18$
- npm $\ge 9$

### Setup
```bash
git clone https://github.com/AJ-Kaarthick/ci-command-guard.git
cd ci-command-guard
npm install
```

### Type Checking & Build
```bash
# Type check TypeScript files
npm run typecheck

# Production bundle via esbuild
npm run build
```

### Automated Tests
Run the comprehensive test suite (45 unit tests covering parser, shell tokenizer, analyzer, typo similarity, diagnostics, bulk engine, and lifecycle):
```bash
npm test
```

### Packaging
Package the production `.vsix` archive:
```bash
npm run package
```

### Manual QA Fixture
Run the self-contained QA setup script to prepare an isolated verification sandbox:
```bash
./test/fixtures/manual-test/setup-qa.sh
code /tmp/ci-command-guard-qa
```

---

## License

[MIT](LICENSE) © 2026 AJ Kaarthick
