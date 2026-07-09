/**
 * Shared run-document protocol blocks embedded in agent prompts.
 */

/**
 * (a) Paths-only delegation rule.
 *
 * Embed this block in agent prompts to enforce the "paths only, no full
 * content" delegation discipline used across the agents plugin.
 */
export const PATHS_ONLY_RULE = `
## Paths-Only Handoff

When delegating or returning results:
- Return only \`Path:\` plus a one-line \`Summary:\`. Do not inline full working content.
- Put details in your own handoff file: \`.agents/<taskId>/<your-file>.md\`.
- Receivers read returned paths only when their role and permission policy allow it.
- Include a short excerpt only when it is required to start the next step.

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
## Handoff File Ownership

Each artifact-writing agent owns exactly one file under \`.agents/<taskId>/\`.
Write only to your mapped file.

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

\`intent-checker\` is stateless and owns no file.

Rules:
1. Create your file if absent; append only when it already exists as an input artifact.
2. Never overwrite or replace existing handoff content.
3. Never write another agent's file. \`task.md\` is orchestrator-owned; all other agents treat it as read-only.
4. Reading \`.agents/<taskId>/\` files is allowed only when the role and permission policy allow it.
`.trim();

/**
 * (c) Single Source of Truth (SSOT) discipline.
 *
 * Each fact lives in exactly one authoritative file.
 * Agents reference that file rather than duplicating its content.
 */
export const SSOT_RULE = `
## Single Source of Truth

\`\`\`yaml
task.md: orchestrator overview, progress, and index
plan.md: planner implementation path
work.md: worker changes and verification
explore.md: code-explorer findings
research.md: research findings and sources
ideas.md: idea-generator alternatives
adversarial-review.md: adversarial risks and failures
constructive-feedback.md: improvement feedback
\`\`\`

Rules:
1. Store each fact in one authoritative file only.
2. If a fact already exists elsewhere, reference its path instead of copying it.
3. Hand off with \`Path:\` and one-line \`Summary:\` only.
4. Subagents do not update \`task.md\`; the orchestrator builds that index from returned paths and summaries.
`.trim();

/**
 * (d) taskId format and ownership rule.
 *
 * Defines who generates the taskId, what format it takes, and how agents
 * reference it without re-deriving it.
 */
export const TASKID_RULE = `
## Task ID (taskId) Rule

Format: \`YYYYMMDD-<slug>\`, for example \`20260702-auth-login\`.

Generation:
- Only a bash-capable agent may create a new taskId with \`date +%Y%m%d\` plus a descriptive slug.
- The orchestrator threads the chosen taskId through later subagent calls.
- If the first artifact-writing subagent cannot run bash, the orchestrator may use its embedded run date.

Rules:
- If you receive a taskId, use it. Do not re-derive, regenerate, or replace it.
- Do not assume today's date is the taskId date.
- Do not hard-code a full handoff path. Use your bare filename and let \`runDocPath(taskId, agentName)\` resolve \`.agents/<taskId>/<your-file>.md\`.
- All run files stay under \`.agents/<taskId>/\`, matching the permission layer's \`.agents/**\` scope.
`.trim();
