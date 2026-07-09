/**
 * doc-protocol/rules.ts — 에이전트 프롬프트 공유 규칙 문구
 */

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
- A receiving subagent reads that file directly only when its role and
  permission policy allow it. The orchestrator passes returned paths and
  summaries forward without reading full handoff content.
- Brief excerpts are acceptable only when a fragment is essential context for
  the next agent to START (not to complete) the work.

Example return format:
  Path: .agents/20260702-slug/plan.md
  Summary: Identified 3 files to change; no v1 time-logic found.
`.trim();

/**
 * (b) Append-only / never-Edit rule.
 *
 * Each agent appends exclusively to its own file.
 * The orchestrator's index file (`task.md`) is orchestrator-only.
 */
export const APPEND_ONLY_RULE = `
## Append-Only Rule

You own exactly ONE file inside \`.agents/<taskId>/\`.
Your file is listed in the map below — write ONLY to that file.

\`\`\`yaml
orchestrator: task.md
worker: work.md
planner: plan.md
idea-generator: ideas.md
research: research.md
code-explorer: explore.md
adversarial-review: adversarial-review.md
constructive-feedback: constructive-feedback.md
\`\`\`

> \`intent-checker\` owns no file — it is a stateless gate and is not bound by this rule.

Rules:
1. Create your handoff file directly if it does not exist; append to it only
   when it is already available as an input artifact. Do not read or list
   output paths just to check whether they exist. Never overwrite or replace
   existing content in your handoff file.
2. **NEVER write to another agent's file.** Cross-file writes corrupt the
   1:1 ownership contract and will be treated as a violation.
3. \`task.md\` is the orchestrator's master index — all other agents are
   READ-ONLY with respect to that file.
4. Reading files in \`.agents/<taskId>/\` is permitted only when the agent role
   and permission policy allow it; writing is restricted to your own file only.
`.trim();

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

\`\`\`yaml
task_overview_progress_index: task.md  # orchestrator-owned
implementation_plan_runId: plan.md  # planner-owned
work_output_code_changes: work.md  # worker-owned
exploration_findings: explore.md
research_notes: research.md
creative_design_ideas: ideas.md
adversarial_review_results: adversarial-review.md
constructive_feedback: constructive-feedback.md
\`\`\`

Rules:
1. **Return path + one-line summary**, never full content, when handing off
   information between agents. A receiving subagent reads the file directly
   only when its role and permission policy allow it.
2. If a fact already exists in another agent's file, reference it by path —
   do NOT copy it into your own file (facts must not fork across files).
3. The orchestrator builds the master index from returned paths and one-line
   summaries; it does not need to read subagent handoff content. Subagents do
   not update \`task.md\`.
`.trim();

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
