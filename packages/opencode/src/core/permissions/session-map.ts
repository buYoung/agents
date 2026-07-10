/**
 * permissions/session-map.ts — 세션 역할, 활성/이력 할당, 입력과 task 원장
 */

import type {
  AgentName,
  DocumentedAgent,
} from "@opencode/core/doc-protocol";
import { AGENT_NAMES as AGENT_NAMES_IMPL } from "@opencode/core/doc-protocol";
import {
  executionAssignmentKey,
  isSameExecutionAssignment,
  taskWorkItemKey,
  type ExecutionAssignment,
  type ExecutionContext,
} from "./assignment";

export interface SessionExecutionState {
  agent: DocumentedAgent;
  taskId: string;
  activeAssignment: ExecutionAssignment;
  historicalAssignments: Map<string, ExecutionAssignment>;
  readableInputs: Map<string, ExecutionAssignment>;
}

export interface TaskWorkItemReservation {
  assignment: ExecutionAssignment;
  owner:
    | { kind: "session"; sessionID: string }
    | { kind: "pending"; delegationKey: string }
    | { kind: "observed-input" }
    | { kind: "abandoned" };
}

export interface DelegationRegistration {
  parentSessionID: string;
  callID: string;
  continuedSessionID?: string;
  context: ExecutionContext;
}

export interface DelegationCompletion {
  parentSessionID: string;
  callID: string;
  childSessionID: string;
  context?: ExecutionContext;
}

interface PendingDelegation extends DelegationRegistration {
  key: string;
}

interface CompletedDelegation {
  childSessionID: string;
  context: ExecutionContext;
}

function delegationKey(parentSessionID: string, callID: string): string {
  return `${parentSessionID}\0${callID}`;
}

function sameExecutionContext(
  left: ExecutionContext,
  right: ExecutionContext,
): boolean {
  if (!isSameExecutionAssignment(left.output, right.output)) return false;
  const leftInputs = new Set(left.inputs.map(executionAssignmentKey));
  const rightInputs = new Set(right.inputs.map(executionAssignmentKey));
  return (
    leftInputs.size === rightInputs.size &&
    [...leftInputs].every((key) => rightInputs.has(key))
  );
}

function hasDistinctContextWorkItems(context: ExecutionContext): boolean {
  const outputKey = taskWorkItemKey(context.output);
  const inputKeys = context.inputs.map(taskWorkItemKey);
  return (
    !inputKeys.includes(outputKey) &&
    new Set(inputKeys).size === inputKeys.length
  );
}

/**
 * 기존 `map`/`assignmentMap` API를 유지한다. `assignmentMap`은 내부 상태의
 * active assignment만 비추는 호환 view이며 이력과 입력은 `stateMap`에 있다.
 */
