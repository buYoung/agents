/**
 * config/schema.ts — 설정 스키마·상수·병합 유틸
 */

import { z } from "zod";
import type { AgentDefinition } from "@opencode/core/types";
import type { AgentName } from "@opencode/core/doc-protocol";
import {
  getCatalogModelIds,
  getReasoningEfforts,
  getReasoningEffortsByModel,
  type Catalog,
} from "@opencode/core/catalog";

/** 공급자가 지원하는 모델 ID 목록. catalog.toml에서 파생된다. */
export const AGENT_MODELS = getCatalogModelIds();

/** reasoning_effort 전체 허용 값(모든 모델의 합집합). catalog.toml에서 파생된다. */
export const REASONING_EFFORTS = getReasoningEfforts();

/** 모델별 reasoning_effort 허용 값. catalog.toml에서 파생된다. */
export const MODEL_REASONING_EFFORTS: Readonly<
  Record<string, readonly string[]>
> = getReasoningEffortsByModel();

/** 런타임이 항상 필요로 하므로 disable 오버라이드를 무시하는 에이전트 목록. */
export const PROTECTED_AGENT_NAMES: readonly AgentName[] = [
  "orchestrator",
  "worker",
] as const;

export function isProtectedAgentName(
  agentName: string,
): agentName is AgentName {
  return (PROTECTED_AGENT_NAMES as readonly string[]).includes(agentName);
}

/** reasoning_effort 단일 값 타입(모든 모델의 합집합). */
export type ReasoningEffort = string;

/**
 * 에이전트 오버라이드 스키마.
 * strict()로 알 수 없는 필드를 거부해 오타를 즉시 감지한다.
 */
export const AgentOverrideSchema = z
  .object({
    model: z.string().optional(),
    reasoning_effort: z.string().optional(),
    prompt_append: z.string().optional(),
    enable: z.boolean().optional(),
  })
  .strict();

/**
 * 플러그인 전체 설정 스키마.
 * - preset: 적용할 preset 이름 (presets 섹션에 정의)
 * - agents: 에이전트별 오버라이드 맵
 * - presets: 여러 오버라이드 셋을 이름으로 묶은 맵
 */
export const PluginConfigSchema = z.object({
  preset: z.string().optional(),
  agents: z.record(z.string(), AgentOverrideSchema).optional(),
  presets: z
    .record(z.string(), z.record(z.string(), AgentOverrideSchema))
    .optional(),
});

export type AgentOverride = z.infer<typeof AgentOverrideSchema>;
export type PluginConfig = z.infer<typeof PluginConfigSchema>;

export interface ApplyAgentOverridesOptions {
  /** reasoning_effort 모델별 허용 값 검증에 사용할 catalog. */
  catalog?: Catalog;
}

export type ConfigLoadWarningKind =
  | "invalid-toml"
  | "invalid-schema"
  | "invalid-model"
  | "invalid-reasoning-effort"
  | "protected-agent-disabled"
  | "deprecated-model"
  | "read-error"
  | "missing-preset";

export interface ConfigLoadWarning {
  filePath: string;
  kind: ConfigLoadWarningKind;
  message: string;
  formatted?: unknown;
}

export interface LoadPluginConfigOptions {
  /** 설정 로딩 중 비치명적 경고가 발생할 때 호출된다. */
  onWarning?: (warning: ConfigLoadWarning) => void;
  /** console.warn을 억제한다 (onWarning은 계속 호출됨). */
  silent?: boolean;
  /** catalog membership 검증에 사용할 catalog. */
  catalog?: Catalog;
  /** reasoning_effort 검증 시 기본 모델을 확인할 에이전트 레코드. */
  agentRecord?: Record<string, AgentDefinition>;
}

export interface PluginConfigValidationMessage {
  kind:
    | "invalid-model"
    | "invalid-reasoning-effort"
    | "protected-agent-disabled"
    | "deprecated-model";
  path: string;
  message: string;
}

/**
 * 두 객체를 재귀적으로 병합한다. override 값이 우선한다.
 * 배열·원시값은 override가 base를 완전히 대체한다.
 */
export function deepMerge<T extends Record<string, unknown>>(
  base?: T,
  override?: T,
): T | undefined {
  if (!base) return override;
  if (!override) return base;

  const result = { ...base } as T;
  for (const key of Object.keys(override) as (keyof T)[]) {
    const baseVal = base[key];
    const overrideVal = override[key];

    if (
      typeof baseVal === "object" &&
      baseVal !== null &&
      typeof overrideVal === "object" &&
      overrideVal !== null &&
      !Array.isArray(baseVal) &&
      !Array.isArray(overrideVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>,
      ) as T[keyof T];
    } else {
      result[key] = overrideVal;
    }
  }
  return result;
}
