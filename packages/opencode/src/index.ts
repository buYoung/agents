/**
 * index.ts — agents 플러그인 엔트리
 *
 * 에이전트 정의를 조립하고, 설정·catalog를 로드한 뒤 훅을 연결한다.
 *
 * 반환 형태:
 *   { agent, config, "tool.execute.before", "chat.message", event }
 *
 * NOTE: @opencode-ai/plugin@1.17.13의 Hooks 인터페이스에는 `agent` 필드가
 * 선언되어 있지 않지만, opencode 런타임은 이 필드를 읽는다(slim 패턴 검증됨).
 * 교차 타입 PluginHooks로 타입 갭을 안전하게 해소한다.
 */

import type { Hooks, Plugin, PluginModule } from "@opencode-ai/plugin";

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

import {
  createSessionAgentMap,
  SUBAGENT_NAMES,
  type AgentName,
} from "@opencode/core/permissions";
import { loadPluginConfig, applyAgentOverrides } from "@opencode/core/config";
import {
  assertAgentModelsInCatalog,
  loadRuntimeCatalog,
} from "@opencode/core/catalog";
import { createPluginHookHandlers } from "./plugin-hooks";

type PluginHooks = Hooks & {
  agent?: Record<string, AgentDefinition>;
  name?: string;
};

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

const plugin: Plugin = async (_input, _options): Promise<PluginHooks> => {
  const sessionAgentMap = createSessionAgentMap();

  const catalog = loadRuntimeCatalog(_input.directory);
  assertAgentModelsInCatalog(agentRecord, catalog);
  const pluginConfig = loadPluginConfig(_input.directory, {
    catalog,
    agentRecord,
  });
  const { record: finalAgentRecord, disabledNames } = applyAgentOverrides(
    agentRecord,
    pluginConfig,
    { catalog },
  );
  assertAgentModelsInCatalog(finalAgentRecord, catalog);
  const enabledSubagentNames = Object.keys(finalAgentRecord).filter(
    (name): name is AgentName =>
      (SUBAGENT_NAMES as readonly string[]).includes(name),
  );

  const hooks = createPluginHookHandlers({
    catalog,
    finalAgentRecord,
    disabledNames,
    enabledSubagentNames,
    workspaceRoot: _input.directory,
    sessionAgentMap,
    pluginConfig,
  });

  return {
    agent: finalAgentRecord,
    ...hooks,
  };
};

const pluginModule = {
  id: "buyong-agents",
  server: plugin,
} satisfies PluginModule;

export default pluginModule;
