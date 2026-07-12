/**
 * permissions/enforce.ts — tool.execute.before 권한 집행
 */

import * as fs from "node:fs";
import type { AgentName } from "@opencode/core/doc-protocol";
import {
  getTaskExecutionContext,
  isSameExecutionAssignment,
  type ExecutionAssignment,
  type ExecutionContext,
} from "./assignment";
import {
  getBashCommand,
  inspectBashArtifactAccess,
  isDisabledMcpCommandUsed,
  isReadOnlyBash,
  isWorkspaceBoundedBash,
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
import {
  isConfiguredMcpAllowed,
  matchConfiguredMcpTool,
  type ConfiguredMcpPolicy,
} from "./mcp-policy";
import {
  GENERIC_MCP_RESOURCE_TOOL_IDS,
  RUNTIME_BASH_TOOL_IDS,
  RUNTIME_EDIT_TOOL_IDS,
  RUNTIME_NETWORK_TOOL_IDS,
  RUNTIME_READ_TOOL_IDS,
  RUNTIME_TASK_TOOL_IDS,
} from "./runtime-tool-ids";

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
  /** 런타임 task/message lifecycle에서 확인한 세션별 정확한 실행 할당. */
  sessionAssignments?: Map<string, ExecutionAssignment>;
  /** 활성/이력/입력 및 task-wide 예약을 소유하는 내부 세션 상태 API. */
  sessionExecution?: {
    bindRootAssignment: (
      sessionID: string,
      assignment: ExecutionAssignment,
    ) => boolean;
    canReadSessionArtifact: (
      sessionID: string,
      assignment: ExecutionAssignment,
    ) => boolean;
    canRegisterDelegation: (input: {
      parentSessionID: string;
      callID: string;
      continuedSessionID?: string;
      context: ExecutionContext;
    }) => boolean;
  };
  /** config 훅이 최종 native `mcp`를 보고 컴파일한 사용자 신뢰 정책. */
  configuredMcpPolicy?: ConfiguredMcpPolicy;
}

// Hook에는 custom/plugin/MCP 도구의 provenance나 효과 metadata가 오지 않는다.
// 따라서 exact ID는 builtin 출처 증명이 아니라 지원 환경의 분류 키일 뿐이다.
// 아래 ID와 충돌하는 custom tool이 등록된 환경은 명시적으로 지원하지 않으며,
// namespace suffix나 다른 문자열 형태로 출처/효과를 추론하지 않는다.
const READ_TOOL_IDS: ReadonlySet<string> = new Set(RUNTIME_READ_TOOL_IDS);
const EDIT_TOOL_IDS: ReadonlySet<string> = new Set(RUNTIME_EDIT_TOOL_IDS);
const BASH_TOOL_IDS: ReadonlySet<string> = new Set(RUNTIME_BASH_TOOL_IDS);
const NETWORK_TOOL_IDS: ReadonlySet<string> = new Set(RUNTIME_NETWORK_TOOL_IDS);
const TASK_TOOL_IDS: ReadonlySet<string> = new Set(RUNTIME_TASK_TOOL_IDS);
const MCP_RESOURCE_TOOL_IDS: ReadonlySet<string> = new Set(
  GENERIC_MCP_RESOURCE_TOOL_IDS,
);

function resolveToolKind(toolName: string):
  | "read"
  | "edit"
  | "bash"
  | "webfetch"
  | "task"
  | "mcp-resource"
  | undefined {
  if (READ_TOOL_IDS.has(toolName)) return "read";
  if (EDIT_TOOL_IDS.has(toolName)) return "edit";
  if (BASH_TOOL_IDS.has(toolName)) return "bash";
  if (NETWORK_TOOL_IDS.has(toolName)) return "webfetch";
  if (TASK_TOOL_IDS.has(toolName)) return "task";
  if (MCP_RESOURCE_TOOL_IDS.has(toolName)) return "mcp-resource";
  return undefined;
}

