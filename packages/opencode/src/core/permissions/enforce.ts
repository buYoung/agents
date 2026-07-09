/**
 * permissions/enforce.ts — tool.execute.before 권한 집행
 */

import type { AgentName } from "@opencode/core/doc-protocol";
import {
  getBashCommand,
  isDisabledMcpCommandUsed,
  isReadOnlyBash,
  isWorkspaceBoundedBash,
  targetsAgentsRootEnumeration,
} from "./bash";
import {
  classifyPath,
  getDefaultTempRoots,
  isAgentsRootEnumerationPath,
  isOrchestratorTaskIndexPath,
  isPathWithinAllowedRoots,
} from "./path";
import { POLICY_MAP, SUBAGENT_NAMES } from "./policy";
import { resolveAgent } from "./session-map";

/** 집행 결과 */
export interface EnforcementResult {
  allowed: boolean;
  reason: string;
}

export interface EnforcePermissionOptions {
  /** orchestrator task 위임에 사용할 현재 활성 서브에이전트 목록. */
  subagentNames?: readonly AgentName[];
  /** 작업공간 루트. worker의 workspace/temp 경계 검증에 사용한다. */
  workspaceRoot?: string;
  /** 작업공간 밖에서 허용할 임시 디렉터리 루트. 미지정 시 OS/env 기본값을 쓴다. */
  tempRoots?: readonly string[];
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
 */
export function enforcePermission(
  input: {
    tool: string;
    sessionID: string;
    args: Record<string, unknown>;
  },
  sessionAgentMap: Map<string, AgentName>,
  options?: EnforcePermissionOptions,
): EnforcementResult {
  const toolName = input.tool.toLowerCase();
  const agent = resolveAgent(input.sessionID, sessionAgentMap);
  const allowedSubagentNames = options?.subagentNames ?? SUBAGENT_NAMES;
  const tempRoots = options?.tempRoots ?? getDefaultTempRoots();

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

  const policy = POLICY_MAP.get(agent);
  if (!policy) {
    return {
      allowed: false,
      reason: `[policy] 알 수 없는 에이전트 '${agent}' — 모든 도구 거부`,
    };
  }

  const targetPaths = extractTargetPaths(input.args, toolName);
  const targetPath = targetPaths[0];

  if (targetPaths.length > 0) {
    const boundaryPolicy = isEditTool
      ? policy.paths.sourceEdit
      : isReadTool
        ? policy.paths.sourceRead
        : "any";
    if (boundaryPolicy === "workspace-or-temp") {
      const outsidePath = targetPaths.find(
        (pathValue) =>
          !isPathWithinAllowedRoots(
            pathValue,
            options?.workspaceRoot,
            tempRoots,
          ),
      );
      if (outsidePath) {
        return {
          allowed: false,
          reason: `[policy] ${agent}: workspace/temp 밖 경로 접근 거부 — tool=${toolName}, path=${outsidePath}`,
        };
      }
    }
  } else if (isEditTool && policy.paths.sourceEdit === "workspace-or-temp") {
    return {
      allowed: false,
      reason: `[policy] ${agent}: 대상 경로 없는 편집/쓰기 도구 거부 — tool=${toolName}`,
    };
  }

  if (targetPaths.length > 0) {
    const categories = targetPaths.map(classifyPath);
    if (
      categories.every((category) => category === "agents") &&
      agent === "planner" &&
      toolName === "edit"
    ) {
      return {
        allowed: false,
        reason:
          "[policy] planner는 plan.md 산출물에 write만 허용 — edit 금지",
      };
    }
    if (categories.every((category) => category === "agents")) {
      const outsideWorkspaceArtifactPath = targetPaths.find(
        (pathValue) =>
          !isPathWithinAllowedRoots(pathValue, options?.workspaceRoot, []),
      );
      if (outsideWorkspaceArtifactPath) {
        return {
          allowed: false,
          reason: `[baseline] .agents/** 산출물은 workspace 내부만 허용 — path=${outsideWorkspaceArtifactPath}`,
        };
      }
      const rootEnumerationPath = targetPaths.find((pathValue) =>
        isAgentsRootEnumerationPath(pathValue, options?.workspaceRoot),
      );
      if (agent === "orchestrator" && isReadTool && rootEnumerationPath) {
        return {
          allowed: false,
          reason: `[policy] orchestrator는 .agents 루트/전체 산출물 목록 열람 금지 — tool=${toolName}, path=${rootEnumerationPath}`,
        };
      }
      const subagentArtifactPath = targetPaths.find(
        (pathValue) =>
          agent === "orchestrator" &&
          isReadTool &&
          !isOrchestratorTaskIndexPath(pathValue, options?.workspaceRoot),
      );
      if (subagentArtifactPath) {
        return {
          allowed: false,
          reason: `[policy] orchestrator는 서브에이전트 산출물 본문 열람 금지 — tool=${toolName}, path=${subagentArtifactPath}`,
        };
      }
      return {
        allowed: true,
        reason: `[baseline] .agents/** 경로는 모든 에이전트에 허용 — agent=${agent}, tool=${toolName}, path=${targetPath}`,
      };
    }
  }

  if (isTaskTool) {
    if (policy.tools.task === "deny") {
      return {
        allowed: false,
        reason: `[policy] ${agent}는 task 위임 불가 (재위임 금지)`,
      };
    }

    if (policy.tools.task === "to-subagents") {
      const subagentType = input.args["subagent_type"];
      if (typeof subagentType !== "string" || subagentType.trim() === "") {
        return {
          allowed: true,
          reason: `[policy] ${agent}: task — subagent_type 미지정, 허용 (하위 처리에서 검증)`,
        };
      }
      const targetAgent = subagentType.trim();
      if ((allowedSubagentNames as readonly string[]).includes(targetAgent)) {
        return {
          allowed: true,
          reason: `[policy] ${agent}: task → ${targetAgent} 허용`,
        };
      }
      return {
        allowed: false,
        reason: `[policy] ${agent}는 '${targetAgent}'에게 위임 불가 — 허용된 서브에이전트: ${allowedSubagentNames.join(", ")}`,
      };
    }

    return { allowed: true, reason: `[policy] ${agent}: task 허용` };
  }

  if (isBashTool) {
    const bashCommand = getBashCommand(input.args);
    if (policy.tools.bash === "deny") {
      return {
        allowed: false,
        reason: `[policy] ${agent}는 bash 실행 불가`,
      };
    }
    const disabledMcpCommand = isDisabledMcpCommandUsed(bashCommand);
    if (disabledMcpCommand) {
      return {
        allowed: false,
        reason: `[policy] 비활성 MCP 명령은 bash로 우회 실행 불가 — command=${disabledMcpCommand}`,
      };
    }
    if (
      agent === "orchestrator" &&
      targetsAgentsRootEnumeration(bashCommand, options?.workspaceRoot)
    ) {
      return {
        allowed: false,
        reason: "[policy] orchestrator는 bash로 .agents 루트/전체 산출물 목록 열람 금지",
      };
    }
    if (policy.tools.bash === "read-only") {
      if (isReadOnlyBash(bashCommand)) {
        return {
          allowed: true,
          reason: `[policy] ${agent}: 읽기 전용 bash 허용`,
        };
      }
      return {
        allowed: false,
        reason: `[policy] ${agent}: 읽기 전용으로 분류되지 않은 bash 거부`,
      };
    }
    if (policy.paths.bash === "workspace-or-temp") {
      if (!isWorkspaceBoundedBash(input.args, options?.workspaceRoot, tempRoots)) {
        return {
          allowed: false,
          reason: `[policy] ${agent}: workspace/temp 밖 bash 접근 또는 안전하지 않은 인라인 실행 거부`,
        };
      }
    }
    return { allowed: true, reason: `[policy] ${agent}: bash 허용` };
  }

  if (isWebfetchTool) {
    if (policy.tools.webfetch === "deny") {
      return {
        allowed: false,
        reason: `[policy] ${agent}는 webfetch 불가`,
      };
    }
    return { allowed: true, reason: `[policy] ${agent}: webfetch 허용` };
  }

  if (isEditTool) {
    if (policy.tools.sourceEdit === "deny") {
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

  if (isReadTool) {
    if (policy.tools.sourceRead === "deny") {
      return {
        allowed: false,
        reason: `[policy] ${agent}는 source 읽기 불가`,
      };
    }

    if (policy.tools.sourceRead === "docs-only") {
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

  return {
    allowed: true,
    reason: `[policy] ${agent}: 기타 도구(${toolName}) 기본 허용`,
  };
}

function extractTargetPaths(
  args: Record<string, unknown>,
  toolName: string,
): string[] {
  if (toolName === "bash") {
    return [];
  }

  if (toolName === "webfetch") {
    return [];
  }

  if (toolName === "task") {
    return [];
  }

  if (toolName === "glob") {
    const scopePath = args["path"] ?? args["glob"];
    return typeof scopePath === "string" && scopePath.length > 0
      ? [scopePath]
      : [];
  }

  if (toolName === "grep") {
    const scopePath = args["path"];
    return typeof scopePath === "string" && scopePath.length > 0
      ? [scopePath]
      : [];
  }

  if (toolName === "apply_patch") {
    const input = args["input"] ?? args["patchText"];
    if (typeof input === "string") {
      const paths = new Set<string>();
      const patterns = [
        /^\*\*\* Add File: (.+)$/gm,
        /^\*\*\* Update File: (.+)$/gm,
        /^\*\*\* Delete File: (.+)$/gm,
        /^\+\+\+ b\/(.+)$/gm,
      ];

      for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(input)) !== null) {
          if (match[1]) paths.add(match[1].trim());
        }
      }

      return [...paths];
    }
    return [];
  }

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
      return [value];
    }
  }

  return [];
}
