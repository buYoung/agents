# AGENTS.md

## 1. Overview
This monorepo contains an opencode agents plugin package and a companion CLI for installing, validating, updating, and upgrading that plugin.

## 2. Ownership Map
### Stable Ownership Boundaries

- **Plugin runtime package**: Start in `packages/opencode` when changing agent definitions, runtime hooks, provider injection, TOML config loading, catalog parsing, permissions, or run-document protocol. It owns the public `opencode` and `opencode/core` exports consumed by the CLI and tests; verify through the `packages/opencode/test` coverage for plugin loading, config, permissions, document protocol, and catalog behavior.
- **CLI package**: Start in `apps/cli` when changing the `agents` command surface, installation state, native `opencode.json` mutation, release artifact handling, or validation/doctor output. It owns the executable command behavior and consumes `opencode` package exports rather than duplicating plugin logic; verify through the `apps/cli/test` suites for install/uninstall, validate/doctor, and update/upgrade.
- **Workspace contract**: Start at root `package.json`, `pnpm-workspace.yaml`, and `turbo.json` when changing package boundaries or shared task orchestration. The root owns workspace discovery for `apps/*` and `packages/*` and must keep dependency direction from `apps/cli` to `packages/opencode`; verify by checking package manifests and TypeScript path aliases in each package.

## 3. Working Agreements
- Respond in user's preferred language; if unspecified, infer from codebase (Korean comments and CLI messages are common; keep tech terms in English, never translate code blocks)
- Ask the user before introducing tests, lint, or formatter setups; add them only on explicit request
- Build context by reviewing related usages, flows, patterns, and likely impact before editing
- Fix the underlying cause, not only the visible symptom; inspect affected flows and apply the narrowest complete change that resolves the root issue
- Check side effects across callers, shared abstractions, and behavior/API boundaries; report relevant impact and compatibility risks
- Ask actively when user decisions are needed for scope, behavior, or tradeoffs
- Run type-check after code changes (`pnpm check-types` is the root script; package-level `pnpm check` details belong in package AGENTS.md files)
- New functions: single-purpose, colocated with related code
- External dependencies: only when necessary, explain why
- Put package-only tests/type-check/verification guidance in the package-level AGENTS.md, not the root document

## 4. User Custom
- Absolute rule for `fable5.md`: for any work involving `fable5.md`, read `fable5.md` first and treat its current contents as the source of truth. Do not skip this rule for convenience.
- Absolute rule for `codemap-search`: actively use `codemap-search` for code exploration and repository navigation. Prefer it over generic Read, Grep, Find, shell search, or broad file-reading workflows whenever it is available and suitable; do not skip this rule for convenience.

## 5. Codex Custom Agents
- Repository-managed Codex custom agent files live in `packages/codex/agents/*.toml`. They are Codex-adapted from the opencode agent roles; keep Codex runtime behavior changes in `packages/codex/agents` and keep shared role-contract changes aligned with `packages/opencode/src/agents`.
- If the user uses a short orchestration trigger such as "오케스트레이션", "오케스트레이터", "orchestrator", "agent_type orchestrator", or "orchestrator agent", route immediately to the Codex custom agent `agent_type="orchestrator"`. This is not the `$orchestration` skill.
- When routing to `agent_type="orchestrator"`, do not do repository exploration, implementation, verification, or document writing in the main session first.
- Pass only a normalized goal, hard constraints, relevant paths, and expected deliverables in the subagent `message`. Do not paste the user's full message, transcript, or a `요청 원문:` block into the orchestrator prompt.
- Prefer direct leaf-agent delegation: `code-explorer` for read-only repository reconnaissance, `planner` for convergent implementation planning, `research` for current external facts, `worker` for scoped implementation, `adversarial-review` for defect/security/regression review, `constructive-feedback` for improvement suggestions, `idea-generator` for divergent alternatives, and `intent-checker` only for explicit intent confirmation.
- Do not spawn the custom `orchestrator` as a routine intermediate agent unless the user explicitly invokes orchestration as above. Use the main Codex session as the router and spawn leaf agents directly for ordinary delegated work.
