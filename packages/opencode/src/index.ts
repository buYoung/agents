/**
 * index.ts — agents 플러그인 엔트리
 *
 * 8개 에이전트 정의를 조립하고, 권한 훅과 세션 추적 훅을 등록한다.
 * config.ts를 통해 TOML 설정 파일에서 에이전트 오버라이드를 로드한다.
 *
 * 반환 형태:
 *   { agent, config, "tool.execute.before", "chat.message", event }
 *
 * NOTE: @opencode-ai/plugin@1.17.13의 Hooks 인터페이스에는 `agent` 필드가
 * 선언되어 있지 않지만, opencode 런타임은 이 필드를 읽는다(slim 패턴 검증됨).
 * 교차 타입 PluginHooks로 타입 갭을 안전하게 해소한다.
 */

import type { Hooks, Config, Plugin, PluginModule } from "@opencode-ai/plugin";

// ---------------------------------------------------------------------------
// 에이전트 정의 임포트
// ---------------------------------------------------------------------------
import type { AgentDefinition } from "@opencode/core/types";
import {
  orchestratorAgent,
  intentCheckerAgent,
  workerAgent,
  plannerAgent,
  researchAgent,
  exploreAgent,
  ideatorAgent,
  adversarialReviewAgent,
  constructiveFeedbackAgent,
} from "@opencode/agents";

// 에이전트 정의를 named export로도 노출 (cli에서 import)
export {
  orchestratorAgent,
  intentCheckerAgent,
  workerAgent,
  plannerAgent,
  researchAgent,
  exploreAgent,
  ideatorAgent,
  adversarialReviewAgent,
  constructiveFeedbackAgent,
};

// ---------------------------------------------------------------------------
// 권한 훅 임포트
// ---------------------------------------------------------------------------
import {
  createSessionAgentMap,
  enforcePermission,
  SUBAGENT_NAMES,
  type AgentName,
} from "@opencode/core/permissions";

// ---------------------------------------------------------------------------
// 설정 로더 임포트
// ---------------------------------------------------------------------------
import { loadPluginConfig, applyAgentOverrides } from "@opencode/core/config";
import {
  buildProviderConfig,
  getCatalogSource,
  loadCatalog,
} from "@opencode/core/catalog";

// ---------------------------------------------------------------------------
// 교차 타입 — Hooks에 없는 런타임 필드를 안전하게 확장
// opencode 런타임은 `agent`, `name` 필드를 소비하지만 SDK Hooks에 미선언.
// slim 참조(oh-my-opencode-slim/src/index.ts:454)에서 동일 패턴 검증됨.
// ---------------------------------------------------------------------------
type PluginHooks = Hooks & {
  agent?: Record<string, AgentDefinition>;
  name?: string;
};

type ConfigProviderMap = Record<string, Record<string, unknown>>;

// ---------------------------------------------------------------------------
// 에이전트 레코드 조립
// opencode 런타임이 읽는 형태: Record<agentName, AgentDefinition>
// slim 패턴: agent: agents (getAgentConfigs 반환 레코드와 동일 구조)
// ---------------------------------------------------------------------------
const ALL_AGENTS: AgentDefinition[] = [
  orchestratorAgent,
  intentCheckerAgent,
  workerAgent,
  plannerAgent,
  researchAgent,
  exploreAgent,
  ideatorAgent,
  adversarialReviewAgent,
  constructiveFeedbackAgent,
];

const agentRecord: Record<string, AgentDefinition> = Object.fromEntries(
  ALL_AGENTS.map((a) => [a.name, a]),
);

