packages/opencode 에서 agent 등록과 권한 집행의 핵심은 `doc-protocol` SSOT와 `index` 진입점, `permissions` 정책기에서 분리된다.

## 1) agent 등록 핵심 흐름
- `packages/opencode/src/core/doc-protocol.ts`: `AgentName`, `AGENT_NAMES`, `AGENT_DOC_MAP`, `DOCUMENTED_AGENTS`, `runDocPath`
- `packages/opencode/src/index.ts`: `plugin()`, `ALL_AGENTS`, `agentRecord`, `loadRuntimeCatalog()`, `loadPluginConfig()`, `applyAgentOverrides()`, `createSessionAgentMap()`

## 2) 권한 정책 집행 핵심 흐름
- `packages/opencode/src/core/permissions.ts`: `PERMISSION_POLICY`, `POLICY_MAP`, `createSessionAgentMap()`, `resolveAgent()`, `enforcePermission()`
- `packages/opencode/src/index.ts`: `plugin()`, `tool.execute.before`, `enforcePermission()`, `tool` 거부 오류 경로