/**
 * tool.execute.before 훅에서 호출하는 권한 집행 함수.
 *
 * 처리 흐름:
 * 1. 호출 에이전트를 sessionAgentMap에서 해석
 * 2. 도구 종류를 정규화
 * 3. `.agents/orchestration/**` 대상이면 정규 run 경로와 역할 소유권을 검증
 * 4. 정책 테이블 조회 후 허용/거부 판단
 * 5. Fail-safe: 에이전트 미확인 시 변경 도구 거부, 읽기 허용
 */
export function enforcePermission(
  input: {
    tool: string;
    sessionID: string;
    callID?: string;
    args: Record<string, unknown>;
  },
  sessionAgentMap: Map<string, AgentName>,
  options?: EnforcePermissionOptions,
): EnforcementResult {
  const rawToolName = input.tool;
  const toolName = rawToolName.toLowerCase();
  const toolKind = resolveToolKind(rawToolName);
  const configuredMcpTool = toolKind
    ? undefined
    : matchConfiguredMcpTool(options?.configuredMcpPolicy, rawToolName);
  const agent = resolveAgent(input.sessionID, sessionAgentMap);
  const allowedSubagentNames = options?.subagentNames ?? SUBAGENT_NAMES;
  const tempRoots = options?.tempRoots ?? getDefaultTempRoots();

  const isReadTool = toolKind === "read";
  const isEditTool = toolKind === "edit";
  const isBashTool = toolKind === "bash";
  const isWebfetchTool = toolKind === "webfetch";
  const isTaskTool = toolKind === "task";
  const isMcpResourceTool = toolKind === "mcp-resource";

  // 로컬 경로 해석은 exact builtin/resource ID에만 적용한다. configured MCP의
  // 인자는 서버 고유 schema이므로 builtin path 규칙으로 추론하지 않는다.
  const targetPaths = toolKind
    ? extractTargetPaths(input.args, toolName)
    : [];
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
    if (configuredMcpTool) {
      return {
        allowed: false,
        reason: `[fail-safe] 에이전트 미확인 — 구성 MCP 도구(${rawToolName}) 거부. sessionID=${input.sessionID}`,
      };
    }
    if (
      inspectedPaths.some(
        ({ inspection }) => inspection.category === "agents",
      )
    ) {
      return {
        allowed: false,
        reason: `[fail-safe] 에이전트 미확인 — 실행 산출물 읽기/쓰기 거부. sessionID=${input.sessionID}`,
      };
    }
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

  if (configuredMcpTool && options?.configuredMcpPolicy) {
    if (
      !isConfiguredMcpAllowed(
        options.configuredMcpPolicy,
        agent,
        configuredMcpTool.server.serverKey,
      )
    ) {
      return {
        allowed: false,
        reason: `[policy] ${agent}: MCP 서버 ${configuredMcpTool.server.serverKey} 도구 거부 — tool=${rawToolName}`,
      };
    }
    return {
      allowed: true,
      reason: `[policy] ${agent}: 사용자가 구성한 MCP 서버 ${configuredMcpTool.server.serverKey}의 신뢰 capability 허용 — tool=${rawToolName}`,
    };
  }

  if (isMcpResourceTool) {
    return {
      allowed: false,
      reason: `[policy] ${agent}: generic MCP resource API는 구성 서버 도구 정책으로 승격하지 않음 — tool=${rawToolName}`,
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
    const patchOperations = extractPatchOperations(input.args);
    const deletesArtifact = patchOperations.some(
      (operation) =>
        operation.kind === "delete" &&
        inspectPath(operation.path, options?.workspaceRoot).category === "agents",
    );
    const movesArtifact =
      patchOperations.some((operation) => operation.kind === "move") &&
      artifactPaths.length > 0;
    if (deletesArtifact || movesArtifact) {
      return {
        allowed: false,
        reason: `[baseline] 산출물 patch Delete/Move 거부 — tool=${toolName}`,
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
          reason: `[baseline] 산출물 경로는 .agents/orchestration/<taskId>/<workItemId>/<role-file>.md 형식이어야 함 — path=${artifactPath.pathValue}`,
        };
      }
      if (isEditTool && identity.owner !== agent) {
        return {
          allowed: false,
          reason: `[baseline] ${agent}는 ${identity.owner} 소유 산출물 쓰기 불가 — path=${artifactPath.pathValue}`,
        };
      }
      if (isEditTool) {
        let assignment = options?.sessionAssignments?.get(input.sessionID);
        if (
          !assignment &&
          agent === "orchestrator" &&
          identity.owner === "orchestrator" &&
          options?.sessionAssignments
        ) {
          // Root orchestrator에는 부모 task metadata가 없다. 명시 입력 경로가
          // 없을 때에만 첫 task.md 쓰기를 세션 할당으로 고정한다(TOFU 경계).
          assignment = {
            agent: identity.owner,
            taskId: identity.taskId,
            workItemId: identity.workItemId,
            artifactPath: identity.relativePath,
          };
          const bound = options.sessionExecution
            ? options.sessionExecution.bindRootAssignment(
                input.sessionID,
                assignment,
              )
            : (options.sessionAssignments.set(input.sessionID, assignment), true);
          if (!bound) {
            return {
              allowed: false,
              reason: `[baseline] orchestrator: 같은 root 세션의 task identity 변경 거부 — path=${artifactPath.pathValue}`,
            };
          }
        }
        if (!assignment) {
          return {
            allowed: false,
            reason: `[baseline] ${agent}: lifecycle에서 확인된 실행 할당 없는 산출물 쓰기 거부 — path=${artifactPath.pathValue}`,
          };
        }
        const requestedAssignment: ExecutionAssignment = {
          agent: identity.owner,
          taskId: identity.taskId,
          workItemId: identity.workItemId,
          artifactPath: identity.relativePath,
        };
        if (!isSameExecutionAssignment(assignment, requestedAssignment)) {
          return {
            allowed: false,
            reason: `[baseline] ${agent}: 다른 실행 할당의 산출물 쓰기 거부 — assigned=${assignment.taskId}/${assignment.workItemId}/${assignment.agent}, requested=${identity.taskId}/${identity.workItemId}/${identity.owner}`,
          };
        }
      }
      if (isReadTool && policy.tools.sourceRead === "deny") {
        return {
          allowed: false,
          reason: `[policy] ${agent}는 명시적 산출물 입력도 읽기 불가`,
        };
      }
      if (isReadTool && options?.sessionExecution) {
        const requestedAssignment: ExecutionAssignment = {
          agent: identity.owner,
          taskId: identity.taskId,
          workItemId: identity.workItemId,
          artifactPath: identity.relativePath,
        };
        if (
          !options.sessionExecution.canReadSessionArtifact(
            input.sessionID,
            requestedAssignment,
          )
        ) {
          return {
            allowed: false,
            reason: `[baseline] ${agent}: 활성·이력·명시 Input에 없는 산출물 읽기 거부 — path=${artifactPath.pathValue}`,
          };
        }
      }
      if (
        isEditTool &&
        toolName === "write" &&
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
          reason: `[baseline] .agents/orchestration/** 산출물은 workspace 내부만 허용 — path=${outsideWorkspaceArtifactPath}`,
        };
      }
      const rootEnumerationPath = targetPaths.find((pathValue) =>
        isAgentsRootEnumerationPath(pathValue, options?.workspaceRoot),
      );
      if (agent === "orchestrator" && isReadTool && rootEnumerationPath) {
        return {
          allowed: false,
          reason: `[policy] orchestrator는 .agents 및 .agents/orchestration 루트/전체 산출물 목록 열람 금지 — tool=${toolName}, path=${rootEnumerationPath}`,
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
        reason: `[baseline] 역할 소유권이 확인된 .agents/orchestration 산출물 접근 허용 — agent=${agent}, tool=${toolName}, path=${targetPath}`,
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
        const context = getTaskExecutionContext(
          input.args,
          options?.workspaceRoot,
        );
        const assignment = context?.output;
        if (targetAgent !== "intent-checker" && !assignment) {
          return {
            allowed: false,
            reason: `[policy] ${agent}: task → ${targetAgent}는 고유 taskId/workItemId와 정확한 역할 산출물 경로가 prompt에 하나 있어야 함`,
          };
        }
        const continuedSessionID = input.args["task_id"];
        if (
          context &&
          options?.sessionExecution &&
          typeof input.callID === "string"
        ) {
          if (
            !options.sessionExecution.canRegisterDelegation({
              parentSessionID: input.sessionID,
              callID: input.callID,
              ...(typeof continuedSessionID === "string"
                ? { continuedSessionID }
                : {}),
              context,
            })
          ) {
            return {
              allowed: false,
              reason: `[policy] ${agent}: task 실행 할당/예약 충돌 — taskId=${assignment?.taskId}, workItemId=${assignment?.workItemId}`,
            };
          }
        } else if (typeof continuedSessionID === "string" && assignment) {
          const existingAssignment = options?.sessionAssignments?.get(
            continuedSessionID,
          );
          if (!existingAssignment) {
            return {
              allowed: false,
              reason: `[policy] ${agent}: lifecycle 할당이 없는 task continuation 거부 — session=${continuedSessionID}`,
            };
          }
          if (!isSameExecutionAssignment(existingAssignment, assignment)) {
            return {
              allowed: false,
              reason: `[policy] ${agent}: task continuation 실행 할당 변경 거부 — session=${continuedSessionID}`,
            };
          }
        }
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
    const artifactAccess = inspectBashArtifactAccess(
      input.args,
      options?.workspaceRoot,
    );
    if (artifactAccess.invalidReason) {
      return {
        allowed: false,
        reason: `[baseline] bash 산출물 경로 거부 — ${artifactAccess.invalidReason}`,
      };
    }
    if (artifactAccess.identities.length > 0 && !isReadOnlyBash(bashCommand)) {
      return {
        allowed: false,
        reason: "[baseline] .agents/orchestration 산출물을 대상으로 한 변경 가능 bash 거부 — 파일 도구와 역할 소유 경로를 사용하라",
      };
    }
    if (
      agent === "orchestrator" &&
      artifactAccess.identities.some(
        (identity) => identity.owner !== "orchestrator",
      )
    ) {
      return {
        allowed: false,
        reason: "[policy] orchestrator는 bash로 .agents 및 .agents/orchestration 루트/전체 산출물 목록 열람 금지",
      };
    }
    if (
      artifactAccess.identities.length > 0 &&
      policy.tools.sourceRead === "deny"
    ) {
      return {
        allowed: false,
        reason: `[policy] ${agent}는 bash로 실행 산출물 읽기 불가`,
      };
    }
    if (artifactAccess.identities.length > 0) {
      const unreadableIdentity = artifactAccess.identities.find((identity) =>
        options?.sessionExecution?.canReadSessionArtifact(input.sessionID, {
          agent: identity.owner,
          taskId: identity.taskId,
          workItemId: identity.workItemId,
          artifactPath: identity.relativePath,
        }) !== true,
      );
      if (unreadableIdentity) {
        return {
          allowed: false,
          reason: `[baseline] ${agent}: 활성·이력·명시 Input에 없는 산출물 bash 읽기 거부 — path=${unreadableIdentity.relativePath}`,
        };
      }
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
    return [...new Set(extractPatchOperations(args).map(({ path }) => path))];
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

interface PatchOperation {
  kind: "add" | "update" | "delete" | "move";
  path: string;
}

function extractPatchOperations(
  args: Record<string, unknown>,
): PatchOperation[] {
  const input = args["input"] ?? args["patchText"];
  if (typeof input !== "string") return [];

  const operations: PatchOperation[] = [];
  const patterns: Array<{
    kind: PatchOperation["kind"];
    pattern: RegExp;
  }> = [
    { kind: "add", pattern: /^\*\*\* Add File: (.+)$/gm },
    { kind: "update", pattern: /^\*\*\* Update File: (.+)$/gm },
    { kind: "delete", pattern: /^\*\*\* Delete File: (.+)$/gm },
    { kind: "move", pattern: /^\*\*\* Move to: (.+)$/gm },
    { kind: "delete", pattern: /^--- a\/(.+)\r?\n\+\+\+ \/dev\/null$/gm },
    { kind: "update", pattern: /^--- a\/(.+)$/gm },
    { kind: "update", pattern: /^\+\+\+ b\/(.+)$/gm },
  ];

  for (const { kind, pattern } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(input)) !== null) {
      if (match[1]) operations.push({ kind, path: match[1].trim() });
    }
  }
  return operations;
}
