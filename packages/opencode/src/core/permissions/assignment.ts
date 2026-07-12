/**
 * permissions/assignment.ts — task 실행 산출물과 명시적 입력 해석
 */

import {
  DOCUMENTED_AGENTS,
  RUN_DIR_ROOT,
  type AgentName,
  type DocumentedAgent,
} from "@opencode/core/doc-protocol";
import { getRunArtifactIdentity } from "./path";

/** 공개 호환 표면: 현재 활성 출력 할당의 기존 shape를 유지한다. */
export interface ExecutionAssignment {
  agent: DocumentedAgent;
  taskId: string;
  workItemId: string;
  artifactPath: string;
}

export interface ExecutionContext {
  /** 정확히 하나인 쓰기 대상. */
  output: ExecutionAssignment;
  /** 명시적으로 위임된 읽기 전용 입력. */
  inputs: readonly ExecutionAssignment[];
  /** 새 Output/Input 프로토콜인지 안전한 구형 해석인지 표시한다. */
  protocol: "explicit" | "legacy";
}

function isDocumentedAgent(agent: AgentName): agent is DocumentedAgent {
  return (DOCUMENTED_AGENTS as readonly AgentName[]).includes(agent);
}

export function isSameExecutionAssignment(
  left: ExecutionAssignment,
  right: ExecutionAssignment,
): boolean {
  return (
    left.agent === right.agent &&
    left.taskId === right.taskId &&
    left.workItemId === right.workItemId
  );
}

export function executionAssignmentKey(
  assignment: ExecutionAssignment,
): string {
  return `${assignment.taskId}\0${assignment.workItemId}\0${assignment.agent}`;
}

export function taskWorkItemKey(assignment: ExecutionAssignment): string {
  return `${assignment.taskId}\0${assignment.workItemId}`;
}

function assignmentFromArtifactPath(
  artifactPath: string,
  workspaceRoot?: string,
): ExecutionAssignment | undefined {
  const identity = getRunArtifactIdentity(artifactPath, workspaceRoot);
  if (!identity) return undefined;
  return {
    agent: identity.owner,
    taskId: identity.taskId,
    workItemId: identity.workItemId,
    artifactPath: identity.relativePath,
  };
}

const ARTIFACT_PATH_PATTERN = new RegExp(
  `${RUN_DIR_ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/` +
    "[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+\\.md",
  "g",
);
const EXPLICIT_MARKER_PATTERN = /^[\t ]*(Output|Input):[\t ]*(.*?)[\t ]*$/gm;
const EXPLICIT_MARKER_DETECTOR = /^[\t ]*(?:Output|Input):/m;

function parseExplicitExecutionContext(
  agent: DocumentedAgent,
  prompt: string,
  workspaceRoot?: string,
): ExecutionContext | undefined {
  const outputs: ExecutionAssignment[] = [];
  const inputs = new Map<string, ExecutionAssignment>();
  let markerCount = 0;

  for (const match of prompt.matchAll(EXPLICIT_MARKER_PATTERN)) {
    markerCount += 1;
    const marker = match[1];
    const artifactPath = match[2];
    if (!marker || !artifactPath) return undefined;
    const assignment = assignmentFromArtifactPath(artifactPath, workspaceRoot);
    if (!assignment) return undefined;
    if (marker === "Output") {
      if (assignment.agent !== agent) return undefined;
      outputs.push(assignment);
    } else {
      inputs.set(executionAssignmentKey(assignment), assignment);
    }
  }

  // `Output:`/`Input:`처럼 보이는 줄이 정규 marker로 모두 해석되지 않으면
  // 부분 파싱으로 권한을 넓히지 않는다.
  const detectedCount = [...prompt.matchAll(/^[\t ]*(?:Output|Input):/gm)].length;
  if (markerCount !== detectedCount || outputs.length !== 1) return undefined;
  const output = outputs[0];
  if (
    !output ||
    inputs.has(executionAssignmentKey(output)) ||
    [...inputs.values()].some(
      (input) => taskWorkItemKey(input) === taskWorkItemKey(output),
    ) ||
    new Set([...inputs.values()].map(taskWorkItemKey)).size !== inputs.size
  ) {
    return undefined;
  }

  return {
    output,
    inputs: [...inputs.values()],
    protocol: "explicit",
  };
}

function parseLegacyExecutionContext(
  agent: DocumentedAgent,
  prompt: string,
  workspaceRoot?: string,
): ExecutionContext | undefined {
  const assignments = new Map<string, ExecutionAssignment>();
  for (const match of prompt.matchAll(ARTIFACT_PATH_PATTERN)) {
    const artifactPath = match[0];
    const assignment = assignmentFromArtifactPath(artifactPath, workspaceRoot);
    if (!assignment) continue;
    assignments.set(executionAssignmentKey(assignment), assignment);
  }

  const outputCandidates = [...assignments.values()].filter(
    (assignment) => assignment.agent === agent,
  );
  if (outputCandidates.length !== 1) return undefined;
  const output = outputCandidates[0];
  if (!output) return undefined;

  const inputs = [...assignments.values()].filter(
    (assignment) => !isSameExecutionAssignment(assignment, output),
  );
  if (
    inputs.some(
      (input) => taskWorkItemKey(input) === taskWorkItemKey(output),
    ) ||
    new Set(inputs.map(taskWorkItemKey)).size !== inputs.length
  ) {
    return undefined;
  }

  return {
    output,
    inputs,
    protocol: "legacy",
  };
}

/**
 * 새 프로토콜은 정확히 한 `Output:`과 0개 이상의 `Input:` 줄을 요구한다.
 * marker가 전혀 없는 기존 호출만, 같은 역할 산출물이 하나로 명확할 때 안전한
 * 호환 경로로 해석한다. 같은 역할의 이전 산출물과 새 출력을 함께 전달하려면
 * 반드시 Output/Input을 구분해야 한다.
 */
export function getAgentExecutionContext(
  agent: AgentName,
  prompt: string,
  workspaceRoot?: string,
): ExecutionContext | undefined {
  if (!isDocumentedAgent(agent)) return undefined;
  return EXPLICIT_MARKER_DETECTOR.test(prompt)
    ? parseExplicitExecutionContext(agent, prompt, workspaceRoot)
    : parseLegacyExecutionContext(agent, prompt, workspaceRoot);
}

/** 기존 소비자에게 활성 출력 assignment만 보여 주는 호환 adapter. */
export function getAgentExecutionAssignment(
  agent: AgentName,
  prompt: string,
  workspaceRoot?: string,
): ExecutionAssignment | undefined {
  return getAgentExecutionContext(agent, prompt, workspaceRoot)?.output;
}

export function getTaskExecutionContext(
  args: Record<string, unknown>,
  workspaceRoot?: string,
): ExecutionContext | undefined {
  const agent = args["subagent_type"];
  const prompt = args["prompt"];
  if (typeof agent !== "string" || typeof prompt !== "string") {
    return undefined;
  }
  return getAgentExecutionContext(agent as AgentName, prompt, workspaceRoot);
}

export function getTaskExecutionAssignment(
  args: Record<string, unknown>,
  workspaceRoot?: string,
): ExecutionAssignment | undefined {
  return getTaskExecutionContext(args, workspaceRoot)?.output;
}
