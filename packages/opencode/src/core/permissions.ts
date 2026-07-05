/**
 * permissions.ts — agents plugin 레이어 권한 정책 모듈
 *
 * 설계 원칙:
 * - 단일 PERMISSION_POLICY 테이블: 에이전트 한 줄 수정으로 권한 조정 가능.
 * - 기본(baseline): 모든 에이전트에게 `.agents/<taskId>/**` 읽기+쓰기 허용.
 * - 각 에이전트는 베이스라인 위에 추가 델타(delta)를 가진다.
 * - sessionID → 에이전트명 매핑은 chat.message 훅으로 유지 (tool.execute.before 입력에 에이전트명 없음).
 * - Fail-safe: 에이전트 미확인 시 변경 도구(edit/write/bash/task) 거부, 읽기 허용.
 */

// ---------------------------------------------------------------------------
// 타입 정의
// ---------------------------------------------------------------------------

// AgentName SSOT: doc-protocol.ts에서 import한다 (중복 선언 금지).
// 기존 소비자가 permissions.ts에서 AgentName을 import해도 계속 동작하도록 re-export한다.
export type { AgentName } from "./doc-protocol";
// AGENT_NAMES도 doc-protocol.ts가 SSOT이므로 re-export (중복 선언 금지).
export { AGENT_NAMES } from "./doc-protocol";
import type { AgentName } from "@opencode/core/doc-protocol";
import { AGENT_NAMES as AGENT_NAMES_IMPL } from "@opencode/core/doc-protocol";

/** 에이전트별 source 읽기 정책 */
export type SourceReadPolicy = "allow" | "deny" | "docs-only";

/** task 위임 정책 */
export type TaskPolicy = "allow" | "deny" | "to-subagents";

/** 단순 이진 허용/거부 정책 */
export type BinaryPolicy = "allow" | "deny";

/**
 * 에이전트 한 행(row)의 권한 정책.
 * 베이스라인(.agents/** 읽기+쓰기) 위에 적용되는 델타.
 */
export interface PermissionPolicy {
  /** 에이전트 이름 */
  agent: AgentName;
  /** source 파일 읽기 — allow | deny | docs-only(docs/** 만 허용) */
  sourceRead: SourceReadPolicy;
  /** bash 실행 — allow | deny */
  bash: BinaryPolicy;
  /** source 파일 편집/쓰기 — allow | deny */
  sourceEdit: BinaryPolicy;
  /** webfetch 사용 — allow | deny */
  webfetch: BinaryPolicy;
  /**
   * task 위임 — allow | deny | to-subagents
   * to-subagents: orchestrator 전용, 7개 서브에이전트에게만 위임 허용
   */
  task: TaskPolicy;
}

// ---------------------------------------------------------------------------
// 에이전트 목록 상수
// ---------------------------------------------------------------------------

// AGENT_NAMES는 doc-protocol.ts에서 re-export한다 (위에서 export).
// 여기서는 구현체(AGENT_NAMES_IMPL)를 SUBAGENT_NAMES 도출에만 사용한다.

/** orchestrator가 위임할 수 있는 서브에이전트 목록 */
export const SUBAGENT_NAMES: readonly AgentName[] = AGENT_NAMES_IMPL.filter(
  (name): name is AgentName => name !== "orchestrator",
);

// ---------------------------------------------------------------------------
// 권한 정책 테이블 (단일 진실 원천)
// ---------------------------------------------------------------------------

/**
 * 전체 9개 에이전트 권한 정책 테이블.
 * 권한 변경은 이 테이블만 수정한다.
 *
 * 베이스라인 (모든 에이전트 공통):
 *   - `.agents/<taskId>/**` 읽기+쓰기: 항상 허용 (여기서는 delta만 인코딩)
 */
export const PERMISSION_POLICY: readonly PermissionPolicy[] = [
  {
    agent: "orchestrator",
    sourceRead: "docs-only", // docs/** 와 briefs/** 에 한정
    bash: "deny",
    sourceEdit: "deny",
    webfetch: "deny",
    task: "to-subagents", // 8개 서브에이전트에게만 위임 가능
  },
  {
    agent: "intent-checker",
    sourceRead: "deny", // 게이트 에이전트 — 읽기 불필요 (오케스트레이터가 텍스트로 넘겨줌)
    bash: "deny",
    sourceEdit: "deny",
    webfetch: "deny",
    task: "deny", // 재위임 금지
  },
  {
    agent: "worker",
    sourceRead: "allow",
    bash: "allow",
    sourceEdit: "allow",
    webfetch: "allow",
    task: "deny", // 재위임 금지
  },
  {
    agent: "planner",
    sourceRead: "allow",
    bash: "allow", // 검증(verify) 목적
    sourceEdit: "deny",
    webfetch: "deny",
    task: "deny",
  },
  {
    agent: "research",
    sourceRead: "allow",
    bash: "allow",
    sourceEdit: "deny",
    webfetch: "allow",
    task: "deny",
  },
  {
    agent: "explore",
    sourceRead: "allow",
    bash: "deny",
    sourceEdit: "deny",
    webfetch: "deny",
    task: "deny",
  },
  {
    agent: "ideator",
    sourceRead: "allow",
    bash: "deny",
    sourceEdit: "deny",
    webfetch: "deny",
    task: "deny",
  },
  {
    agent: "adversarial-review",
    sourceRead: "allow",
    bash: "allow", // 검증(verify) 목적
    sourceEdit: "deny",
    webfetch: "deny",
    task: "deny",
  },
  {
    agent: "constructive-feedback",
    sourceRead: "allow",
    bash: "allow", // 검증(verify) 목적
    sourceEdit: "deny",
    webfetch: "deny",
    task: "deny",
  },
] as const;