export function createSessionAgentMap() {
  const map = new Map<string, AgentName>();
  const assignmentMap = new Map<string, ExecutionAssignment>();
  const stateMap = new Map<string, SessionExecutionState>();
  const workItemLedger = new Map<string, TaskWorkItemReservation>();
  const pendingDelegations = new Map<string, PendingDelegation>();
  const completedDelegations = new Map<string, CompletedDelegation>();
  const pendingTargetSessions = new Map<string, string>();
  const deletedSessions = new Set<string>();

  function updateSessionAgent(
    sessionID: string,
    agent: string | undefined,
  ): boolean {
    if (deletedSessions.has(sessionID)) return false;
    if (!agent || !(AGENT_NAMES_IMPL as readonly string[]).includes(agent)) {
      // custom/built-in 전환 시 managed 권한은 즉시 제거하되, 이미 잠긴
      // task/role 정체성은 지우지 않아 다른 managed 역할로 갈아탈 수 없게 한다.
      map.delete(sessionID);
      return true;
    }

    const managedAgent = agent as AgentName;
    const existingAgent = map.get(sessionID);
    const existingState = stateMap.get(sessionID);
    if (
      (existingAgent && existingAgent !== managedAgent) ||
      (existingState && existingState.agent !== managedAgent)
    ) {
      return false;
    }
    map.set(sessionID, managedAgent);
    return true;
  }

  function canObserveInputs(inputs: readonly ExecutionAssignment[]): boolean {
    const observed = new Map<string, ExecutionAssignment>();
    return inputs.every((input) => {
      const key = taskWorkItemKey(input);
      const priorInput = observed.get(key);
      if (priorInput && !isSameExecutionAssignment(priorInput, input)) {
        return false;
      }
      observed.set(key, input);
      const existing = workItemLedger.get(taskWorkItemKey(input));
      return !existing || isSameExecutionAssignment(existing.assignment, input);
    });
  }

  function observeInputs(inputs: readonly ExecutionAssignment[]): void {
    for (const input of inputs) {
      const key = taskWorkItemKey(input);
      if (!workItemLedger.has(key)) {
        workItemLedger.set(key, {
          assignment: input,
          owner: { kind: "observed-input" },
        });
      }
    }
  }

  function findPendingAuthorization(
    sessionID: string,
    context: ExecutionContext,
  ): PendingDelegation | undefined {
    return [...pendingDelegations.values()].find(
      (pending) =>
        sameExecutionContext(pending.context, context) &&
        pending.continuedSessionID === sessionID,
    );
  }

  function canClaimOutput(
    sessionID: string,
    assignment: ExecutionAssignment,
    authorizationKey?: string,
  ): boolean {
    const reservation = workItemLedger.get(taskWorkItemKey(assignment));
    if (!reservation) return true;
    if (!isSameExecutionAssignment(reservation.assignment, assignment)) {
      return false;
    }
    if (reservation.owner.kind === "session") {
      return reservation.owner.sessionID === sessionID;
    }
    if (reservation.owner.kind === "observed-input") return true;
    return (
      reservation.owner.kind === "pending" &&
      reservation.owner.delegationKey === authorizationKey
    );
  }

  function claimOutput(
    sessionID: string,
    assignment: ExecutionAssignment,
  ): void {
    workItemLedger.set(taskWorkItemKey(assignment), {
      assignment,
      owner: { kind: "session", sessionID },
    });
  }

  function activateExecutionContext(
    sessionID: string,
    context: ExecutionContext,
    allowTransition: boolean,
    authorizationKey?: string,
  ): boolean {
    if (deletedSessions.has(sessionID)) return false;
    if (!hasDistinctContextWorkItems(context)) return false;
    const existingRole = map.get(sessionID);
    if (existingRole && existingRole !== context.output.agent) return false;
    if (!canObserveInputs(context.inputs)) return false;

    const existingState = stateMap.get(sessionID);
    if (existingState) {
      if (
        existingState.agent !== context.output.agent ||
        existingState.taskId !== context.output.taskId
      ) {
        return false;
      }
      if (
        !isSameExecutionAssignment(
          existingState.activeAssignment,
          context.output,
        ) &&
        !allowTransition
      ) {
        return false;
      }
    }
    if (!canClaimOutput(sessionID, context.output, authorizationKey)) {
      return false;
    }

    claimOutput(sessionID, context.output);
    observeInputs(context.inputs);
    if (!existingState) {
      const state: SessionExecutionState = {
        agent: context.output.agent,
        taskId: context.output.taskId,
        activeAssignment: context.output,
        historicalAssignments: new Map(),
        readableInputs: new Map(
          context.inputs.map((input) => [executionAssignmentKey(input), input]),
        ),
      };
      stateMap.set(sessionID, state);
    } else {
      if (
        !isSameExecutionAssignment(
          existingState.activeAssignment,
          context.output,
        )
      ) {
        existingState.historicalAssignments.set(
          executionAssignmentKey(existingState.activeAssignment),
          existingState.activeAssignment,
        );
        existingState.historicalAssignments.delete(
          executionAssignmentKey(context.output),
        );
        existingState.activeAssignment = context.output;
      }
      for (const input of context.inputs) {
        existingState.readableInputs.set(executionAssignmentKey(input), input);
      }
    }
    map.set(sessionID, context.output.agent);
    assignmentMap.set(sessionID, context.output);
    return true;
  }

  /** lifecycle로 확인된 세션의 활성 할당 재확인 또는 continuation 사전 결합용. */
  function bindSessionExecutionContext(
    sessionID: string,
    context: ExecutionContext,
  ): boolean {
    const existingState = stateMap.get(sessionID);
    // 새 child의 최초 상태는 parent/call/child metadata를 확인하는
    // completeDelegation만 만든다. chat prompt만으로 fresh child를 결합하지 않는다.
    if (!existingState) return false;
    const isTransition = Boolean(
      !isSameExecutionAssignment(existingState.activeAssignment, context.output),
    );
    const authorization = findPendingAuthorization(sessionID, context);
    if (isTransition && !authorization) return false;
    return activateExecutionContext(
      sessionID,
      context,
      Boolean(authorization),
      authorization?.key,
    );
  }

  /** 기존 API adapter: 새 work item 전이는 허용하지 않는다. */
  function bindSessionAssignment(
    sessionID: string,
    assignment: ExecutionAssignment,
  ): boolean {
    return activateExecutionContext(
      sessionID,
      { output: assignment, inputs: [], protocol: "legacy" },
      false,
    );
  }

  function bindRootAssignment(
    sessionID: string,
    assignment: ExecutionAssignment,
  ): boolean {
    if (assignment.agent !== "orchestrator") return false;
    return bindSessionAssignment(sessionID, assignment);
  }

  function canRegisterDelegation(input: DelegationRegistration): boolean {
    if (deletedSessions.has(input.parentSessionID)) return false;
    if (!hasDistinctContextWorkItems(input.context)) return false;
    const key = delegationKey(input.parentSessionID, input.callID);
    if (completedDelegations.has(key)) return false;
    const existingPending = pendingDelegations.get(key);
    if (existingPending) {
      return (
        existingPending.continuedSessionID === input.continuedSessionID &&
        sameExecutionContext(existingPending.context, input.context)
      );
    }
    if (!canObserveInputs(input.context.inputs)) return false;

    const reservation = workItemLedger.get(taskWorkItemKey(input.context.output));
    if (input.continuedSessionID) {
      if (
        deletedSessions.has(input.continuedSessionID) ||
        pendingTargetSessions.has(input.continuedSessionID)
      ) {
        return false;
      }
      const state = stateMap.get(input.continuedSessionID);
      if (
        !state ||
        state.agent !== input.context.output.agent ||
        state.taskId !== input.context.output.taskId
      ) {
        return false;
      }
      if (!reservation) return true;
      return (
        isSameExecutionAssignment(reservation.assignment, input.context.output) &&
        reservation.owner.kind === "session" &&
        reservation.owner.sessionID === input.continuedSessionID
      );
    }

    // 새 child 위임은 기존/관찰/중단 work item을 재사용할 수 없다.
    return reservation === undefined;
  }

  function registerDelegation(input: DelegationRegistration): boolean {
    if (!canRegisterDelegation(input)) return false;
    const key = delegationKey(input.parentSessionID, input.callID);
    if (pendingDelegations.has(key)) return true;
    const pending: PendingDelegation = { ...input, key };
    pendingDelegations.set(key, pending);
    if (input.continuedSessionID) {
      pendingTargetSessions.set(input.continuedSessionID, key);
    }
    const reservationKey = taskWorkItemKey(input.context.output);
    if (!workItemLedger.has(reservationKey)) {
      workItemLedger.set(reservationKey, {
        assignment: input.context.output,
        owner: { kind: "pending", delegationKey: key },
      });
    }
    observeInputs(input.context.inputs);
    return true;
  }

  function completeDelegation(input: DelegationCompletion): boolean {
    const key = delegationKey(input.parentSessionID, input.callID);
    if (
      deletedSessions.has(input.parentSessionID) ||
      deletedSessions.has(input.childSessionID)
    ) {
      return false;
    }
    const completed = completedDelegations.get(key);
    if (completed) {
      return (
        completed.childSessionID === input.childSessionID &&
        (!input.context || sameExecutionContext(completed.context, input.context))
      );
    }
    const pending = pendingDelegations.get(key);
    if (
      !pending ||
      (pending.continuedSessionID &&
        pending.continuedSessionID !== input.childSessionID) ||
      (input.context && !sameExecutionContext(pending.context, input.context))
    ) {
      return false;
    }
    if (
      !activateExecutionContext(
        input.childSessionID,
        pending.context,
        true,
        pending.key,
      )
    ) {
      return false;
    }
    pendingDelegations.delete(key);
    if (pending.continuedSessionID) {
      pendingTargetSessions.delete(pending.continuedSessionID);
    }
    completedDelegations.set(key, {
      childSessionID: input.childSessionID,
      context: pending.context,
    });
    return true;
  }

  function failDelegation(parentSessionID: string, callID: string): void {
    const key = delegationKey(parentSessionID, callID);
    const pending = pendingDelegations.get(key);
    if (!pending) return;
    pendingDelegations.delete(key);
    if (pending.continuedSessionID) {
      pendingTargetSessions.delete(pending.continuedSessionID);
    }
    const reservationKey = taskWorkItemKey(pending.context.output);
    const reservation = workItemLedger.get(reservationKey);
    if (
      reservation?.owner.kind === "pending" &&
      reservation.owner.delegationKey === key
    ) {
      workItemLedger.set(reservationKey, {
        assignment: reservation.assignment,
        owner: { kind: "abandoned" },
      });
    }
  }

  function canReadSessionArtifact(
    sessionID: string,
    assignment: ExecutionAssignment,
  ): boolean {
    const state = stateMap.get(sessionID);
    if (!state) return false;
    const key = executionAssignmentKey(assignment);
    return (
      isSameExecutionAssignment(state.activeAssignment, assignment) ||
      state.historicalAssignments.has(key) ||
      state.readableInputs.has(key)
    );
  }

  function deleteSession(sessionID: string): void {
    deletedSessions.add(sessionID);
    map.delete(sessionID);
    assignmentMap.delete(sessionID);
    stateMap.delete(sessionID);
    for (const pending of [...pendingDelegations.values()]) {
      if (
        pending.parentSessionID === sessionID ||
        pending.continuedSessionID === sessionID
      ) {
        failDelegation(pending.parentSessionID, pending.callID);
      }
    }
  }

  return {
    map,
    assignmentMap,
    stateMap,
    workItemLedger,
    updateSessionAgent,
    bindSessionAssignment,
    bindSessionExecutionContext,
    bindRootAssignment,
    canRegisterDelegation,
    registerDelegation,
    completeDelegation,
    failDelegation,
    canReadSessionArtifact,
    deleteSession,
  };
}

/** 세션 ID로 현재 managed agent 이름을 조회한다. */
export function resolveAgent(
  sessionID: string,
  sessionAgentMap: Map<string, AgentName>,
): AgentName | undefined {
  return sessionAgentMap.get(sessionID);
}
