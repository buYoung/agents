# buyong-agents

English | [한국어](https://github.com/buYoung/agents/blob/main/README.ko.md)

Agent definitions for Codex and an agents plugin for OpenCode, distributed through one installation and management CLI.

## Packages

| Package | Path | Purpose |
| --- | --- | --- |
| OpenCode plugin | `packages/opencode` | Agent definitions, permission policies, TOML configuration, model catalog, and run-document protocol. |
| CLI | `apps/cli` | Installation, updates, diagnostics, backups, restoration, and removal through the `agents` command. |

## Agent lineup

The project provides a primary orchestrator and eight focused agents.

| Agent | Role |
| --- | --- |
| `orchestrator` | Classifies requests and coordinates delegation. |
| `intent-checker` | Confirms that a concrete plan matches the user's intent. |
| `worker` | Implements approved changes and runs verification. |
| `planner` | Produces a convergent implementation plan. |
| `research` | Investigates current external facts and documentation. |
| `code-explorer` | Locates internal code and recurring patterns. |
| `idea-generator` | Explores alternatives and tradeoffs. |
| `adversarial-review` | Finds defects, regressions, and security risks. |
| `constructive-feedback` | Suggests maintainability and consistency improvements. |

## Quick start

Requires Node.js 18 or later and npm.

```sh
npm install --global @livteam/agents-cli
agents install
agents doctor
```

`agents install` lets you select Codex, OpenCode, or both. The `agents doctor` command verifies the resulting installation and runtime readiness.

## Documentation

- [Usage guide](docs/usage.md)
- [한국어 사용 안내](docs/usage.ko.md)
- [Developer specifications](docs/specs/index.md)
- [Feature design documents](docs/FDD/index.md)
- [Agent prompt evaluations](docs/evals/agent-prompts)
- [npm publishing guide](docs/guides/npm-publishing.md)

## Development

```sh
pnpm install
pnpm check-types
pnpm test
pnpm build
```

Run package-level checks when working within one ownership boundary:

```sh
pnpm --filter opencode check
pnpm --filter opencode test
pnpm --filter ./apps/cli check
pnpm --filter ./apps/cli test
```

See [AGENTS.md](AGENTS.md) for repository ownership boundaries and working agreements.
