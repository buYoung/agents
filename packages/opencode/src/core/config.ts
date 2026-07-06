/**
 * config.ts — agents 플러그인 설정 로더
 *
 * TOML 형식의 설정 파일을 읽어 에이전트 오버라이드를 적용한다.
 *
 * 파일 탐색 순서 (우선순위 낮음 → 높음):
 *   1. 사용자 범위: $OPENCODE_CONFIG_DIR, $XDG_CONFIG_HOME/opencode, ~/.config/opencode
 *   2. 프로젝트 범위: <directory>/.opencode/agents.toml
 *
 * 환경 변수 AGENTS_PRESET으로 preset을 강제 지정할 수 있다.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import type { AgentDefinition } from "@opencode/core/types";
import type { AgentName } from "@opencode/core/doc-protocol";
import {
  loadCatalog,
  getCatalogModel,
  getCatalogModelIds,
  getReasoningEfforts,
  getReasoningEffortsByModel,
  type Catalog,
} from "@opencode/core/catalog";

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

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

function isProtectedAgentName(agentName: string): agentName is AgentName {
  return (PROTECTED_AGENT_NAMES as readonly string[]).includes(agentName);
}

// ---------------------------------------------------------------------------
// Zod 스키마
// ---------------------------------------------------------------------------

/** reasoning_effort 단일 값 타입(모든 모델의 합집합). */
export type ReasoningEffort = string;

/**
 * 에이전트 오버라이드 스키마.
 * strict()로 알 수 없는 필드를 거부해 오타를 즉시 감지한다.
 * model은 catalog membership으로 검증한다.
 * reasoning_effort는 catalog 합집합으로 검증 후 applyAgentOverrides에서
 * 모델별 허용 값을 추가 검사한다.
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

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

export type AgentOverride = z.infer<typeof AgentOverrideSchema>;
export type PluginConfig = z.infer<typeof PluginConfigSchema>;

export interface ApplyAgentOverridesOptions {
  /** reasoning_effort 모델별 허용 값 검증에 사용할 catalog. */
  catalog?: Catalog;
}

// ---------------------------------------------------------------------------
// 경고 타입
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// deepMerge — slim 패턴 복제
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 사용자 설정 디렉터리 탐색 (slim의 getConfigSearchDirs 복제)
// ---------------------------------------------------------------------------

/**
 * opencode 설정 파일을 탐색할 사용자 디렉터리 목록을 반환한다.
 * 중복 경로는 제거된다.
 *
 * 탐색 순서:
 *   1. $OPENCODE_CONFIG_DIR (설정된 경우)
 *   2. $XDG_CONFIG_HOME/opencode or ~/.config/opencode
 */
function getUserConfigSearchDirs(): string[] {
  const customDir = process.env["OPENCODE_CONFIG_DIR"]?.trim() || undefined;
  const xdgBase = process.env["XDG_CONFIG_HOME"]
    ? process.env["XDG_CONFIG_HOME"]
    : path.join(os.homedir(), ".config");
  const defaultDir = path.join(xdgBase, "opencode");

  const dirs = [customDir, defaultDir];
  return dirs.filter((dir, index): dir is string => {
    return Boolean(dir) && dirs.indexOf(dir) === index;
  });
}

// ---------------------------------------------------------------------------
// 단일 파일 로드
// ---------------------------------------------------------------------------

/**
 * TOML 파일을 읽어 파싱한다.
 * 파일이 없으면 null, 파싱/검증 실패 시 null (경고 발생).
 */
function loadConfigFromPath(
  filePath: string,
  options?: LoadPluginConfigOptions,
): PluginConfig | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    let rawConfig: unknown;

    try {
      rawConfig = parseToml(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options?.onWarning?.({
        filePath,
        kind: "invalid-toml",
        message,
      });
      if (!options?.silent) {
        console.warn(`[agents] TOML 파싱 오류 ${filePath}:`, message);
      }
      return null;
    }

    const result = PluginConfigSchema.safeParse(rawConfig);
    if (!result.success) {
      options?.onWarning?.({
        filePath,
        kind: "invalid-schema",
        message: "설정이 스키마와 일치하지 않습니다",
        formatted: result.error.format(),
      });
      if (!options?.silent) {
        console.warn(`[agents] 잘못된 설정 ${filePath}:`);
        console.warn(result.error.format());
      }
      return null;
    }

    const validationMessages = validatePluginConfig(
      result.data,
      options?.catalog,
      options?.agentRecord,
    );
    const invalidMessages = validationMessages.filter((message) =>
      ["invalid-model", "protected-agent-disabled"].includes(message.kind),
    );
    for (const validationMessage of validationMessages) {
      options?.onWarning?.({
        filePath,
        kind: validationMessage.kind,
        message: validationMessage.message,
      });
      if (!options?.silent) {
        console.warn(`[agents] ${validationMessage.message}`);
      }
    }
    if (invalidMessages.length > 0) {
      return null;
    }

    return result.data;
  } catch (error) {
    // ENOENT는 정상 (파일 없음) — 그 외 읽기 오류만 경고
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      options?.onWarning?.({
        filePath,
        kind: "read-error",
        message: error.message,
      });
      if (!options?.silent) {
        console.warn(
          `[agents] 설정 파일 읽기 오류 ${filePath}:`,
          error.message,
        );
      }
    }
    return null;
  }
}

