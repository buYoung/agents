/**
 * permissions — agents plugin 레이어 권한 정책 모듈
 *
 * 설계 원칙:
 * - 단일 PERMISSION_POLICY 테이블: 에이전트 한 줄 수정으로 권한 조정 가능.
 * - 기본(baseline): 정규 `.agents/orchestration/<taskId>/<workItemId>/<role-file>.md`
 *   읽기와 해당 역할 소유 파일 쓰기만 허용.
 * - 각 에이전트는 베이스라인 위에 추가 델타(delta)를 가진다.
 * - sessionID → 에이전트명 매핑은 chat.message 훅으로 유지 (tool.execute.before 입력에 에이전트명 없음).
 * - Fail-safe: 에이전트 미확인 시 변경 도구(edit/write/bash/task) 거부, 읽기 허용.
 */

export type {
  AgentName,
  SourceReadPolicy,
  TaskPolicy,
  BinaryPolicy,
  BashPolicy,
  PathBoundaryPolicy,
  ToolPermissionPolicy,
  PathPermissionPolicy,
  PermissionPolicy,
} from "./policy";
export {
  AGENT_NAMES,
  SUBAGENT_NAMES,
  PERMISSION_POLICY,
  POLICY_MAP,
} from "./policy";

export type { PathCategory } from "./path";
export { classifyPath } from "./path";

export type {
  SessionExecutionState,
  TaskWorkItemReservation,
  DelegationRegistration,
  DelegationCompletion,
} from "./session-map";
export { createSessionAgentMap, resolveAgent } from "./session-map";

export type { ExecutionAssignment, ExecutionContext } from "./assignment";
export {
  getAgentExecutionContext,
  getAgentExecutionAssignment,
  getTaskExecutionContext,
  getTaskExecutionAssignment,
  isSameExecutionAssignment,
  executionAssignmentKey,
  taskWorkItemKey,
} from "./assignment";

export type {
  EnforcementResult,
  EnforcePermissionOptions,
} from "./enforce";
export { enforcePermission } from "./enforce";

export type {
  ConfiguredMcpServerPolicy,
  ConfiguredMcpPolicy,
  ConfiguredMcpToolMatch,
} from "./mcp-policy";
export {
  sanitizeMcpServerKey,
  compileConfiguredMcpPolicy,
  matchConfiguredMcpTool,
  isConfiguredMcpAllowed,
  applyConfiguredMcpNativePolicy,
} from "./mcp-policy";
