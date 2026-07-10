/**
 * permissions/session-map.ts — 세션 → 에이전트 맵
 */

import type { AgentName } from "@opencode/core/doc-protocol";
import { AGENT_NAMES as AGENT_NAMES_IMPL } from "@opencode/core/doc-protocol";
import {
  isSameExecutionAssignment,
  type ExecutionAssignment,
} from "./assignment";

/**
 * 세션→에이전트 맵과 업데이트 함수를 함께 반환한다.
 * chat.message 훅에서 `updateSessionAgent`를 호출해 맵을 유지하고,
 * tool.execute.before 훅에서 `resolveAgent`로 호출자를 조회한다.
 */
export function createSessionAgentMap(): {
  map: Map<string, AgentName>;
  assignmentMap: Map<string, ExecutionAssignment>;
  updateSessionAgent: (sessionID: string, agent: string | undefined) => void;
  bindSessionAssignment: (
    sessionID: string,
    assignment: ExecutionAssignment,
  ) => boolean;
  deleteSession: (sessionID: string) => void;
} {
  const map = new Map<string, AgentName>();
  const assignmentMap = new Map<string, ExecutionAssignment>();

  function updateSessionAgent(
    sessionID: string,
    agent: string | undefined,
  ): void {
    if (!agent) {
      map.delete(sessionID);
      assignmentMap.delete(sessionID);
      return;
    }
    // 알려진 에이전트 이름만 저장한다. built-in/custom/unknown 전환은
    // 이전 역할의 권한이 남지 않도록 즉시 매핑을 지운다.
    if ((AGENT_NAMES_IMPL as readonly string[]).includes(agent)) {
      map.set(sessionID, agent as AgentName);
      const assignment = assignmentMap.get(sessionID);
      if (assignment && assignment.agent !== agent) {
        assignmentMap.delete(sessionID);
      }
    } else {
      map.delete(sessionID);
      assignmentMap.delete(sessionID);
    }
  }

  function bindSessionAssignment(
    sessionID: string,
    assignment: ExecutionAssignment,
  ): boolean {
    const existing = assignmentMap.get(sessionID);
    if (existing && !isSameExecutionAssignment(existing, assignment)) {
      return false;
    }
    assignmentMap.set(sessionID, assignment);
    return true;
  }

  function deleteSession(sessionID: string): void {
    map.delete(sessionID);
    assignmentMap.delete(sessionID);
  }

  return {
    map,
    assignmentMap,
    updateSessionAgent,
    bindSessionAssignment,
    deleteSession,
  };
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
