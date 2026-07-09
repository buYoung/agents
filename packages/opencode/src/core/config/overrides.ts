/**
 * config/overrides.ts — 에이전트 레코드에 설정 오버라이드 적용
 */

import type { AgentDefinition } from "@opencode/core/types";
import { getReasoningEffortsByModel } from "@opencode/core/catalog";
import {
  isProtectedAgentName,
  MODEL_REASONING_EFFORTS,
  type ApplyAgentOverridesOptions,
  type PluginConfig,
} from "./schema";

/**
 * 설정의 에이전트 오버라이드를 에이전트 레코드에 적용한다.
 *
 * - enable === false인 비보호 에이전트는 결과 레코드에서 제거된다.
 * - 보호 에이전트(orchestrator, worker)는 enable === false여도 유지된다.
 * - model 오버라이드: agent.model을 교체한다.
 * - reasoning_effort: agent.options.extraBody.reasoning_effort에 주입한다.
 * - prompt_append: agent.prompt 끝에 '\n\n' + 내용을 추가한다.
 */
export function applyAgentOverrides(
  agentRecord: Record<string, AgentDefinition>,
  config: PluginConfig,
  options?: ApplyAgentOverridesOptions,
): { record: Record<string, AgentDefinition>; disabledNames: string[] } {
  const overrides = config.agents ?? {};
  const modelReasoningEfforts = options?.catalog
    ? getReasoningEffortsByModel(options.catalog)
    : MODEL_REASONING_EFFORTS;
  const disabledNames: string[] = [];
  const record: Record<string, AgentDefinition> = {};

  const knownNames = Object.keys(agentRecord);
  for (const overrideKey of Object.keys(overrides)) {
    if (!(overrideKey in agentRecord)) {
      console.warn(
        `[agents] config references unknown agent "${overrideKey}" — ignored. Known agents: ${knownNames.join(", ")}`,
      );
    }
  }

  for (const [name, agent] of Object.entries(agentRecord)) {
    const override = overrides[name];

    if (override?.enable === false && !isProtectedAgentName(name)) {
      disabledNames.push(name);
      continue;
    }

    let updated: AgentDefinition = { ...agent };

    if (override?.model !== undefined) {
      updated = { ...updated, model: override.model };
    }

    if (override?.reasoning_effort !== undefined) {
      const effectiveModel = override.model ?? updated.model;
      const allowedEfforts =
        typeof effectiveModel === "string"
          ? (modelReasoningEfforts[effectiveModel] ?? [])
          : [];
      if (allowedEfforts.length === 0) {
        console.warn(
          `[agents] agent "${name}" model "${effectiveModel}" does not support reasoning_effort — ignoring.`,
        );
      } else if (!allowedEfforts.includes(override.reasoning_effort)) {
        console.warn(
          `[agents] agent "${name}" model "${effectiveModel}" does not allow reasoning_effort "${override.reasoning_effort}" — allowed: ${allowedEfforts.join("|")} — ignoring.`,
        );
      } else {
        const existingOptions = updated.options ?? {};
        const existingExtraBody =
          typeof existingOptions["extraBody"] === "object" &&
          existingOptions["extraBody"] !== null
            ? (existingOptions["extraBody"] as Record<string, unknown>)
            : {};
        updated = {
          ...updated,
          options: {
            ...existingOptions,
            extraBody: {
              ...existingExtraBody,
              reasoning_effort: override.reasoning_effort,
            },
          },
        };
      }
    }

    if (override?.prompt_append !== undefined) {
      updated = {
        ...updated,
        prompt: updated.prompt + "\n\n" + override.prompt_append,
      };
    }

    record[name] = updated;
  }

  return { record, disabledNames };
}
