/**
 * types.ts — agents plugin 에이전트 공유 타입
 *
 * AgentDefinition: opencode 플러그인에서 에이전트를 나타내는 plain object 타입.
 *
 * 이 파일에는 권한 선언을 추가하지 않는다 — permissions.ts가 소유한다.
 */

/**
 * opencode 플러그인 에이전트 정의 객체.
 *
 * - `name`    : 에이전트 식별자 (permissions.ts의 AgentName과 일치해야 함)
 * - `mode`    : "primary" = 직접 호출 가능한 주 에이전트,
 *               "all"     = 모든 컨텍스트에서 호출 가능 (서브에이전트 포함),
 *               "subagent"= task 위임으로만 실행
 * - `model`   : "ollama-cloud/<model-id>" 형식의 모델 식별자 (생략 시 전역 기본값 사용)
 * - `prompt`  : 에이전트에게 전달되는 시스템 프롬프트 전문
 * - `options` : 프로바이더 전용 모델 옵션 (예: extraBody.reasoning_effort).
 *               config.ts의 applyAgentOverrides가 reasoning_effort를
 *               { extraBody: { reasoning_effort } } 형태로 여기에 주입한다.
 */
export interface AgentDefinition {
  name: string;
  description?: string;
  mode: "primary" | "all" | "subagent";
  model?: string;
  prompt: string;
  options?: Record<string, unknown>;
}