function loadRuntimeCatalog(
  projectDirectory: string,
): ReturnType<typeof loadCatalog> {
  const source = getCatalogSource(projectDirectory);
  try {
    return loadCatalog(projectDirectory);
  } catch (error) {
    if (source.kind !== "managed") {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[agents] managed catalog load failed. bundled catalog로 fallback합니다. doctor로 진단하세요: ${source.path}: ${message}`,
    );
    return loadCatalog();
  }
}

// ---------------------------------------------------------------------------
// 플러그인 팩토리
// ---------------------------------------------------------------------------
const plugin: Plugin = async (_input, _options): Promise<PluginHooks> => {
  // 세션 → 에이전트 맵 (클로저로 유지; chat.message에서 갱신, event에서 삭제)
  const {
    map: sessionAgentMap,
    updateSessionAgent,
    deleteSession,
  } = createSessionAgentMap();

  // -------------------------------------------------------------------------
  // 설정 로드 및 에이전트 오버라이드 적용
  // _input.directory는 PluginInput의 project directory (index.d.ts:39)
  // 설정 파일이 없으면 {} 반환 → 현재 동작 보존
  // -------------------------------------------------------------------------
  const catalog = loadRuntimeCatalog(_input.directory);
  const pluginConfig = loadPluginConfig(_input.directory, {
    catalog,
    agentRecord,
  });
  const { record: finalAgentRecord, disabledNames } = applyAgentOverrides(
    agentRecord,
    pluginConfig,
    { catalog },
  );
  const enabledSubagentNames = Object.keys(finalAgentRecord).filter(
    (name): name is AgentName =>
      (SUBAGENT_NAMES as readonly string[]).includes(name),
  );

  // -------------------------------------------------------------------------
  // config 훅: default_agent 비파괴적 설정 + 에이전트 설정 병합
  // finalAgentRecord: 오버라이드 적용 + 비활성화 에이전트 제거된 레코드
  // -------------------------------------------------------------------------
  const config = async (opencodeConfig: Config): Promise<void> => {
    const cfg = opencodeConfig as Record<string, unknown>;

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

    // default_agent: 사용자가 이미 설정한 경우 건드리지 않는다 (non-destructive)
    if (!(cfg as { default_agent?: string }).default_agent) {
      (cfg as { default_agent?: string }).default_agent = "orchestrator";
    }

    // 비활성화된 에이전트가 있으면 orchestrator 프롬프트에 알림 추가
    // orchestrator가 존재하고 비활성화된 서브에이전트가 있을 때만 추가
    if (disabledNames.length > 0 && finalAgentRecord["orchestrator"]) {
      const disabledList = disabledNames.join(", ");
      const disabledNote =
        `\n\n## 비활성화된 서브에이전트\n` +
        `다음 서브에이전트는 비활성화되어 있으므로 위임해서는 안 됩니다: ${disabledList}.`;
      finalAgentRecord["orchestrator"] = {
        ...finalAgentRecord["orchestrator"],
        prompt: finalAgentRecord["orchestrator"].prompt + disabledNote,
      };
    }

    // 에이전트 레코드 병합 (slim 패턴):
    //   - opencodeConfig.agent 미설정 → 플러그인 레코드 전체 복사
    //   - opencodeConfig.agent 기설정 → shallow merge (플러그인 기본값 먼저, 사용자 설정 우선)
    if (!cfg.agent) {
      cfg.agent = { ...finalAgentRecord };
    } else {
      for (const [name, pluginAgent] of Object.entries(finalAgentRecord)) {
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
  };

  // -------------------------------------------------------------------------
  // tool.execute.before 훅: 권한 집행
  // 에이전트 이름은 sessionAgentMap에서 조회 (chat.message 훅으로 갱신됨)
  // 거부 시 Error를 throw → opencode가 도구 호출을 차단한다
  // -------------------------------------------------------------------------
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
      { tool: input.tool, sessionID: input.sessionID, args },
      sessionAgentMap,
      {
        subagentNames: enabledSubagentNames,
        workspaceRoot: _input.directory,
      },
    );

    if (!result.allowed) {
      throw new Error(`[agents] 권한 거부 — ${result.reason}`);
    }
  };

  // -------------------------------------------------------------------------
  // chat.message 훅: 세션 → 에이전트 맵 갱신
  // Fix-B: input.agent가 없을 때 output.message.agent로 fallback (slim 패턴)
  // slim 참조: oh-my-opencode-slim/src/index.ts:965-969
  //   const rawAgent = input.agent ?? output?.message?.agent;
  // subagent 세션에서 input.agent가 undefined일 경우 과잉 차단을 방지한다.
  // -------------------------------------------------------------------------
  const chatMessage = async (
    input: { sessionID: string; agent?: string; [key: string]: unknown },
    output?: { message?: { agent?: string } },
  ): Promise<void> => {
    const agent = input.agent ?? output?.message?.agent;
    if (agent) {
      updateSessionAgent(input.sessionID, agent);
    }
  };

  // -------------------------------------------------------------------------
  // event 훅: session.deleted 이벤트에서 세션 맵 정리
  // -------------------------------------------------------------------------
  const event = async (input: {
    event: { type: string; properties?: unknown };
  }): Promise<void> => {
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

  // -------------------------------------------------------------------------
  // 반환: PluginHooks (Hooks 교차 타입, `agent` 포함)
  // Fix-A: `as unknown as Hooks` 제거 — PluginHooks가 agent 필드를 포함하므로
  // 직접 할당 가능 (캐스트 불필요)
  // finalAgentRecord: 오버라이드 적용 + 비활성화 제거된 에이전트 레코드
  // -------------------------------------------------------------------------
  return {
    agent: finalAgentRecord,
    config,
    "tool.execute.before": toolExecuteBefore,
    "chat.message": chatMessage,
    event,
  };
};

const pluginModule = {
  id: "buyong-agents",
  server: plugin,
} satisfies PluginModule;

export default pluginModule;
