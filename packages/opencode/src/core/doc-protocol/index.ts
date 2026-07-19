/**
 * doc-protocol — Run-directory communication contract for the agents plugin.
 *
 * This module owns:
 *   - The run-directory root path constant (`RUN_DIR_ROOT`)
 *   - The 1:1 agent-to-filename map (`AGENT_DOC_MAP`)
 *   - The path-builder helper (`runDocPath`)
 *   - Shared prompt-block strings imported by every agent module
 *
 * No imports from `agents/` or `permissions/`; this module is
 * imported BY them, never the reverse.
 */

export type { AgentName, DocumentedAgent } from "./names";
export {
  AGENT_NAMES,
  DOCUMENTED_AGENTS,
  AGENT_DOC_MAP,
} from "./names";

export {
  RUN_DIR_ROOT,
  TASK_ID_PATTERN,
  WORK_ITEM_ID_PATTERN,
  isValidTaskId,
  isValidWorkItemId,
  runDocPath,
} from "./paths";

export {
  PATHS_ONLY_RULE,
  APPEND_ONLY_RULE,
  SSOT_RULE,
  TASKID_RULE,
  STATUS_RETURN_RULE,
} from "./rules";
