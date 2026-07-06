# AGENTS.md

## 1. Overview
This package implements the `agents` CLI that installs the opencode plugin, manages project/user configuration, validates runtime readiness, and applies release catalog or CLI artifacts.

## 2. Ownership Map
### Stable Ownership Boundaries

- **Command dispatch boundary**: Start in `src/cli.ts` when changing accepted commands, exit codes, help output, or command routing. It owns `CLI_COMMANDS`, `runCli`, and the `install|uninstall|validate|doctor|update|upgrade` switch contract consumed by tests; verify through `test/install-uninstall.test.ts`, `test/validate-doctor.test.ts`, and `test/update-upgrade.test.ts`.
- **Install/uninstall mutation boundary**: Start in `install`, `uninstall`, `ensurePluginEntry`, `ensureProvider`, and `removeProvider` when changing native `opencode.json` or `.opencode/agents.toml` behavior. It owns non-destructive plugin/provider mutation plus install-state cleanup; verify with the project-scope install/uninstall tests that preserve unrelated MCP and custom provider entries.
- **Release artifact boundary**: Start in `readLatestManifest`, `verifyChecksum`, `update`, `upgrade`, `assertSafeArchivePath`, and `applyCliArtifact` when changing catalog or CLI updates. It owns checksum validation, managed catalog/state writes, tar path safety, and the limited file set copied from artifacts; verify through `test/update-upgrade.test.ts`.
- **Diagnostics boundary**: Start in `validate` and `doctor` when changing config health reporting. It owns invalid TOML/schema/model/reasoning output, catalog source/freshness fields, environment readiness, and exit-code mapping; verify through `test/validate-doctor.test.ts`.

## 3. Core Behaviors & Patterns
- **CLI I/O injection**: `runCli` normalizes `CliIO` so tests pass `cwd`, `env`, `stdout`, and `stderr` callbacks instead of relying on process globals. New command logic should write through the resolved callbacks and return numeric exit constants.
- **Config mutation is non-destructive**: Install/uninstall helpers read JSON objects, validate expected shapes, add only missing `plugin`/`provider` entries, and remove only entries recorded in `agents.install.json`. Preserve unrelated config such as MCP blocks and custom provider entries.
- **Release writes are guarded before mutation**: Remote or file artifacts go through `readLocation`, checksum verification, safe tar path validation, staging-directory unpacking, and atomic copy before they touch the installed CLI files. Keep new artifact paths inside the explicit allowlist.
- **Validation separates user-facing status from fatal failures**: `validate` and `doctor` collect loader warnings, deduplicate validation messages, print stable `key=value` diagnostics, and map invalid config/catalog states to explicit exit constants. Add new diagnostics as stable fields, not ad hoc prose.

## 4. Conventions
- **Naming**: Functions and variables use `camelCase`; interfaces use `PascalCase`; constants use `UPPER_SNAKE_CASE` for exit codes and fixed command metadata.
- **Command shape**: Each command handler is an `async function <command>(args, io): Promise<number>` that resolves the project directory from `--project` and returns one of the shared exit constants.
- **Filesystem writes**: JSON config/state writes use `JSON.stringify(value, null, 2) + "\n"` and create parent directories with `{ recursive: true }`; temporary directories use `fs.mkdtempSync(path.join(os.tmpdir(), "..."))`.
- **Imports**: Node built-ins use `node:` specifiers, `opencode/core` provides shared core helpers, and `opencode` provides agent definitions. Do not duplicate catalog, config, or agent logic in the CLI.
- **Tests**: Tests use `collectOutput`, temporary directories under `os.tmpdir()`, and direct `runCli` calls for command behavior. Spawn the bin wrapper only for executable smoke coverage.

## 5. Working Agreements
See root `/AGENTS.md` for common working agreements.

Package-local verification: run `pnpm check` after changes in this package.
