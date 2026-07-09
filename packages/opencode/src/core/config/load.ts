/**
 * config/load.ts — agents.toml 탐색·로드·검증
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as parseToml } from "smol-toml";
import type { AgentDefinition } from "@opencode/core/types";
import {
  loadCatalog,
  getCatalogModel,
  type Catalog,
} from "@opencode/core/catalog";
import {
  deepMerge,
  isProtectedAgentName,
  PluginConfigSchema,
  type AgentOverride,
  type LoadPluginConfigOptions,
  type PluginConfig,
  type PluginConfigValidationMessage,
} from "./schema";

/**
 * opencode 설정 파일을 탐색할 사용자 디렉터리 목록을 반환한다.
 * 중복 경로는 제거된다.
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

/**
 * 사용자 범위 및 프로젝트 범위에서 agents 설정을 로드하고 병합한다.
 *
 * - 사용자 범위: $OPENCODE_CONFIG_DIR | $XDG_CONFIG_HOME/opencode | ~/.config/opencode
 * - 프로젝트 범위: <directory>/.opencode/agents.toml
 * - 프로젝트 설정이 사용자 설정보다 우선한다 (deepMerge, project wins).
 * - 환경 변수 AGENTS_PRESET으로 preset을 강제 지정할 수 있다.
 * - 설정 파일이 없으면 {} (빈 설정)를 반환하여 현재 동작을 보존한다.
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
