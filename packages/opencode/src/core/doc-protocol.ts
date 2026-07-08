/**
 * doc-protocol.ts
 *
 * Run-directory communication contract for the agents plugin.
 *
 * This module owns:
 *   - The run-directory root path constant (`RUN_DIR_ROOT`)
 *   - The 1:1 agent → filename map (`AGENT_DOC_MAP`)
 *   - The path-builder helper (`runDocPath`)
 *   - Shared prompt-block strings imported by every agent module
 *
 * No imports from `agents/` or `permissions.ts` — this module is
 * imported BY them, never the reverse.
 */

// ---------------------------------------------------------------------------
// Run-directory root
// ---------------------------------------------------------------------------

/** Root directory that contains every per-run task folder. */
export const RUN_DIR_ROOT = ".agents" as const;

// ---------------------------------------------------------------------------
// Agent name union
// ---------------------------------------------------------------------------

/**
 * Canonical names for all 9 agents in the agents plugin.
 *
 * SSOT: this is the single source of truth for agent names.
 * `permissions.ts` imports this type — do NOT redeclare it elsewhere.
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
 * Used by `permissions.ts` to build `AGENT_NAMES` / `SUBAGENT_NAMES`.
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

// ---------------------------------------------------------------------------
// 1:1 documented-agent → filename map
// ---------------------------------------------------------------------------

/**
 * Maps each **documented** agent to the bare filename it owns and appends to.
 * No two agents share a file — one writer per file, enforced by prompt rules.
 *
 * `intent-checker` is intentionally absent: it writes no file.
 *
 * Full path for any given taskId: `.agents/<taskId>/<filename>`
 * Use `runDocPath(taskId, agent)` to build the complete path.
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

// ---------------------------------------------------------------------------
// Path helper
// ---------------------------------------------------------------------------

/**
 * Returns the full relative path for a documented agent's handoff file.
 *
 * @param taskId  Task identifier in `YYYYMMDD-<slug>` format,
 *                e.g. `"20260702-agents-plugin"`.
 * @param agent   One of the {@link DocumentedAgent} values (not `intent-checker`).
 * @returns       `.agents/<taskId>/<filename>` — consistent with the
 *                `.agents/**` scope the permission layer enforces.
 *
 * @example
 *   runDocPath("20260702-auth-login", "planner")
 *   // → ".agents/20260702-auth-login/plan.md"
 */
export function runDocPath(taskId: string, agent: DocumentedAgent): string {
  return `${RUN_DIR_ROOT}/${taskId}/${AGENT_DOC_MAP[agent]}`;
}

// ---------------------------------------------------------------------------
// Shared prompt-block strings
// (a) PATHS_ONLY_RULE
// ---------------------------------------------------------------------------

/**
 * (a) Paths-only delegation rule.
 *
 * Embed this block in agent prompts to enforce the "paths only, no full
 * content" delegation discipline used across the agents plugin.
 */
export const PATHS_ONLY_RULE = `
## Paths-Only Delegation Rule

When delegating work to another agent or returning results to the orchestrator:
- Embed **file paths and one-line summaries only** — never the full working content.
- Write detailed findings, plans, or output to your handoff file
  (\`.agents/<taskId>/<your-file>.md\`) and **return the path + one-line summary**.
- The receiving agent reads that file directly; do NOT paste its contents into
  the task prompt or return value.
- Brief excerpts are acceptable only when a fragment is essential context for
  the next agent to START (not to complete) the work.

Example return format:
  Path: .agents/20260702-slug/plan.md
  Summary: Identified 3 files to change; no v1 time-logic found.
`.trim();

// ---------------------------------------------------------------------------
// (b) APPEND_ONLY_RULE
// ---------------------------------------------------------------------------

/**
 * (b) Append-only / never-Edit rule.
 *
 * Each agent appends exclusively to its own file.
 * The orchestrator's index file (`task.md`) is orchestrator-only.
 */
