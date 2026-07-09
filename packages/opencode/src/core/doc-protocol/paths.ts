/**
 * Run-directory path constants and helpers.
 */

import { AGENT_DOC_MAP, type DocumentedAgent } from "./names";

/** Root directory that contains every per-run task folder. */
export const RUN_DIR_ROOT = ".agents" as const;

/**
 * Returns the full relative path for a documented agent's handoff file.
 *
 * @param taskId  Task identifier in `YYYYMMDD-<slug>` format,
 *                e.g. `"20260702-agents-plugin"`.
 * @param agent   One of the {@link DocumentedAgent} values (not `intent-checker`).
 * @returns       `.agents/<taskId>/<filename>`, consistent with the
 *                `.agents/**` scope the permission layer enforces.
 */
export function runDocPath(taskId: string, agent: DocumentedAgent): string {
  return `${RUN_DIR_ROOT}/${taskId}/${AGENT_DOC_MAP[agent]}`;
}
