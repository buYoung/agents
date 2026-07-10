/**
 * permissions/assignment.ts — task 실행에 할당된 정확한 산출물 신원
 */

import {
  DOCUMENTED_AGENTS,
  type AgentName,
  type DocumentedAgent,
} from "@opencode/core/doc-protocol";
import { getRunArtifactIdentity } from "./path";

export interface ExecutionAssignment {
  agent: DocumentedAgent;
  taskId: string;
  workItemId: string;
  artifactPath: string;
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

/**
 * 실제 메시지에 들어 있는 정규 산출물 경로에서 실행 할당을 해소한다.
 * 같은 역할에 대해 서로 다른 두 경로가 있으면 모호하므로 결합하지 않는다.
 */
export function getAgentExecutionAssignment(
  agent: AgentName,
  prompt: string,
  workspaceRoot?: string,
): ExecutionAssignment | undefined {
  if (!isDocumentedAgent(agent)) return undefined;

  const identities = new Map<string, ExecutionAssignment>();
  const pathPattern = /\.agents\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.md/g;
  for (const match of prompt.matchAll(pathPattern)) {
    const artifactPath = match[0];
    const identity = getRunArtifactIdentity(artifactPath, workspaceRoot);
    if (!identity || identity.owner !== agent) continue;

    const assignment: ExecutionAssignment = {
      agent,
      taskId: identity.taskId,
      workItemId: identity.workItemId,
      artifactPath: identity.relativePath,
    };
    identities.set(
      `${assignment.taskId}\0${assignment.workItemId}\0${assignment.agent}`,
      assignment,
    );
  }

  return identities.size === 1 ? [...identities.values()][0] : undefined;
}

export function getTaskExecutionAssignment(
  args: Record<string, unknown>,
  workspaceRoot?: string,
): ExecutionAssignment | undefined {
  const agent = args["subagent_type"];
  const prompt = args["prompt"];
  if (typeof agent !== "string" || typeof prompt !== "string") {
    return undefined;
  }
  return getAgentExecutionAssignment(agent as AgentName, prompt, workspaceRoot);
}
