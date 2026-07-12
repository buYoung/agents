/**
 * Run-directory path constants and helpers.
 */

import { AGENT_DOC_MAP, type DocumentedAgent } from "./names";

/** Root directory that contains every orchestration task folder. */
export const RUN_DIR_ROOT = ".agents/orchestration" as const;

/** Canonical task and work-item identifier formats used in run paths. */
export const TASK_ID_PATTERN = /^\d{8}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const WORK_ITEM_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidTaskId(taskId: string): boolean {
  return TASK_ID_PATTERN.test(taskId);
}

export function isValidWorkItemId(workItemId: string): boolean {
  return (
    workItemId.length <= 80 && WORK_ITEM_ID_PATTERN.test(workItemId)
  );
}

function assertRunIdentifier(
  value: string,
  label: "taskId" | "workItemId",
  validator: (candidate: string) => boolean,
): void {
  if (!validator(value)) {
    throw new Error(`invalid ${label}: ${value}`);
  }
}

/**
 * Returns the full relative path for a documented agent's handoff file.
 *
 * @param taskId  Task identifier in `YYYYMMDD-<slug>` format,
 *                e.g. `"20260702-agents-plugin"`.
 * @param workItemId Unique identifier assigned once per delegation/execution.
 * @param agent   One of the {@link DocumentedAgent} values (not `intent-checker`).
 * @returns       `.agents/orchestration/<taskId>/<workItemId>/<filename>`,
 *                consistent with the run-artifact scope the permission layer enforces.
 */
export function runDocPath(
  taskId: string,
  workItemId: string,
  agent: DocumentedAgent,
): string {
  assertRunIdentifier(taskId, "taskId", isValidTaskId);
  assertRunIdentifier(workItemId, "workItemId", isValidWorkItemId);
  return `${RUN_DIR_ROOT}/${taskId}/${workItemId}/${AGENT_DOC_MAP[agent]}`;
}
