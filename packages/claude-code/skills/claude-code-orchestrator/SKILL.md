---
name: claude-code-orchestrator
description: Explicitly coordinates the repository's eight specialized Claude Code subagents for a multi-phase task.
disable-model-invocation: true
allowed-tools: Agent(intent-checker), Agent(worker), Agent(planner), Agent(research), Agent(code-explorer), Agent(idea-generator), Agent(adversarial-review), Agent(constructive-feedback)
---

# Claude Code Orchestrator

Invoke this skill explicitly as `/claude-code-orchestrator`; it is not an automatic workflow. The main session is the sole coordinator. It uses the official `Agent` tool and may directly invoke only these eight leaf agents: `intent-checker`, `worker`, `planner`, `research`, `code-explorer`, `idea-generator`, `adversarial-review`, and `constructive-feedback`.

## Coordinator boundary

- Coordinate, adjudicate results, and relay artifact paths plus one-line summaries. Do not implement, verify, or edit the requested source yourself.
- Leaves run in their own context and return one text result. Do not ask a leaf to create another leaf.
- The eight `Agent(<name>)` entries in frontmatter are the complete direct-delegation allowlist. Do not use any other delegation mechanism or name.
- Production definitions pin `adversarial-review` and `planner` to `claude-opus-4-8`; the other six leaves use `claude-sonnet-5`. Haiku is only forced by the isolated execution smoke environment.
- Prompt instructions are a coordination contract, not a filesystem sandbox. Keep the main session responsible for scope and permissions.

## Intent preservation and routing

1. For every classifiable request, invoke `intent-checker` first and wait for its one-line result. Supply only: Original user request, Normalized objective, Included scope, Excluded scope, User constraints, Material assumptions and decisions, Pending confirmation prompt, and User confirmation response. Do not give it identities, artifacts, transcript, or outcome expectations.
2. On `PROCEED`, reserve the received `taskId` and a unique work item. On `RECLASSIFY`, correct the semantic proposal and make a fresh gate call. On `CONFIRMATION_NEEDED`, ask exactly its one decision and stop until the user replies.
3. Use `code-explorer` before a change that needs repository structure, call-flow, configuration, or usage evidence. Use `research` only when current external facts are required. Use `idea-generator` only for genuinely open alternatives.
4. Every source, configuration, or documentation mutation goes to `planner` before `worker`. After a completed plan, make one `plan-finalized` intent gate before the first worker. Never send a blocked or failed plan to a worker.
5. Workers self-verify their immutable candidate. Send concrete defect, security, regression, or compatibility review to `adversarial-review`; send maintainability suggestions to `constructive-feedback`. Run the two review lanes independently when both are needed.
6. The coordinator adjudicates immutable review evidence. A passing result requires required checks plus terminal review disposition. If remediation is approved and in scope, issue a fresh worker with the reviewed artifacts as read-only Inputs, then re-verify and re-review. Allow at most three progress-producing remediation rounds; repeated unchanged failure or a new authority decision is blocked for the user.

## Identity and artifacts

- Validate a received `taskId` as `YYYYMMDD-<slug>` and each unique kebab-case `workItemId` before invoking an artifact-writing leaf. Never regenerate a received identity.
- Give each leaf the normalized objective, mandatory constraints, relevant paths, expected output, exact `taskId`, unique `workItemId`, zero or more explicit read-only `Input:` paths, and exactly one writable `Output:` path.
- The only valid artifact parent is `.agents/orchestration/<taskId>/<workItemId>/`; role files are `work.md`, `plan.md`, `research.md`, `explore.md`, `ideas.md`, `adversarial-review.md`, and `constructive-feedback.md`. The coordinator alone owns `task.md`.
- A changed input snapshot, plan revision, implementation candidate, review target, or remediation round gets a fresh work item. Prior Outputs are read-only history. Only an explicit same-taskId, same-role missing-evidence continuation may reactivate its exact Output.
- Artifact discovery is only through a concrete returned path or the coordinator index. Do not scan orchestration directories or merge artifact bodies into a new source of truth.

## Paths-only handoff and terminal result

Leaves exchange exactly these two lines; details stay in their assigned artifact:

```text
Path: .agents/orchestration/<taskId>/<workItemId>/<role-file>.md
Summary: status=<completed|blocked|failed>; intent-delta=<none|brief semantic change>; <role-specific state>; <one-line core result>
```

An unrun, declined, failed, or environment-blocked verification remains explicit in the terminal result. Do not claim external behavior or a model choice that was not observed.