export const APPEND_ONLY_RULE = `
## Append-Only Rule

You own exactly ONE file inside \`.agents/<taskId>/\`.
Your file is listed in the table below — write ONLY to that file.

| Agent                  | Owned file                   |
|------------------------|------------------------------|
| orchestrator           | task.md                      |
| worker                 | work.md                      |
| planner                | plan.md                      |
| idea-generator         | ideas.md                     |
| research               | research.md                  |
| code-explorer          | explore.md                   |
| adversarial-review     | adversarial-review.md        |
| constructive-feedback  | constructive-feedback.md     |

> \`intent-checker\` owns no file — it is a stateless gate and is not bound by this rule.

Rules:
1. **ALWAYS APPEND** — never overwrite, never use the Edit tool to replace
   existing content in your handoff file.
2. **NEVER write to another agent's file.** Cross-file writes corrupt the
   1:1 ownership contract and will be treated as a violation.
3. \`task.md\` is the orchestrator's master index — all other agents are
   READ-ONLY with respect to that file.
4. Reading any file in \`.agents/<taskId>/\` is permitted; writing is
   restricted to your own file only.
`.trim();

// ---------------------------------------------------------------------------
// (c) SSOT_RULE
// ---------------------------------------------------------------------------

/**
 * (c) Single Source of Truth (SSOT) discipline.
 *
 * Each fact lives in exactly one authoritative file.
 * Agents reference that file rather than duplicating its content.
 */
export const SSOT_RULE = `
## Single Source of Truth (SSOT) Rule

Every piece of information has exactly ONE authoritative file inside
\`.agents/<taskId>/\`:

| Information type              | Authoritative file            |
|-------------------------------|-------------------------------|
| Task overview, progress index | task.md  (orchestrator-owned) |
| Implementation plan, runId    | plan.md  (planner-owned)      |
| Work output, code changes     | work.md  (worker-owned)       |
| Exploration findings          | explore.md                    |
| Research notes                | research.md                   |
| Creative/design ideas         | ideas.md                      |
| Adversarial review results    | adversarial-review.md         |
| Constructive feedback         | constructive-feedback.md      |

Rules:
1. **Return path + one-line summary**, never full content, when handing off
   information between agents.  The receiving agent reads the file directly.
2. If a fact already exists in another agent's file, reference it by path —
   do NOT copy it into your own file (facts must not fork across files).
3. The orchestrator reads handoff files to build the master index; subagents
   do not update \`task.md\`.
`.trim();

// ---------------------------------------------------------------------------
// (d) TASKID_RULE
// ---------------------------------------------------------------------------

/**
 * (d) taskId format and ownership rule.
 *
 * Defines who generates the taskId, what format it takes, and how agents
 * reference it without re-deriving it.
 */
export const TASKID_RULE = `
## Task ID (taskId) Rule

### Format
  taskId = YYYYMMDD-<slug>
  Examples:
    20260702-auth-login
    20260702-agents-plugin

### Who generates it
Only a **bash-capable agent** may generate the taskId by running a date command:
  \`date +%Y%m%d\`-<descriptive-slug>

Typically this is \`planner\` or \`worker\`. The orchestrator does not run bash
only to create a taskId. If it must first call an artifact-writing subagent that
cannot run bash, it uses the run date already embedded in its prompt and threads
that taskId before dependent handoff files are written.

### Who threads it
The **orchestrator** threads the taskId through every subsequent subagent call
as an explicit parameter, whether it received the value from a subagent or
created it for a non-bash first delegation.

### What agents must NOT do
- Do NOT re-derive or regenerate the taskId if you already received it.
- Do NOT hard-code a directory path — reference your bare filename and let
  \`runDocPath(taskId, agentName)\` resolve the full path:
    .agents/<taskId>/<your-file>.md
- Do NOT assume the current date is the taskId date; use the value the
  orchestrator passed you.

### Scope
All run files live under \`.agents/<taskId>/\`, which matches the
\`.agents/**\` read+write scope granted by the permission layer.
`.trim();
