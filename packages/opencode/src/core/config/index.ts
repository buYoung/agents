/**
 * config — agents 플러그인 설정 로더
 *
 * TOML 형식의 설정 파일을 읽어 에이전트 오버라이드를 적용한다.
 *
 * 파일 탐색 순서 (우선순위 낮음 → 높음):
 *   1. 사용자 범위: $OPENCODE_CONFIG_DIR, $XDG_CONFIG_HOME/opencode, ~/.config/opencode
 *   2. 프로젝트 범위: <directory>/.opencode/agents.toml
 *
 * 환경 변수 AGENTS_PRESET으로 preset을 강제 지정할 수 있다.
 */

export {
  AGENT_MODELS,
  REASONING_EFFORTS,
  MODEL_REASONING_EFFORTS,
  PROTECTED_AGENT_NAMES,
  isProtectedAgentName,
  AgentOverrideSchema,
  PluginConfigSchema,
  deepMerge,
} from "./schema";
export type {
  ReasoningEffort,
  AgentOverride,
  PluginConfig,
  ApplyAgentOverridesOptions,
  ConfigLoadWarningKind,
  ConfigLoadWarning,
  LoadPluginConfigOptions,
  PluginConfigValidationMessage,
} from "./schema";

export { loadPluginConfig, validatePluginConfig } from "./load";
export { applyAgentOverrides } from "./overrides";