// 빠른 조회를 위한 Map (초기화 시 1회 빌드)
const POLICY_MAP = new Map<AgentName, PermissionPolicy>(
  PERMISSION_POLICY.map((policy) => [policy.agent, policy]),
);

// ---------------------------------------------------------------------------
// 경로 분류기
// ---------------------------------------------------------------------------

/** 경로 분류 결과 */
export type PathCategory = "agents" | "docs" | "source";

/**
 * 대상 경로를 세 가지 카테고리로 분류한다.
 *
 * - "agents"  : `.agents/`로 시작하는 경로 (태스크 런 디렉터리)
 * - "docs"    : `docs/`로 시작하는 경로 (briefs 포함)
 * - "source"  : 그 외 모든 경로 (소스 코드, 설정 파일 등)
 *
 * @param targetPath - 분류할 경로 (절대 또는 상대 경로 모두 허용)
 * @returns PathCategory
 *
 * @example
 * classifyPath('.agents/2026-07-01/coder.md') // → "agents"
 * classifyPath('docs/briefs/my-brief.md')     // → "docs"
 * classifyPath('src/index.ts')                // → "source"
 */
export function classifyPath(targetPath: string): PathCategory {
  // 절대 경로에서 상대 경로 부분만 추출 (선행 슬래시/드라이브 제거)
  const normalized = targetPath.replace(/^[/\\]+/, "").replace(/\\/g, "/");

  if (normalized.startsWith(".agents/") || normalized === ".agents") {
    return "agents";
  }

  if (normalized.startsWith("docs/") || normalized === "docs") {
    return "docs";
  }

  return "source";
}

// ---------------------------------------------------------------------------
// 세션 → 에이전트 맵 관리
// ---------------------------------------------------------------------------

/**
 * 세션→에이전트 맵과 업데이트 함수를 함께 반환한다.
 * chat.message 훅에서 `updateSessionAgent`를 호출해 맵을 유지하고,
 * tool.execute.before 훅에서 `resolveAgent`로 호출자를 조회한다.
 */
export function createSessionAgentMap(): {
  map: Map<string, AgentName>;
  updateSessionAgent: (sessionID: string, agent: string | undefined) => void;
  deleteSession: (sessionID: string) => void;
} {
  const map = new Map<string, AgentName>();

  function updateSessionAgent(
    sessionID: string,
    agent: string | undefined,
  ): void {
    if (!agent) return;
    // 알려진 에이전트 이름인지 검증 후 저장
    if ((AGENT_NAMES_IMPL as readonly string[]).includes(agent)) {
      map.set(sessionID, agent as AgentName);
    }
  }

  function deleteSession(sessionID: string): void {
    map.delete(sessionID);
  }

  return { map, updateSessionAgent, deleteSession };
}

/**
 * 세션 ID로 에이전트 이름을 조회한다.
 *
 * @param sessionID - 조회할 세션 ID
 * @param sessionAgentMap - 세션→에이전트 맵
 * @returns AgentName 또는 undefined (미확인 시)
 */
export function resolveAgent(
  sessionID: string,
  sessionAgentMap: Map<string, AgentName>,
): AgentName | undefined {
  return sessionAgentMap.get(sessionID);
}

// ---------------------------------------------------------------------------
// 권한 집행 함수
// ---------------------------------------------------------------------------

/** 집행 결과 */
export interface EnforcementResult {
  allowed: boolean;
  reason: string;
}

/**
 * tool.execute.before 훅에서 호출하는 권한 집행 함수.
 *
 * 처리 흐름:
 * 1. 호출 에이전트를 sessionAgentMap에서 해석
 * 2. 도구 종류를 정규화
 * 3. `.agents/**` 대상이면 모든 에이전트에 즉시 허용 (베이스라인)
 * 4. 정책 테이블 조회 후 허용/거부 판단
 * 5. Fail-safe: 에이전트 미확인 시 변경 도구 거부, 읽기 허용
 *
 * @param input - 도구 이름, 세션 ID, 도구 인자
 * @param sessionAgentMap - 세션→에이전트 맵
 * @returns EnforcementResult
 */
