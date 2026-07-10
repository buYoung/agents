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
- Put details in your assigned handoff file: \`.agents/<taskId>/<workItemId>/<your-file>.md\`.
- Receivers read returned paths only when their role and permission policy allow it.
- Include a short excerpt only when it is required to start the next step.
- Downstream agents discover artifacts only from the concrete \`Path:\` returned by the producing agent or from the orchestrator index. Never scan work-item directories.

Example return format:
  Path: .agents/20260702-slug/planner-01/plan.md
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

Each artifact-writing execution owns exactly one file under
\`.agents/<taskId>/<workItemId>/\`. The orchestrator assigns a unique
\`workItemId\` for every delegation, including repeated or parallel calls to
the same role. Write only to that assigned path.

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
1. Require both a valid taskId and the exact assigned workItemId before writing. Never invent, reuse, or normalize either identifier.
2. Create your file if absent; append only when the same concrete path was explicitly provided for continuation.
3. Never overwrite or replace existing handoff content.
4. Never write another agent's mapped filename or another work item's file. \`task.md\` is orchestrator-owned; all other agents treat it as read-only.
5. Reading run files is allowed only through explicit concrete paths when the role and permission policy allow it.
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
4. Subagents do not update \`task.md\`; the orchestrator builds its own indexed work-item artifact from returned concrete paths and summaries.
`.trim();

/**
 * (d) taskId format and ownership rule.
 *
 * Defines who generates the taskId, what format it takes, and how agents
 * reference it without re-deriving it.
 */
export const TASKID_RULE = `
## Run Identity Rule

Format: \`YYYYMMDD-<slug>\`, for example \`20260702-auth-login\`.

Generation:
- The orchestrator allocates a new taskId from its session date plus a descriptive slug before the first artifact-writing delegation.
- The orchestrator threads that taskId and a unique workItemId through later subagent calls.
- Artifact-writing leaf agents never generate either identifier; they stop when the exact assignment is missing.

Rules:
- If you receive a taskId, use it. Do not re-derive, regenerate, or replace it.
- Do not assume today's date is the taskId date.
- Every artifact-writing delegation must also receive a unique kebab-case workItemId, such as \`planner-01\` or \`worker-parse-fix-02\`. The orchestrator allocates it once and never reuses it within the taskId.
- If either identifier is missing or invalid, stop before writing and request the missing identity. Do not substitute an absolute path, path separator, \`..\`, or another task's identifier.
- Do not hard-code or derive a different handoff path. Use \`runDocPath(taskId, workItemId, agentName)\` to resolve \`.agents/<taskId>/<workItemId>/<your-file>.md\`.
- Return the exact concrete path so downstream agents do not need directory discovery.
- All run files stay under the canonical workspace \`.agents/<taskId>/<workItemId>/\` scope.
`.trim();
