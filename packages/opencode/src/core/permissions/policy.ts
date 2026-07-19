/**
 * permissions/policy.ts — 에이전트별 권한 표(데이터)와 정책 타입
 */

// AgentName SSOT: doc-protocol.ts에서 import한다 (중복 선언 금지).
// 기존 소비자가 permissions에서 AgentName을 import해도 계속 동작하도록 re-export한다.
export type { AgentName } from "../doc-protocol";
export { AGENT_NAMES } from "../doc-protocol";
import type { AgentName } from "@opencode/core/doc-protocol";
import { AGENT_NAMES as AGENT_NAMES_IMPL } from "@opencode/core/doc-protocol";

/** 에이전트별 source 읽기 정책 */
export type SourceReadPolicy = "allow" | "deny" | "docs-only";

/** task 위임 정책 */
export type TaskPolicy = "allow" | "deny" | "to-subagents";

/** 단순 이진 허용/거부 정책 */
export type BinaryPolicy = "allow" | "deny";

/** bash 실행 정책 */
export type BashPolicy = BinaryPolicy | "read-only";

/** 경로 접근 경계 정책 */
export type PathBoundaryPolicy = "any" | "workspace-or-temp";

export interface ToolPermissionPolicy {
  /** source 파일 읽기 — allow | deny | docs-only(docs/** 만 허용) */
  sourceRead: SourceReadPolicy;
  /** bash 실행 — allow | deny | read-only */
  bash: BashPolicy;
  /** source 파일 편집/쓰기 — allow | deny */
  sourceEdit: BinaryPolicy;
  /** webfetch 사용 — allow | deny */
  webfetch: BinaryPolicy;
  /**
   * task 위임 — allow | deny | to-subagents
   * to-subagents: orchestrator 전용, 서브에이전트에게만 위임 허용
   */
  task: TaskPolicy;
}

export interface PathPermissionPolicy {
  /** 읽기 도구 대상 경계 */
  sourceRead: PathBoundaryPolicy;
  /** 편집/쓰기 도구 대상 경계 */
  sourceEdit: PathBoundaryPolicy;
  /** bash workdir/명령 인자 경계 */
  bash: PathBoundaryPolicy;
}

/**
 * 에이전트 한 행(row)의 권한 정책.
 * 베이스라인(.agents/orchestration/** 읽기+쓰기) 위에 적용되는 델타.
 */
export interface PermissionPolicy {
  /** 에이전트 이름 */
  agent: AgentName;
  /** 도구별 권한 */
  tools: ToolPermissionPolicy;
  /** 경로 기반 도구/명령 경계 */
  paths: PathPermissionPolicy;
}

/** orchestrator가 위임할 수 있는 서브에이전트 목록 */
export const SUBAGENT_NAMES: readonly AgentName[] = AGENT_NAMES_IMPL.filter(
  (name): name is AgentName => name !== "orchestrator",
);

/**
 * 전체 에이전트 권한 정책 테이블.
 * 권한 변경은 이 테이블만 수정한다.
 *
 * 베이스라인 (모든 에이전트 공통):
 *   - 정규 `.agents/orchestration/<taskId>/<workItemId>/<role-file>.md` 읽기와 역할 소유
 *     파일 쓰기는 enforcement baseline에서 처리 (여기서는 delta만 인코딩)
 */
export const PERMISSION_POLICY: readonly PermissionPolicy[] = [
  {
    agent: "orchestrator",
    tools: {
      sourceRead: "docs-only", // docs/** 와 briefs/** 에 한정
      bash: "read-only",
      sourceEdit: "deny",
      webfetch: "deny",
      task: "to-subagents", // 8개 서브에이전트에게만 위임 가능
    },
    paths: { sourceRead: "any", sourceEdit: "any", bash: "any" },
  },
  {
    agent: "intent-checker",
    tools: {
      sourceRead: "deny", // 게이트 에이전트 — 읽기 불필요 (오케스트레이터가 텍스트로 넘겨줌)
      bash: "deny",
      sourceEdit: "deny",
      webfetch: "deny",
      task: "deny", // 재위임 금지
    },
    paths: { sourceRead: "any", sourceEdit: "any", bash: "any" },
  },
  {
    agent: "worker",
    tools: {
      sourceRead: "allow",
      bash: "allow",
      sourceEdit: "allow",
      webfetch: "allow",
      task: "deny", // 재위임 금지
    },
    paths: {
      sourceRead: "workspace-or-temp",
      sourceEdit: "workspace-or-temp",
      // worker는 구현·빌드·검증을 수행하는 신뢰 실행 역할이다. bash를
      // 읽기 명령 분류기로 다시 좁히지 않고, 위험한 외부 효과는 worker의
      // 사용자 확인 계약과 OpenCode 실행 환경이 맡는다.
      bash: "any",
    },
  },
  {
    agent: "planner",
    tools: {
      sourceRead: "allow",
      bash: "read-only",
      sourceEdit: "deny",
      webfetch: "deny",
      task: "deny",
    },
    paths: { sourceRead: "any", sourceEdit: "any", bash: "any" },
  },
  {
    agent: "research",
    tools: {
      sourceRead: "allow",
      bash: "allow",
      sourceEdit: "deny",
      webfetch: "allow",
      task: "deny",
    },
    paths: { sourceRead: "any", sourceEdit: "any", bash: "any" },
  },
  {
    agent: "code-explorer",
    tools: {
      sourceRead: "allow",
      bash: "deny",
      sourceEdit: "deny",
      webfetch: "deny",
      task: "deny",
    },
    paths: { sourceRead: "any", sourceEdit: "any", bash: "any" },
  },
  {
    agent: "idea-generator",
    tools: {
      sourceRead: "allow",
      bash: "deny",
      sourceEdit: "deny",
      webfetch: "deny",
      task: "deny",
    },
    paths: { sourceRead: "any", sourceEdit: "any", bash: "any" },
  },
  {
    agent: "adversarial-review",
    tools: {
      sourceRead: "allow",
      bash: "read-only",
      sourceEdit: "deny",
      webfetch: "deny",
      task: "deny",
    },
    paths: { sourceRead: "any", sourceEdit: "any", bash: "any" },
  },
  {
    agent: "constructive-feedback",
    tools: {
      sourceRead: "allow",
      bash: "read-only",
      sourceEdit: "deny",
      webfetch: "deny",
      task: "deny",
    },
    paths: { sourceRead: "any", sourceEdit: "any", bash: "any" },
  },
] as const;

/** 빠른 조회를 위한 Map (초기화 시 1회 빌드) */
export const POLICY_MAP = new Map<AgentName, PermissionPolicy>(
  PERMISSION_POLICY.map((policy) => [policy.agent, policy]),
);
