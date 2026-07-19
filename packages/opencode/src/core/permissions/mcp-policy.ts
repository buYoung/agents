/**
 * permissions/mcp-policy.ts — native MCP 구성에서 역할별 도구 정책 컴파일
 *
 * OpenCode 1.17.x는 MCP 도구 ID를
 * `sanitize(serverKey) + "_" + sanitize(toolName)`으로 만든다. 훅에는
 * 서버 provenance가 아니라 이 최종 ID만 오므로, 이 모듈은 구성된 서버 키를
 * 사용자 신뢰 경계로 삼되 ID 자체가 provenance라는 주장은 하지 않는다.
 */

import type { AgentName } from "@opencode/core/doc-protocol";
import type { PluginConfig } from "@opencode/core/config";
import { RESERVED_RUNTIME_TOOL_ID_SET } from "./runtime-tool-ids";

export interface ConfiguredMcpServerPolicy {
  /** native `mcp` 객체의 원래 서버 키. `disabled_mcp`와 대소문자까지 비교한다. */
  serverKey: string;
  /** OpenCode가 도구 ID에 사용하는 정리된 서버 키. */
  sanitizedServerKey: string;
  /** 이 서버의 도구 ID에 공통인 접두사. */
  toolPrefix: string;
  /** OpenCode native permission/tools 설정에 쓰는 wildcard 키. */
  nativePermissionKey: string;
}

export interface ConfiguredMcpPolicy {
  servers: readonly ConfiguredMcpServerPolicy[];
  disabledByAgent: ReadonlyMap<AgentName, ReadonlySet<string>>;
  /**
   * OpenCode가 실제 MCP catalog에서 조립한 최종 tool key 집합이다.
   * 구성 서버 접두사는 후보를 찾는 데만 쓰고, 이 집합에 없는 key는
   * builtin 또는 미확인 도구로 fail-safe 처리한다.
   */
  mcpCatalogToolIds?: ReadonlySet<string>;
}

export interface ConfiguredMcpToolMatch {
  server: ConfiguredMcpServerPolicy;
  toolId: string;
}

const ALWAYS_DISABLED_MCP_AGENTS = new Set<AgentName>([
  "orchestrator",
  "intent-checker",
]);

/** OpenCode `McpCatalog.sanitize`와 의도적으로 byte-for-byte 같은 규칙. */
export function sanitizeMcpServerKey(serverKey: string): string {
  return serverKey.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function isEnabledMcpEntry(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return (value as { enabled?: unknown }).enabled !== false;
}

/**
 * 최종 native MCP 구성과 유효 plugin 설정을 결합한다.
 *
 * 정리 결과가 같거나 한 서버 접두사가 다른 서버 접두사의 시작이면 실제 도구
 * 이름을 보지 않고는 소유 서버를 판별할 수 없으므로 구성 오류로 거부한다.
 */
export function compileConfiguredMcpPolicy(
  nativeMcpConfig: unknown,
  pluginConfig: PluginConfig,
  managedAgentNames: readonly AgentName[],
): ConfiguredMcpPolicy {
  const nativeEntries =
    typeof nativeMcpConfig === "object" &&
    nativeMcpConfig !== null &&
    !Array.isArray(nativeMcpConfig)
      ? Object.entries(nativeMcpConfig as Record<string, unknown>)
      : [];

  const servers = nativeEntries
    .filter(([, value]) => isEnabledMcpEntry(value))
    .map(([serverKey]) => {
      if (serverKey.length === 0) {
        throw new Error("[agents] MCP 서버 키는 비어 있을 수 없습니다.");
      }
      const sanitizedServerKey = sanitizeMcpServerKey(serverKey);
      const toolPrefix = `${sanitizedServerKey}_`;
      // 구성 서버 키만으로는 실제 MCP catalog가 같은 최종 도구 ID를
      // 등록했는지 증명할 수 없다. builtin exact ID의 우선순위는
      // matchConfiguredMcpTool에서 보수적으로 처리한다.
      return {
        serverKey,
        sanitizedServerKey,
        toolPrefix,
        nativePermissionKey: `${toolPrefix}*`,
      } satisfies ConfiguredMcpServerPolicy;
    })
    .sort((left, right) => left.serverKey.localeCompare(right.serverKey));

  for (let leftIndex = 0; leftIndex < servers.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < servers.length;
      rightIndex += 1
    ) {
      const left = servers[leftIndex];
      const right = servers[rightIndex];
      if (!left || !right) continue;
      if (left.sanitizedServerKey === right.sanitizedServerKey) {
        throw new Error(
          `[agents] MCP 서버 키 정리 충돌 — "${left.serverKey}"와 "${right.serverKey}"가 모두 "${left.sanitizedServerKey}"로 정리됩니다.`,
        );
      }
      if (
        left.toolPrefix.startsWith(right.toolPrefix) ||
        right.toolPrefix.startsWith(left.toolPrefix)
      ) {
        throw new Error(
          `[agents] MCP 서버 도구 접두사 모호성 — "${left.serverKey}"(${left.toolPrefix})와 "${right.serverKey}"(${right.toolPrefix})를 함께 사용할 수 없습니다.`,
        );
      }
    }
  }

  const disabledByAgent = new Map<AgentName, ReadonlySet<string>>();
  for (const agentName of managedAgentNames) {
    const configuredDisabled =
      pluginConfig.agents?.[agentName]?.disabled_mcp ?? [];
    disabledByAgent.set(
      agentName,
      ALWAYS_DISABLED_MCP_AGENTS.has(agentName)
        ? new Set(["*"])
        : new Set(configuredDisabled),
    );
  }

  return { servers, disabledByAgent };
}

