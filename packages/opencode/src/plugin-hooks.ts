/**
 * plugin-hooks.ts — 플러그인 훅 핸들러 조립
 *
 * index.ts는 에이전트 레코드·설정 로드 후 이 모듈에 훅 연결만 위임한다.
 */

import type { Config } from "@opencode-ai/plugin";
import type { AgentDefinition } from "@opencode/core/types";
import type { AgentName } from "@opencode/core/doc-protocol";
import { AGENT_NAMES } from "@opencode/core/doc-protocol";
import {
  applyConfiguredMcpNativePolicy,
  compileConfiguredMcpPolicy,
  enforcePermission,
  getAgentExecutionContext,
  getTaskExecutionContext,
  type ConfiguredMcpPolicy,
  type createSessionAgentMap,
} from "@opencode/core/permissions";
import type { PluginConfig } from "@opencode/core/config";
import { buildProviderConfig, type Catalog } from "@opencode/core/catalog";

type ConfigProviderMap = Record<string, Record<string, unknown>>;

export type SessionAgentMapApi = ReturnType<typeof createSessionAgentMap>;

export interface PluginHookHandlers {
  config: (opencodeConfig: Config) => Promise<void>;
  "tool.execute.before": (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: unknown },
  ) => Promise<void>;
  "chat.message": (
    input: { sessionID: string; agent?: string; [key: string]: unknown },
    output?: {
      message?: { agent?: string };
      parts?: Array<{ type?: string; text?: string }>;
    },
  ) => Promise<void>;
  event: (input: {
    event: { type: string; properties?: unknown };
  }) => Promise<void>;
}