export function enforcePermission(
  input: {
    tool: string;
    sessionID: string;
    args: Record<string, unknown>;
  },
  sessionAgentMap: Map<string, AgentName>,
): EnforcementResult {
  const toolName = input.tool.toLowerCase();
  const agent = resolveAgent(input.sessionID, sessionAgentMap);

  // -------------------------------------------------------------------------
  // 도구 분류
  // -------------------------------------------------------------------------
  const isReadTool =
    toolName === "read" ||
    toolName === "glob" ||
    toolName === "grep" ||
    toolName === "list" ||
    toolName === "lsp" ||
    toolName === "codesearch" ||
    toolName === "ast_grep_search";

  const isEditTool =
    toolName === "edit" ||
    toolName === "write" ||
    toolName === "apply_patch" ||
    toolName === "ast_grep_replace";

  const isBashTool = toolName === "bash";
  const isWebfetchTool = toolName === "webfetch";
  const isTaskTool = toolName === "task";

  // -------------------------------------------------------------------------
  // Fail-safe: 에이전트 미확인
  // -------------------------------------------------------------------------
  if (!agent) {
    if (isReadTool) {
      return {
        allowed: true,
        reason: `[fail-safe] 에이전트 미확인 — 읽기 전용 도구(${toolName}) 허용`,
      };
    }
    return {
      allowed: false,
      reason: `[fail-safe] 에이전트 미확인 — 변경 도구(${toolName}) 거부. sessionID=${input.sessionID}`,
    };
  }

  // -------------------------------------------------------------------------
  // 대상 경로 추출 (edit/write/read 계열 도구)
  // -------------------------------------------------------------------------
  const targetPath = extractTargetPath(input.args, toolName);

  // -------------------------------------------------------------------------
  // 베이스라인: .agents/** 는 모든 에이전트에게 항상 허용
  // -------------------------------------------------------------------------
  if (targetPath) {
    const category = classifyPath(targetPath);
    if (category === "agents") {
      return {
        allowed: true,
        reason: `[baseline] .agents/** 경로는 모든 에이전트에 허용 — agent=${agent}, tool=${toolName}, path=${targetPath}`,
      };
    }
  }

  // -------------------------------------------------------------------------
  // 정책 테이블 조회
  // -------------------------------------------------------------------------
  const policy = POLICY_MAP.get(agent);
  if (!policy) {
    // 알 수 없는 에이전트명은 거부 (방어 코드)
    return {
      allowed: false,
      reason: `[policy] 알 수 없는 에이전트 '${agent}' — 모든 도구 거부`,
    };
  }

  // -------------------------------------------------------------------------
  // task 도구 집행
  // -------------------------------------------------------------------------
  if (isTaskTool) {
    if (policy.task === "deny") {
      return {
        allowed: false,
        reason: `[policy] ${agent}는 task 위임 불가 (재위임 금지)`,
      };
    }

    if (policy.task === "to-subagents") {
      // orchestrator만 해당: 7개 서브에이전트에게만 위임 허용
      const subagentType = input.args["subagent_type"];
      if (typeof subagentType !== "string" || subagentType.trim() === "") {
        return {
          allowed: true,
          reason: `[policy] ${agent}: task — subagent_type 미지정, 허용 (하위 처리에서 검증)`,
        };
      }
      const targetAgent = subagentType.trim();
      if ((SUBAGENT_NAMES as readonly string[]).includes(targetAgent)) {
        return {
          allowed: true,
          reason: `[policy] ${agent}: task → ${targetAgent} 허용`,
        };
      }
      return {
        allowed: false,
        reason: `[policy] ${agent}는 '${targetAgent}'에게 위임 불가 — 허용된 서브에이전트: ${SUBAGENT_NAMES.join(", ")}`,
      };
    }

    // policy.task === 'allow' (미래 확장용)
    return { allowed: true, reason: `[policy] ${agent}: task 허용` };
  }

  // -------------------------------------------------------------------------
  // bash 도구 집행
  // -------------------------------------------------------------------------
  if (isBashTool) {
    if (policy.bash === "deny") {
      return {
        allowed: false,
        reason: `[policy] ${agent}는 bash 실행 불가`,
      };
    }
    return { allowed: true, reason: `[policy] ${agent}: bash 허용` };
  }

  // -------------------------------------------------------------------------
  // webfetch 도구 집행
  // -------------------------------------------------------------------------
  if (isWebfetchTool) {
    if (policy.webfetch === "deny") {
      return {
        allowed: false,
        reason: `[policy] ${agent}는 webfetch 불가`,
      };
    }
    return { allowed: true, reason: `[policy] ${agent}: webfetch 허용` };
  }

  // -------------------------------------------------------------------------
  // 편집/쓰기 도구 집행
  // -------------------------------------------------------------------------
  if (isEditTool) {
    if (policy.sourceEdit === "deny") {
      return {
        allowed: false,
        reason: `[policy] ${agent}는 source 편집/쓰기 불가 — tool=${toolName}${targetPath ? `, path=${targetPath}` : ""}`,
      };
    }
    return {
      allowed: true,
      reason: `[policy] ${agent}: source 편집/쓰기 허용 — tool=${toolName}`,
    };
  }

  // -------------------------------------------------------------------------
  // 읽기 도구 집행
  // -------------------------------------------------------------------------
  if (isReadTool) {
    if (policy.sourceRead === "deny") {
      return {
        allowed: false,
        reason: `[policy] ${agent}는 source 읽기 불가`,
      };
    }

    if (policy.sourceRead === "docs-only") {
      // targetPath가 없으면(glob/grep에 범위 미지정 → repo 전체 탐색) 거부
      if (!targetPath) {
        return {
          allowed: false,
          reason: `[policy] ${agent}는 docs/**만 읽기 허용 — 탐색 범위 미지정(repo 전체) 거부: tool=${toolName}. docs/ 하위 경로를 명시하라`,
        };
      }
      const category = classifyPath(targetPath);
      if (category === "source") {
        return {
          allowed: false,
          reason: `[policy] ${agent}는 docs/**만 읽기 허용 — 거부된 경로: ${targetPath}`,
        };
      }
    }

    return {
      allowed: true,
      reason: `[policy] ${agent}: 읽기 허용 — tool=${toolName}`,
    };
  }

  // -------------------------------------------------------------------------
  // 그 외 도구: 기본 허용 (glob, list, lsp 등 조회 도구)
  // -------------------------------------------------------------------------
  return {
    allowed: true,
    reason: `[policy] ${agent}: 기타 도구(${toolName}) 기본 허용`,
  };
}