export function matchConfiguredMcpTool(
  policy: ConfiguredMcpPolicy | undefined,
  rawToolId: string,
): ConfiguredMcpToolMatch | undefined {
  if (!policy) return undefined;
  // OpenCode는 builtin/generic resource 도구를 먼저 등록한 뒤 MCP catalog
  // key로 덮어쓴다. builtin과 충돌할 수 있는 exact ID는 실제 MCP catalog
  // key로 확인될 때만 승격한다. 충돌하지 않는 ID는 접두사가 유일한 서버
  // 범위를 가리키므로 기존 native wildcard 정책과 같은 범위로 처리한다.
  if (
    RESERVED_RUNTIME_TOOL_ID_SET.has(rawToolId) &&
    !policy.mcpCatalogToolIds?.has(rawToolId)
  ) {
    return undefined;
  }
  const server = policy.servers.find(
    ({ toolPrefix }) =>
      rawToolId.startsWith(toolPrefix) && rawToolId.length > toolPrefix.length,
  );
  return server ? { server, toolId: rawToolId } : undefined;
}

export function isConfiguredMcpAllowed(
  policy: ConfiguredMcpPolicy,
  agentName: AgentName,
  serverKey: string,
): boolean {
  const disabled = policy.disabledByAgent.get(agentName);
  if (!disabled) return false;
  return !disabled.has("*") && !disabled.has(serverKey);
}

type NativePermissionAction = "allow" | "ask" | "deny";

function normalizeNativePermission(value: unknown): Record<string, unknown> {
  if (value === "allow" || value === "ask" || value === "deny") {
    return { "*": value };
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function normalizeLegacyTools(value: unknown): Record<string, boolean> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
    ),
  );
}

/**
 * 사용자/native agent 병합이 끝난 뒤 plugin-owned MCP 규칙을 마지막에 둔다.
 * `permission`이 OpenCode 1.17.x의 실제 집행 표면이며 `tools`는 이전 런타임
 * 호환을 위한 이중 표면일 뿐이다. 실행 전 훅도 같은 정책을 다시 집행한다.
 */
export function applyConfiguredMcpNativePolicy(
  nativeAgentRecord: Record<string, unknown>,
  policy: ConfiguredMcpPolicy,
  managedAgentNames: readonly AgentName[],
): void {
  const managedKeys = new Set(
    policy.servers.map(({ nativePermissionKey }) => nativePermissionKey),
  );

  for (const agentName of managedAgentNames) {
    const existingAgent = nativeAgentRecord[agentName];
    if (
      typeof existingAgent !== "object" ||
      existingAgent === null ||
      Array.isArray(existingAgent)
    ) {
      continue;
    }
    const agentConfig = existingAgent as Record<string, unknown>;
    const existingPermission = normalizeNativePermission(agentConfig.permission);
    const existingTools = normalizeLegacyTools(agentConfig.tools);
    const permissionWithoutManagedRules = Object.fromEntries(
      Object.entries(existingPermission).filter(([key]) => !managedKeys.has(key)),
    );
    const toolsWithoutManagedRules = Object.fromEntries(
      Object.entries(existingTools).filter(([key]) => !managedKeys.has(key)),
    );

    const managedPermissionRules: Record<string, NativePermissionAction> = {};
    const managedToolRules: Record<string, boolean> = {};
    for (const server of policy.servers) {
      const allowed = isConfiguredMcpAllowed(
        policy,
        agentName,
        server.serverKey,
      );
      managedPermissionRules[server.nativePermissionKey] = allowed
        ? "allow"
        : "deny";
      managedToolRules[server.nativePermissionKey] = allowed;
    }

    agentConfig.permission = {
      ...permissionWithoutManagedRules,
      ...managedPermissionRules,
    };
    agentConfig.tools = {
      ...toolsWithoutManagedRules,
      ...managedToolRules,
    };
  }
}
