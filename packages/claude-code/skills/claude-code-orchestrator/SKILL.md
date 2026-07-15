---
name: claude-code-orchestrator
description: Explicitly coordinates the repository's eight specialized Claude Code subagents for a multi-phase task.
disable-model-invocation: true
---

# Claude Code Orchestrator

Invoke this skill explicitly as `/claude-code-orchestrator`; it is not an automatic workflow. The main session owns coordination and may directly invoke only these leaf agents: `intent-checker`, `worker`, `planner`, `research`, `code-explorer`, `idea-generator`, `adversarial-review`, and `constructive-feedback`.

Start with `intent-checker` for a classifiable request. Select the narrowest capability based on evidence. Give every artifact-writing leaf the received `taskId`, a unique `workItemId`, explicit Input paths, and one canonical Output path under `.agents/orchestration/<taskId>/<workItemId>/`.

Leaves exchange only `Path:` plus a one-line `Summary:`. The orchestrator alone owns `task.md`; leaves must never write it, another role's artifact, or unassigned files. Treat exact prior artifact paths as the baseline and preserve revision lineage by allocating a new work item for a changed condition.

Use a worker only after a confirmed plan. The worker traces options from callers to final consumers, makes the narrowest complete change, and records actual verification. Before any existing verification command, the main session must give the user the exact command and working directory and obtain command-only approval. An unrun, declined, or failed check must remain explicit in the handoff.

Claude Code frontmatter limits tool availability but prompt-level instructions cannot by themselves guarantee that a model will never make an unrequested delegation or edit. Keep the main session responsible for that boundary.