export function createPluginHookHandlers(options: {
  catalog: Catalog;
  finalAgentRecord: Record<string, AgentDefinition>;
  disabledNames: string[];
  enabledSubagentNames: AgentName[];
  workspaceRoot: string;
  sessionAgentMap: SessionAgentMapApi;
  pluginConfig: PluginConfig;
}): PluginHookHandlers {
  const {
    catalog,
    finalAgentRecord,
    disabledNames,
    enabledSubagentNames,
    workspaceRoot,
    sessionAgentMap,
    pluginConfig,
  } = options;
  const {
    map,
    assignmentMap,
    updateSessionAgent,
    bindSessionExecutionContext,
    registerDelegation,
    completeDelegation,
    failDelegation,
    deleteSession,
  } = sessionAgentMap;
  const managedAgentNames = Object.keys(finalAgentRecord).filter(
    (name): name is AgentName =>
      (AGENT_NAMES as readonly string[]).includes(name),
  );
  let configuredMcpPolicy: ConfiguredMcpPolicy | undefined;

  const config = async (opencodeConfig: Config): Promise<void> => {
    const cfg = opencodeConfig as Record<string, unknown>;
    let runtimeAgentRecord = finalAgentRecord;

    // 최종 native config의 enabled MCP 서버만 사용자 신뢰 capability로
    // 컴파일한다. 충돌/모호성은 agent 권한을 변경하기 전에 구성 오류로 닫는다.
    configuredMcpPolicy = undefined;
    configuredMcpPolicy = compileConfiguredMcpPolicy(
      cfg.mcp,
      pluginConfig,
      managedAgentNames,
    );

    try {
      const provider = buildProviderConfig(catalog);
      const providerMap =
        typeof cfg.provider === "object" &&
        cfg.provider !== null &&
        !Array.isArray(cfg.provider)
          ? (cfg.provider as ConfigProviderMap)
          : {};
      const existingProvider =
        typeof providerMap[provider.id] === "object" &&
        providerMap[provider.id] !== null &&
        !Array.isArray(providerMap[provider.id])
          ? providerMap[provider.id]
          : {};
      cfg.provider = {
        ...providerMap,
        [provider.id]: {
          ...provider,
          ...existingProvider,
          options: {
            ...provider.options,
            ...((existingProvider.options as
              | Record<string, unknown>
              | undefined) ?? {}),
          },
          models: {
            ...provider.models,
            ...((existingProvider.models as
              | Record<string, unknown>
              | undefined) ?? {}),
          },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[agents] catalog provider injection failed. validate 또는 doctor로 진단하세요: ${message}`,
      );
    }

    // default_agent: 사용자가 이미 설정한 built-in/custom 값은 보존한다.
    // 단, 이번 설정에서 명시적으로 비활성화한 플러그인 에이전트는
    // 실제 레코드에서도 제거되므로 안전한 orchestrator로 되돌린다.
    if (!(cfg as { default_agent?: string }).default_agent) {
      (cfg as { default_agent?: string }).default_agent = "orchestrator";
    } else if (
      disabledNames.includes(
        (cfg as { default_agent?: string }).default_agent ?? "",
      )
    ) {
      (cfg as { default_agent?: string }).default_agent = "orchestrator";
    }

    // 비활성화된 에이전트가 있으면 orchestrator 프롬프트에 알림 추가
    if (disabledNames.length > 0 && finalAgentRecord["orchestrator"]) {
      const disabledList = disabledNames.join(", ");
      const disabledNote =
        `\n\n## 비활성화된 서브에이전트\n` +
        `다음 서브에이전트는 비활성화되어 있으므로 위임해서는 안 됩니다: ${disabledList}.`;
      runtimeAgentRecord = {
        ...finalAgentRecord,
        orchestrator: {
          ...finalAgentRecord["orchestrator"],
          prompt: finalAgentRecord["orchestrator"].prompt + disabledNote,
        },
      };
    }

    // 에이전트 레코드 병합 (slim 패턴)
    if (!cfg.agent) {
      cfg.agent = { ...runtimeAgentRecord };
    } else {
      const configuredAgents = cfg.agent as Record<string, unknown>;
      for (const disabledName of disabledNames) {
        delete configuredAgents[disabledName];
      }
      for (const [name, pluginAgent] of Object.entries(runtimeAgentRecord)) {
        const existing = (cfg.agent as Record<string, unknown>)[name] as
          | Record<string, unknown>
          | undefined;
        if (existing) {
          (cfg.agent as Record<string, unknown>)[name] = {
            ...pluginAgent,
            ...existing,
          };
        } else {
          (cfg.agent as Record<string, unknown>)[name] = { ...pluginAgent };
        }
      }
    }

    if (configuredMcpPolicy.servers.length > 0) {
      applyConfiguredMcpNativePolicy(
        cfg.agent as Record<string, unknown>,
        configuredMcpPolicy,
        managedAgentNames,
      );
    }
  };

  const toolExecuteBefore = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: unknown },
  ): Promise<void> => {
    const args =
      output.args !== null &&
      typeof output.args === "object" &&
      !Array.isArray(output.args)
        ? (output.args as Record<string, unknown>)
        : {};

    const result = enforcePermission(
      {
        tool: input.tool,
        sessionID: input.sessionID,
        callID: input.callID,
        args,
      },
      map,
      {
        subagentNames: enabledSubagentNames,
        workspaceRoot,
        sessionAssignments: assignmentMap,
        sessionExecution: sessionAgentMap,
        configuredMcpPolicy,
      },
    );

    if (!result.allowed) {
      throw new Error(`[agents] 권한 거부 — ${result.reason}`);
    }

    if (input.tool.toLowerCase() === "task") {
      const context = getTaskExecutionContext(args, workspaceRoot);
      if (context) {
        const continuedSessionID = args["task_id"];
        if (
          !registerDelegation({
            parentSessionID: input.sessionID,
            callID: input.callID,
            ...(typeof continuedSessionID === "string"
              ? { continuedSessionID }
              : {}),
            context,
          })
        ) {
          throw new Error(
            `[agents] task 실행 예약 충돌 — parent=${input.sessionID}, callID=${input.callID}, taskId=${context.output.taskId}, workItemId=${context.output.workItemId}`,
          );
        }
      }
    }
  };

  const chatMessage = async (
    input: { sessionID: string; agent?: string; [key: string]: unknown },
    output?: {
      message?: { agent?: string };
      parts?: Array<{ type?: string; text?: string }>;
    },
  ): Promise<void> => {
    // output.message.agent가 OpenCode가 실제로 해소한 역할이다. 입력 힌트보다
    // 우선하고, custom/built-in 이름이면 updateSessionAgent가 stale 매핑을 지운다.
    const agent = output?.message?.agent ?? input.agent;
    if (agent) {
      if (!updateSessionAgent(input.sessionID, agent)) {
        throw new Error(
          `[agents] 같은 세션의 managed 역할 변경 거부 — sessionID=${input.sessionID}, requested=${agent}`,
        );
      }
      if ((AGENT_NAMES as readonly string[]).includes(agent)) {
        const prompt = (output?.parts ?? [])
          .filter((part) => part.type === "text" && typeof part.text === "string")
          .map((part) => part.text)
          .join("\n");
        const context = getAgentExecutionContext(
          agent as AgentName,
          prompt,
          workspaceRoot,
        );
        if (
          context &&
          !bindSessionExecutionContext(input.sessionID, context)
        ) {
          const existing = assignmentMap.get(input.sessionID);
          throw new Error(
            `[agents] 실행 할당 충돌 — sessionID=${input.sessionID}, existing=${existing?.taskId}/${existing?.workItemId}/${existing?.agent}, requested=${context.output.taskId}/${context.output.workItemId}/${context.output.agent}`,
          );
        }
      }
    }
  };

  const event = async (input: {
    event: { type: string; properties?: unknown };
  }): Promise<void> => {
    if (input.event.type === "message.part.updated") {
      const props = input.event.properties as
        | {
            part?: {
              callID?: string;
              sessionID?: string;
              type?: string;
              tool?: string;
              state?: {
                status?: string;
                input?: Record<string, unknown>;
                metadata?: Record<string, unknown>;
              };
            };
          }
        | undefined;
      const part = props?.part;
      const taskInput = part?.state?.input;
      const childSessionID = part?.state?.metadata?.["sessionId"];
      const parentSessionID = part?.sessionID;
      const callID = part?.callID;
      if (
        part?.type === "tool" &&
        part.tool === "task" &&
        part.state?.status === "error" &&
        typeof childSessionID !== "string" &&
        typeof parentSessionID === "string" &&
        typeof callID === "string"
      ) {
        failDelegation(parentSessionID, callID);
      }
      if (
        part?.type === "tool" &&
        part.tool === "task" &&
        taskInput &&
        typeof childSessionID === "string"
      ) {
        const context = getTaskExecutionContext(taskInput, workspaceRoot);
        if (
          !context ||
          typeof parentSessionID !== "string" ||
          typeof callID !== "string" ||
          !completeDelegation({
            parentSessionID,
            callID,
            childSessionID,
            context,
          })
        ) {
          throw new Error(
            `[agents] task lifecycle 상관관계/소유권 충돌 — parent=${parentSessionID ?? "unknown"}, callID=${callID ?? "unknown"}, child=${childSessionID}`,
          );
        }
      }
    }

    if (input.event.type === "session.deleted") {
      const props = input.event.properties as
        | { info?: { id?: string }; sessionID?: string }
        | undefined;
      const sessionID = props?.info?.id ?? props?.sessionID;
      if (sessionID) {
        deleteSession(sessionID);
      }
    }
  };

  return {
    config,
    "tool.execute.before": toolExecuteBefore,
    "chat.message": chatMessage,
    event,
  };
}
