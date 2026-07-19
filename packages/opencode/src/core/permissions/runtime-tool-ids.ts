/** OpenCode 1.17.x에서 이 권한 계층이 분류하는 예약 runtime 도구 ID. */

export const RUNTIME_READ_TOOL_IDS = [
  "read",
  "glob",
  "grep",
  "list",
  "lsp",
  "codesearch",
] as const;

/**
 * OpenCode V2 registry binds `apply_patch` to the shared `edit` permission.
 * The fixed 1.17.13 plugin adapter forwards the exact tool ID and raw args to
 * `tool.execute.before`, so this policy layer validates its hunk targets here.
 */
export const RUNTIME_EDIT_TOOL_IDS = ["edit", "write", "apply_patch"] as const;

export const RUNTIME_BASH_TOOL_IDS = ["bash"] as const;

export const RUNTIME_NETWORK_TOOL_IDS = ["webfetch", "websearch"] as const;

export const RUNTIME_TASK_TOOL_IDS = ["task"] as const;

/** OpenCode native permission namespace와 충돌하면 안 되는 core 권한 ID. */
export const RUNTIME_CORE_PERMISSION_IDS = [
  "doom_loop",
  "external_directory",
  "plan_enter",
  "plan_exit",
] as const;

export const GENERIC_MCP_RESOURCE_TOOL_IDS = [
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
] as const;

export const RESERVED_RUNTIME_TOOL_IDS = [
  ...RUNTIME_READ_TOOL_IDS,
  ...RUNTIME_EDIT_TOOL_IDS,
  ...RUNTIME_BASH_TOOL_IDS,
  ...RUNTIME_NETWORK_TOOL_IDS,
  ...RUNTIME_TASK_TOOL_IDS,
  ...RUNTIME_CORE_PERMISSION_IDS,
  ...GENERIC_MCP_RESOURCE_TOOL_IDS,
] as const;

export const RESERVED_RUNTIME_TOOL_ID_SET: ReadonlySet<string> = new Set(
  RESERVED_RUNTIME_TOOL_IDS,
);