/**
 * basePath (확장자 없음)에서 .toml 파일을 탐색한다.
 * 발견된 첫 번째 파일 경로를 반환하고, 없으면 null.
 */
function findConfigPath(basePath: string): string | null {
  const candidate = `${basePath}.toml`;
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * 주어진 디렉터리 목록에서 baseName으로 설정 파일을 탐색한다.
 * 첫 번째로 발견된 파일 경로를 반환.
 */
function findConfigPathInDirs(dirs: string[], baseName: string): string | null {
  for (const dir of dirs) {
    const found = findConfigPath(path.join(dir, baseName));
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * 사용자 범위 및 프로젝트 범위에서 agents 설정을 로드하고 병합한다.
 *
 * - 사용자 범위: $OPENCODE_CONFIG_DIR | $XDG_CONFIG_HOME/opencode | ~/.config/opencode
 * - 프로젝트 범위: <directory>/.opencode/agents.toml
 * - 프로젝트 설정이 사용자 설정보다 우선한다 (deepMerge, project wins).
 * - 환경 변수 AGENTS_PRESET으로 preset을 강제 지정할 수 있다.
 * - 설정 파일이 없으면 {} (빈 설정)를 반환하여 현재 동작을 보존한다.
 *
 * @param directory - 플러그인 입력의 project directory
 * @param options   - 경고 콜백 및 silent 옵션
 */
export function loadPluginConfig(
  directory: string,
  options?: LoadPluginConfigOptions,
): PluginConfig {
  // 상대경로를 절대경로로 정규화 (이미 절대경로면 no-op)
  directory = path.resolve(directory);
  const catalog = options?.catalog ?? loadCatalog(directory);
  const loadOptions = { ...options, catalog };

  // 사용자 범위 설정
  const userConfigPath = findConfigPathInDirs(
    getUserConfigSearchDirs(),
    "agents",
  );

  let config: PluginConfig = userConfigPath
    ? (loadConfigFromPath(userConfigPath, loadOptions) ?? {})
    : {};

  // 프로젝트 범위 설정
  const projectBasePath = path.join(directory, ".opencode", "agents");
  const projectConfigPath = findConfigPath(projectBasePath);

  if (projectConfigPath) {
    const projectConfig = loadConfigFromPath(projectConfigPath, loadOptions);
    if (projectConfig) {
      config = {
        ...config,
        ...projectConfig,
        agents: deepMerge(
          config.agents as Record<string, unknown> | undefined,
          projectConfig.agents as Record<string, unknown> | undefined,
        ) as PluginConfig["agents"],
        presets: deepMerge(
          config.presets as Record<string, unknown> | undefined,
          projectConfig.presets as Record<string, unknown> | undefined,
        ) as PluginConfig["presets"],
      };
    }
  }

  // 환경 변수 preset 강제 지정
  const envPreset = process.env["AGENTS_PRESET"];
  if (envPreset) {
    config = { ...config, preset: envPreset };
  }

  // Preset 해소: preset.agents를 root.agents에 deepMerge (root 우선)
  if (config.preset) {
    const presetAgents = config.presets?.[config.preset];
    if (presetAgents) {
      config = {
        ...config,
        agents: deepMerge(
          presetAgents as Record<string, unknown>,
          config.agents as Record<string, unknown> | undefined,
        ) as PluginConfig["agents"],
      };
    } else {
      const available = config.presets
        ? Object.keys(config.presets).join(", ")
        : "없음";
      const message = `preset "${config.preset}"을 찾을 수 없습니다. 사용 가능: ${available}`;
      options?.onWarning?.({
        filePath: projectConfigPath ?? userConfigPath ?? "",
        kind: "missing-preset",
        message,
      });
      if (!options?.silent) {
        console.warn(`[agents] ${message}`);
      }
    }
  }

  return config;
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

export function validatePluginConfig(
  config: PluginConfig,
  catalog: Catalog = loadCatalog(),
  agentRecord: Record<string, AgentDefinition> = {},
): PluginConfigValidationMessage[] {
  const messages: PluginConfigValidationMessage[] = [];
  const validateOverride = (
    configPath: string,
    override: AgentOverride,
  ): void => {
    const agentName = configPath.split(".").at(-1) ?? "";
    const effectiveModelId = override.model ?? agentRecord[agentName]?.model;

    if (override.enable === false && isProtectedAgentName(agentName)) {
      messages.push({
        kind: "protected-agent-disabled",
        path: `${configPath}.enable`,
        message: `${configPath}.enable=false는 허용되지 않습니다. ${agentName} 에이전트는 필수 런타임 에이전트입니다.`,
      });
    }

    if (override.model) {
      const model = getCatalogModel(override.model, catalog);
      if (!model) {
        messages.push({
          kind: "invalid-model",
          path: `${configPath}.model`,
          message: `${configPath}.model "${override.model}"은 catalog에 없는 model id입니다.`,
        });
        return;
      }
      if (model.status === "deprecated") {
        messages.push({
          kind: "deprecated-model",
          path: `${configPath}.model`,
          message: model.replacement
            ? `${configPath}.model "${override.model}"은 deprecated입니다. catalog replacement: ${model.replacement}`
            : `${configPath}.model "${override.model}"은 deprecated입니다.`,
        });
      }
    }

    if (!override.reasoning_effort || !effectiveModelId) return;
    const model = effectiveModelId
      ? getCatalogModel(effectiveModelId, catalog)
      : undefined;
    if (!model || model.reasoning_efforts.length === 0) {
      messages.push({
        kind: "invalid-reasoning-effort",
        path: `${configPath}.reasoning_effort`,
        message: `${configPath}.reasoning_effort "${override.reasoning_effort}"은 model "${effectiveModelId ?? "unknown"}"에서 지원되지 않습니다.`,
      });
      return;
    }
    if (!model.reasoning_efforts.includes(override.reasoning_effort)) {
      messages.push({
        kind: "invalid-reasoning-effort",
        path: `${configPath}.reasoning_effort`,
        message: `${configPath}.reasoning_effort "${override.reasoning_effort}"은 model "${model.id}"에서 허용되지 않습니다. 허용값: ${model.reasoning_efforts.join("|")}`,
      });
    }
  };

  for (const [agentName, override] of Object.entries(config.agents ?? {})) {
    validateOverride(`agents.${agentName}`, override);
  }
  for (const [presetName, presetAgents] of Object.entries(
    config.presets ?? {},
  )) {
    for (const [agentName, override] of Object.entries(presetAgents)) {
      validateOverride(`presets.${presetName}.${agentName}`, override);
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// 에이전트 오버라이드 적용
// ---------------------------------------------------------------------------

/**
 * 설정의 에이전트 오버라이드를 에이전트 레코드에 적용한다.
 *
 * - enable === false인 비보호 에이전트는 결과 레코드에서 제거된다.
 * - 보호 에이전트(orchestrator, worker)는 enable === false여도 유지된다.
 * - model 오버라이드: agent.model을 교체한다.
 * - reasoning_effort: agent.options.extraBody.reasoning_effort에 주입한다.
 * - prompt_append: agent.prompt 끝에 '\n\n' + 내용을 추가한다.
 *
 * @param agentRecord - 원본 에이전트 레코드 (수정하지 않음)
 * @param config      - loadPluginConfig가 반환한 설정
 * @returns { record: 오버라이드 적용된 새 레코드, disabledNames: 비활성화된 에이전트 이름 배열 }
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

  // 알 수 없는 에이전트 이름 경고: agentRecord에 없는 키는 오타일 가능성이 높다.
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

    // enable === false → 비보호 에이전트만 비활성화
    if (override?.enable === false && !isProtectedAgentName(name)) {
      disabledNames.push(name);
      continue;
    }

    // 오버라이드 적용
    let updated: AgentDefinition = { ...agent };

    if (override?.model !== undefined) {
      updated = { ...updated, model: override.model };
    }

    if (override?.reasoning_effort !== undefined) {
      // 적용 대상 모델이 reasoning_effort를 지원하는지, 허용 값인지 확인한다.
      // override.model이 있으면 그 모델, 없으면 에이전트 기본 model.
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
