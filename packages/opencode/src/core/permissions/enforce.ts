/**
 * permissions/enforce.ts — tool.execute.before 권한 집행
 */

import * as fs from "node:fs";
import type { AgentName } from "@opencode/core/doc-protocol";
import {
  getBashCommand,
  isDisabledMcpCommandUsed,
  isReadOnlyBash,
  isWorkspaceBoundedBash,
  targetsRestrictedOrchestratorArtifact,
  targetsRunArtifact,
} from "./bash";
import {
  getDefaultTempRoots,
  getRunArtifactIdentity,
  inspectPath,
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

const READ_TOOL_ALIASES = new Set([
  "read",
  "read_file",
  "glob",
  "grep",
  "list",
  "list_files",
  "lsp",
  "codesearch",
  "ast_grep_search",
]);

const EDIT_TOOL_ALIASES = new Set([
  "edit",
  "edit_file",
  "write",
  "write_file",
  "delete_file",
  "move_file",
  "apply_patch",
  "ast_grep_replace",
]);

const BASH_TOOL_ALIASES = new Set([
  "bash",
  "shell",
  "exec",
  "execute_command",
  "terminal",
]);

const WEBFETCH_TOOL_ALIASES = new Set([
  "webfetch",
  "web_fetch",
  "fetch_url",
  "http_request",
]);

const TASK_TOOL_ALIASES = new Set([
  "task",
  "delegate",
  "spawn_agent",
  "spawn_task",
]);

const ARTIFACT_DESTRUCTIVE_TOOL_ALIASES = new Set([
  "delete_file",
  "move_file",
]);

function getToolAliasCandidates(toolName: string): string[] {
  const normalized = toolName.toLowerCase();
  const candidates = [normalized];
  for (const separator of ["__", ".", ":", "/"]) {
    const parts = normalized.split(separator).filter(Boolean);
    if (parts.length > 1) candidates.push(parts.at(-1) ?? normalized);
  }
  return candidates;
}

function resolveToolKind(toolName: string):
  | "read"
  | "edit"
  | "bash"
  | "webfetch"
  | "task"
  | undefined {
  const candidates = getToolAliasCandidates(toolName);
  if (candidates.some((candidate) => READ_TOOL_ALIASES.has(candidate))) {
    return "read";
  }
  if (candidates.some((candidate) => EDIT_TOOL_ALIASES.has(candidate))) {
    return "edit";
  }
  if (candidates.some((candidate) => BASH_TOOL_ALIASES.has(candidate))) {
    return "bash";
  }
  if (candidates.some((candidate) => WEBFETCH_TOOL_ALIASES.has(candidate))) {
    return "webfetch";
  }
  if (candidates.some((candidate) => TASK_TOOL_ALIASES.has(candidate))) {
    return "task";
  }
  return undefined;
}

/**
 * tool.execute.before 훅에서 호출하는 권한 집행 함수.
 *
 * 처리 흐름:
 * 1. 호출 에이전트를 sessionAgentMap에서 해석
 * 2. 도구 종류를 정규화
 * 3. `.agents/**` 대상이면 정규 run 경로와 역할 소유권을 검증
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
  const toolKind = resolveToolKind(toolName);
  const agent = resolveAgent(input.sessionID, sessionAgentMap);
  const allowedSubagentNames = options?.subagentNames ?? SUBAGENT_NAMES;
  const tempRoots = options?.tempRoots ?? getDefaultTempRoots();

  const isReadTool = toolKind === "read";
  const isEditTool = toolKind === "edit";
  const isBashTool = toolKind === "bash";
  const isWebfetchTool = toolKind === "webfetch";
  const isTaskTool = toolKind === "task";

  const targetPaths = extractTargetPaths(input.args, toolName);
  const targetPath = targetPaths[0];
  const inspectedPaths = targetPaths.map((pathValue) => ({
    pathValue,
    inspection: inspectPath(pathValue, options?.workspaceRoot),
  }));
  const invalidPath = inspectedPaths.find(
    ({ inspection }) => !inspection.valid,
  );
  if (invalidPath) {
    return {
      allowed: false,
      reason: `[policy] 정규화할 수 없는 경로 거부 — tool=${toolName}, path=${invalidPath.pathValue}, reason=${invalidPath.inspection.reason ?? "invalid"}`,
    };
  }

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

  if (!toolKind) {
    return {
      allowed: false,
      reason: `[policy] ${agent}: 분류되지 않은 도구(${toolName}) 기본 거부`,
    };
  }

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
    const categories = inspectedPaths.map(
      ({ inspection }) => inspection.category,
    );
    const artifactPaths = inspectedPaths.filter(
      ({ inspection }) => inspection.category === "agents",
    );
    const toolAliasCandidates = getToolAliasCandidates(toolName);
    if (
      artifactPaths.length > 0 &&
      toolAliasCandidates.some((candidate) =>
        ARTIFACT_DESTRUCTIVE_TOOL_ALIASES.has(candidate),
      )
    ) {
      return {
        allowed: false,
        reason: `[baseline] 산출물 delete/move 도구 거부 — tool=${toolName}`,
      };
    }
    for (const artifactPath of artifactPaths) {
      const identity = getRunArtifactIdentity(
        artifactPath.pathValue,
        options?.workspaceRoot,
      );
      if (!identity) {
        return {
          allowed: false,
          reason: `[baseline] 산출물 경로는 .agents/<taskId>/<workItemId>/<role-file>.md 형식이어야 함 — path=${artifactPath.pathValue}`,
        };
      }
      if (isEditTool && identity.owner !== agent) {
        return {
          allowed: false,
          reason: `[baseline] ${agent}는 ${identity.owner} 소유 산출물 쓰기 불가 — path=${artifactPath.pathValue}`,
        };
      }
      if (
        isEditTool &&
        toolAliasCandidates.some((candidate) =>
          ["write", "write_file"].includes(candidate),
        ) &&
        fs.existsSync(artifactPath.inspection.canonicalPath)
      ) {
        return {
          allowed: false,
          reason: `[baseline] 기존 산출물 write 덮어쓰기 거부 — continuation은 edit/apply_patch 사용: path=${artifactPath.pathValue}`,
        };
      }
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
        reason: `[baseline] 역할 소유권이 확인된 .agents 산출물 접근 허용 — agent=${agent}, tool=${toolName}, path=${targetPath}`,
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
          allowed: false,
          reason: `[policy] ${agent}: task — subagent_type 미지정 거부`,
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
      targetsRunArtifact(bashCommand, options?.workspaceRoot) &&
      !isReadOnlyBash(bashCommand)
    ) {
      return {
        allowed: false,
        reason: "[baseline] .agents 산출물을 대상으로 한 변경 가능 bash 거부 — 파일 도구와 역할 소유 경로를 사용하라",
      };
    }
    if (
      agent === "orchestrator" &&
      targetsRestrictedOrchestratorArtifact(
        bashCommand,
        options?.workspaceRoot,
      )
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
      const category = inspectPath(
        targetPath,
        options?.workspaceRoot,
      ).category;
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
    allowed: false,
    reason: `[policy] ${agent}: 분류되지 않은 도구(${toolName}) 기본 거부`,
  };
}

function extractTargetPaths(
  args: Record<string, unknown>,
  toolName: string,
): string[] {
  const toolKind = resolveToolKind(toolName);
  if (toolKind === "bash") {
    return [];
  }

  if (toolKind === "webfetch") {
    return [];
  }

  if (toolKind === "task") {
    return [];
  }

  if (getToolAliasCandidates(toolName).includes("glob")) {
    const scopePath = args["path"] ?? args["glob"];
    return typeof scopePath === "string" && scopePath.length > 0
      ? [scopePath]
      : [];
  }

  if (getToolAliasCandidates(toolName).includes("grep")) {
    const scopePath = args["path"];
    return typeof scopePath === "string" && scopePath.length > 0
      ? [scopePath]
      : [];
  }

  if (getToolAliasCandidates(toolName).includes("apply_patch")) {
    const input = args["input"] ?? args["patchText"];
    if (typeof input === "string") {
      const paths = new Set<string>();
      const patterns = [
        /^\*\*\* Add File: (.+)$/gm,
        /^\*\*\* Update File: (.+)$/gm,
        /^\*\*\* Delete File: (.+)$/gm,
        /^\*\*\* Move to: (.+)$/gm,
        /^--- a\/(.+)$/gm,
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
    "source",
    "sourcePath",
    "source_path",
    "destination",
    "destinationPath",
    "destination_path",
    "target",
    "targetPath",
    "target_path",
    "oldPath",
    "old_path",
    "newPath",
    "new_path",
  ] as const;
  const paths: string[] = [];
  for (const key of pathKeys) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) {
      paths.push(value);
    }
  }

  return [...new Set(paths)];
}
