# Usage guide

English | [한국어](usage.ko.md)

This guide covers installation and day-to-day use of `@livteam/agents-cli`. The CLI installs and manages the agent definitions in this repository for Codex and OpenCode. The OpenCode plugin ID remains `buyong-agents` for compatibility.

## Requirements

- Node.js 18 or later
- npm

Verify both tools before installation:

```sh
node --version
npm --version
```

## Install the CLI

```sh
npm install --global @livteam/agents-cli
agents --help
```

You can also run a command without a global installation:

```sh
npx --yes @livteam/agents-cli doctor --target codex
```

The CLI does not currently expose `agents --version`. See [Version management](#version-management) for version checks.

## Interactive installation

```sh
agents install
```

Select Codex, OpenCode, or both. When OpenCode is selected, also choose where its configuration should be installed.

| OpenCode scope | Configuration path | Use it when |
| --- | --- | --- |
| `user` | `~/.config/opencode/agents.toml` or `$XDG_CONFIG_HOME/opencode/agents.toml` | The same configuration should apply across projects. |
| `project` | `<project>/.opencode/agents.toml` | Configuration belongs to one project or team. |

For project scope, run the command from the project root or add `--project <project-path>`.

Verify the result:

```sh
agents doctor
```

## Non-interactive installation

Specify the target and OpenCode scope when scripting the installation:

```sh
agents install --target codex
agents install --target opencode --opencode-scope project
agents install --target all --opencode-scope user
```

`--target all` includes OpenCode and therefore requires `--opencode-scope user` or `--opencode-scope project`.

## Command overview

| Goal | Command | Behavior |
| --- | --- | --- |
| Install | `agents install` | Installs selected targets and switches to the update flow when they are already managed. |
| Update managed files | `agents update` | Updates installed targets and switches to installation when no managed target exists. |
| Diagnose | `agents doctor` | Checks configuration, installation state, and runtime readiness. |
| Back up | `agents backup` | Records the current target files for later restoration. |
| Restore | `agents restore` | Restores a selected backup or one provided with `--backup <ID>`. |
| Uninstall | `agents uninstall` | Removes CLI-managed files while preserving user-owned configuration where possible. |
| Upgrade an archive installation | `agents upgrade` | Upgrades older GitHub Release installations; npm installations receive the npm update command instead. |

`status` and `validate` are temporary compatibility commands and are not part of the public command surface. Use `agents doctor` for status and configuration checks.

## Adopt an existing installation

If compatible files already exist but are not managed by the CLI, do not overwrite them directly. Back them up, review the backup, and then adopt them:

```sh
agents backup --target opencode --opencode-scope project
agents install --target opencode --opencode-scope project --adopt
```

Use the same target and scope for both commands. `--adopt` brings existing files under CLI management without blindly deleting user configuration.

## Update managed files and the CLI

Managed Codex and OpenCode files are updated separately from the npm-installed CLI:

```sh
agents update
npm install --global @livteam/agents-cli@latest
```

On npm installations, `agents upgrade` leaves files unchanged and prints the npm command to use. It is reserved for older installations created from GitHub Release archives.

## Back up and restore

Create a backup before adopting, replacing, or removing an installation:

```sh
agents backup --target codex
agents backup --target opencode --opencode-scope project
agents backup --target all --opencode-scope project --json
```

The human-readable output labels the backup identifier as `ID`. Machine-readable `--json` and `--format=kv` output use `backupId`.

Restore interactively or provide a backup ID:

```sh
agents restore
agents restore --backup <backup-id>
```

Restoration can overwrite changes made after the backup. The CLI attempts to create a pre-restore backup before applying files. Always run `agents doctor` after a restore.

## Uninstall managed files

```sh
agents uninstall --target codex
agents uninstall --target opencode --opencode-scope project
agents uninstall --target all --opencode-scope user
```

Use the same OpenCode scope that was used during installation. Files not owned by the CLI are preserved where possible.

## OpenCode configuration

The OpenCode plugin uses TOML configuration files. Project configuration takes precedence over user configuration.

| Scope | Path |
| --- | --- |
| Project | `.opencode/agents.toml` |
| User | `~/.config/opencode/agents.toml` or `$XDG_CONFIG_HOME/opencode/agents.toml` |

Without a configuration file, the plugin uses its default agent definitions and bundled catalog. See [packages/opencode/agents.example.toml](../packages/opencode/agents.example.toml) for a complete example.

```toml
# preset = "performance"

[agents.orchestrator]
model = "ollama-cloud/glm-5.2"
reasoning_effort = "max"

[agents.worker]
reasoning_effort = "high"
disabled_mcp = ["browser"]

[agents.idea-generator]
enable = false
```

| Field | Description |
| --- | --- |
| `model` | Selects a model ID from the bundled catalog. |
| `reasoning_effort` | Sets a reasoning-effort value allowed by the selected model. |
| `prompt_append` | Appends project-specific instructions to an agent prompt. |
| `enable` | Disables selected non-protected agents. |
| `disabled_mcp` | Adds case-sensitive denials for MCP server keys configured in native `opencode.json(c)`. `"*"` denies all MCP server tools, while `[]` clears inherited additional denials. |

Configured MCP servers are treated as capabilities explicitly trusted by the user. `disabled_mcp` can reduce that trust for a role but cannot infer or restrict the read, write, or network effects of individual server tools. The CLI does not own or modify native MCP configuration blocks.

## Diagnostics and troubleshooting

Start with:

```sh
agents doctor
```

Use detailed or machine-readable output when needed:

```sh
agents doctor --verbose
agents doctor --target opencode --opencode-scope project --json
agents doctor --target codex --format=kv
```

| Problem | What to check |
| --- | --- |
| `agents` is not found | Open a new terminal, inspect `npm prefix --global`, and confirm that the global executable directory is on `PATH`. |
| `npm` is not found | Install a current Node.js LTS release and open a new terminal. |
| Global npm installation fails with permissions | Fix ownership of the configured npm prefix instead of routinely using an administrator shell. |
| OpenCode requires a location | Use `--opencode-scope user` or run from the project root with `--opencode-scope project`; add `--project <path>` when targeting another project. |
| Existing files cannot be managed | Back up the same target and scope, inspect the files, then use `agents install --adopt`. |
| A GitHub Release cannot be read or verified | Check the network, retry later, and run `agents doctor --verbose` for details. |
| Changes are not visible after installation | Restart Codex or OpenCode and run `agents doctor`. |

Remove tokens, passwords, and personal paths before sharing verbose diagnostic output.

## Version management

Check the installed and latest versions:

```sh
npm list --global @livteam/agents-cli --depth=0
npm view @livteam/agents-cli version
```

Install a specific version:

```sh
npm install --global @livteam/agents-cli@<version>
```

Changing the CLI version does not automatically change managed Codex or OpenCode files. Run `agents doctor` after switching versions.

## Automation

Provide every target, scope, and project path explicitly to avoid interactive prompts. Use `--json` or `--format=kv` for machine-readable output:

```sh
agents install --target all --opencode-scope project --project <project-path>
agents backup --target all --opencode-scope project --json
agents restore --backup <backup-id> --format=kv
npx --yes @livteam/agents-cli doctor --target opencode --opencode-scope project --json
```

| Exit code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Warning |
| `2` | Invalid configuration or input |
| `3` | Operation blocked |
| `4` | Internal error |
