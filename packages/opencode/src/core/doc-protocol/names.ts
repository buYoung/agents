/**
 * doc-protocol/names.ts — 에이전트 이름·문서 맵 (데이터)
 */

/**
 * Canonical names for all agents in the agents plugin.
 *
 * SSOT: this is the single source of truth for agent names.
 * `permissions/` imports this type — do NOT redeclare it elsewhere.
 */
export type AgentName =
  | "orchestrator"
  | "intent-checker"
  | "worker"
  | "planner"
  | "idea-generator"
  | "research"
  | "code-explorer"
  | "adversarial-review"
  | "constructive-feedback";

/**
 * Agents that own a handoff file inside `.agents/<taskId>/`.
 * Each documented agent maps 1:1 to exactly one writable file.
 *
 * `intent-checker` is excluded — it is a stateless gate that returns
 * a one-line answer to the orchestrator and writes no file.
 */
export type DocumentedAgent = Exclude<AgentName, "intent-checker">;

/**
 * Ordered list of all agent names.
 * Used by `permissions/` to build `AGENT_NAMES` / `SUBAGENT_NAMES`.
 */
export const AGENT_NAMES: readonly AgentName[] = [
  "orchestrator",
  "intent-checker",
  "worker",
  "planner",
  "idea-generator",
  "research",
  "code-explorer",
  "adversarial-review",
  "constructive-feedback",
] as const;

/**
 * Agents that own a handoff file (subset of {@link AGENT_NAMES}).
 * Used by `runDocPath` and the append-only / SSOT rule tables.
 */
export const DOCUMENTED_AGENTS: readonly DocumentedAgent[] = (
  AGENT_NAMES as readonly AgentName[]
).filter((name): name is DocumentedAgent => name !== "intent-checker");

/**
 * Maps each **documented** agent to the bare filename it owns and appends to.
 * No two agents share a file — one writer per file, enforced by prompt rules.
 *
 * `intent-checker` is intentionally absent: it writes no file.
 */
export const AGENT_DOC_MAP: Record<DocumentedAgent, string> = {
  orchestrator: "task.md",
  worker: "work.md",
  planner: "plan.md",
  "idea-generator": "ideas.md",
  research: "research.md",
  "code-explorer": "explore.md",
  "adversarial-review": "adversarial-review.md",
  "constructive-feedback": "constructive-feedback.md",
} as const;