// ---------------------------------------------------------------------------
// 내부 유틸: 도구 인자에서 대상 경로 추출
// ---------------------------------------------------------------------------

/**
 * 도구 인자 객체에서 대상 파일/디렉터리 경로를 추출한다.
 * 도구마다 경로 키 이름이 다르므로 알려진 키를 순서대로 시도한다.
 *
 * glob/grep: 탐색 범위 경로(path 키)를 반환한다. 미지정이면 undefined.
 * apply_patch: diff 본문(`input`)의 `+++ b/<path>` 헤더에서 경로를 파싱한다.
 */
function extractTargetPath(
  args: Record<string, unknown>,
  toolName: string,
): string | undefined {
  if (toolName === "bash") {
    // bash는 경로가 아니라 명령어이므로 별도 분류
    return undefined;
  }

  if (toolName === "webfetch") {
    // webfetch는 URL이므로 경로 분류 불필요
    return undefined;
  }

  if (toolName === "task") {
    // task는 subagent_type으로 처리 (enforcePermission에서 직접 처리)
    return undefined;
  }

  // -----------------------------------------------------------------------
  // glob: 탐색 범위는 `path` 또는 `glob` 키
  // -----------------------------------------------------------------------
  if (toolName === "glob") {
    const scopePath = args["path"] ?? args["glob"];
    return typeof scopePath === "string" && scopePath.length > 0
      ? scopePath
      : undefined;
  }

  // -----------------------------------------------------------------------
  // grep: 탐색 범위는 `path` 키; `include`/`glob`은 파일 패턴이므로 경로로 보지 않음
  // -----------------------------------------------------------------------
  if (toolName === "grep") {
    const scopePath = args["path"];
    return typeof scopePath === "string" && scopePath.length > 0
      ? scopePath
      : undefined;
  }

  // -----------------------------------------------------------------------
  // apply_patch: `input` 인자(diff 본문)에서 `+++ b/<path>` 헤더를 파싱
  // -----------------------------------------------------------------------
  if (toolName === "apply_patch") {
    const input = args["input"];
    if (typeof input === "string") {
      const match = /^\+\+\+ b\/(.+)$/m.exec(input);
      if (match?.[1]) return match[1].trim();
    }
    // input이 없거나 파싱 불가 — 경로 미확정 (edit 분기에서 sourceEdit=deny로 처리)
    return undefined;
  }

  // -----------------------------------------------------------------------
  // 그 외 도구: 일반적인 파일 경로 키 이름들 (우선순위 순)
  // -----------------------------------------------------------------------
  const pathKeys = [
    "path",
    "filePath",
    "file_path",
    "file",
    "directory",
    "dir",
  ] as const;
  for (const key of pathKeys) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}
