# AGENTS.md

## 1. Overview
This package implements the opencode agents plugin: agent definitions, runtime hooks, provider/catalog injection, user override loading, permission enforcement, and shared run-document protocol.

## 2. Ownership Map
### Stable Ownership Boundaries

- **Plugin hook boundary**: Start in `src/index.ts` when changing runtime integration with opencode. It owns agent record assembly, `config`, `tool.execute.before`, `chat.message`, and `event` hooks while bridging SDK type gaps through `PluginHooks`; verify through `test/plugin.test.ts`.
- **Agent prompt boundary**: Start in `src/agents/*` and shared prompt blocks in `src/core/doc-protocol.ts` when changing agent roles or handoff rules. Agent files own behavior text only, while permissions remain in `permissions.ts`; verify through plugin load tests and document protocol tests.
- **Config override boundary**: Start in `src/core/config.ts` when changing user/project `agents.toml`, presets, model overrides, reasoning effort, prompt append, or disabled agents. It owns schema validation, warning emission, merge precedence, and immutable agent-record transformation; verify through `test/config.test.ts` and CLI validate/doctor consumers.
- **Catalog/provider boundary**: Start in `src/core/catalog.ts` and `src/core/catalog.toml` when changing models, provider shape, managed catalog lookup, checksums, or runtime fallback. It owns parsed catalog validity and generated provider config consumed by plugin config injection and the CLI; verify through catalog assertions in `test/plugin.test.ts`, `test/config.test.ts`, and CLI update/doctor tests.
- **Permission boundary**: Start in `src/core/permissions.ts` when changing tool access, session-to-agent resolution, `.agents/**` baseline behavior, docs-only/source policies, or task delegation rules. It owns fail-safe denial for unknown change-capable sessions and policy-map enforcement; verify through `test/permission.test.ts`.
- **Run-document protocol boundary**: Start in `src/core/doc-protocol.ts` when changing agent names, handoff filenames, `runDocPath`, or shared prompt rules. It is the single source for `AgentName`, `AGENT_NAMES`, `AGENT_DOC_MAP`, and prompt blocks imported by agents and permissions; verify through `test/doc-protocol.test.ts`.

## 3. Core Behaviors & Patterns
- **Centralized exports and aliases**: `src/core/index.ts` re-exports core modules, package exports expose `.` and `./core`, and tests/Vitest aliases mirror `@opencode/*`. New public helpers should be exported through the same core barrel only when they are intended for CLI or package consumers.
- **Strict config parsing with soft failure**: TOML is parsed with `smol-toml`, validated with strict Zod schemas, and reported through `onWarning` plus optional `console.warn`. Invalid files or invalid model IDs return safe empty/null config rather than throwing through normal runtime startup.
- **Preset and override application is immutable**: `deepMerge` gives project/root overrides precedence over preset defaults, `applyAgentOverrides` creates a new agent record, removes `enable=false` agents, and injects `reasoning_effort` under `options.extraBody` only when the effective model allows it.
- **Permissions combine baseline and deltas**: `.agents/**` is always allowed for every known agent, then `PERMISSION_POLICY` applies source read/edit, bash, webfetch, and task rules. Unknown sessions allow read-only tools but reject change-capable tools.
- **Document protocol drives prompts and enforcement**: Agent prompt files import shared `PATHS_ONLY_RULE`, `APPEND_ONLY_RULE`, `SSOT_RULE`, and `TASKID_RULE`; permissions imports `AGENT_NAMES` from the same protocol module. Keep handoff file naming and prompt contracts in one place.
- **Runtime catalog fallback is narrow**: `loadRuntimeCatalog` falls back to the bundled catalog only when a managed project catalog exists and fails to parse/load. Other bundled catalog failures still surface as errors.

## 4. Conventions
- **File roles**: `src/agents/*.ts` contain agent definitions and prompt text; `src/core/*.ts` contain reusable runtime logic; `src/index.ts` is the plugin composition entry point.
- **Naming**: Types/interfaces use `PascalCase`; functions and variables use `camelCase`; constants use `UPPER_SNAKE_CASE` for fixed tables, lists, and environment-derived sets.
- **Imports**: Internal package imports use `@opencode/core/*`, `@opencode/agents/*`, or `@opencode/*` aliases; Node built-ins use `node:` specifiers.
- **Schema and boundary validation**: External config/catalog inputs use Zod schemas and explicit validation helpers before becoming runtime state. Unknown override fields are rejected with `.strict()` rather than ignored.
- **Comments and prompt text**: Source comments and CLI/runtime warnings commonly use Korean. Keep comments focused on ownership, compatibility, or non-obvious runtime constraints; avoid restating simple code.
- **State and JSON output**: Managed state writes to `.opencode/agents.state.json` with pretty JSON plus trailing newline. Config and catalog APIs return plain objects rather than classes.

## 5. Working Agreements
See root `/AGENTS.md` for common working agreements.

Package-local verification: run `pnpm check` after changes in this package.
