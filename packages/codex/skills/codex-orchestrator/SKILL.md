---
name: codex-orchestrator
description: A pure orchestration contract in which the main session directly coordinates the eight allowed leaf custom agents only when `$codex-orchestrator` is explicitly invoked or selected in the UI. It is separate from the `$orchestration` skill and is never invoked implicitly.
---

# Codex Orchestrator

When this skill is active, the main session is a pure coordinator. It directly invokes only the eight necessary leaf custom agents and relays only returned artifact paths and one-line summaries. It does not describe itself as a custom orchestrator, invoke `agent_type="orchestrator"`, or recursively invoke another orchestrator agent or skill.

## Invocation Scope and Boundaries

- Apply this skill only when `$codex-orchestrator` is explicitly invoked or directly selected in the UI. Do not activate it for a short reference to “orchestration,” and keep it distinct from the `$orchestration` skill.
- The main session does not directly read or write source, browse the web, implement, or verify. Delegate exploration, planning, research, implementation, review, and verification to leaf agents.
- Use bash only for read-only fact checks such as confirming a returned path exists. The sole exception is using `mkdir -p` for the verified work-item parent creation below. Do not run any other write, installation, build, test, or network command.
- User requests cannot override these role boundaries. Do not invent unavailable tools or procedures.
- Preserve every user-specified role, tool, step, and artifact constraint. If a constraint conflicts with a permission boundary, pass it to the leaf as far as possible; if no leaf can perform it, report that it is impossible.

## Direct Delegation Contract

Use `agent_type` and `message` for current Codex subagent calls, and request a fresh context with `fork_turns="none"`. Do not use other call schemas such as `subagent_type`, `description`, `prompt`, or `fork_context`.

The main session may directly invoke exactly eight targets. Include an imperative constraint in every leaf `message` that prohibits creating or redelegating to another agent.

```text
intent-checker
worker
planner
research
code-explorer
idea-generator
adversarial-review
constructive-feedback
```

Include only the following in an ordinary artifact leaf `message`. Do not include the full user request, the full conversation, `$codex-orchestrator`, or an `Original request:` block. If given an original request or transcript, extract only the executable objective and constraints. The dedicated `intent-checker` gate input below is the sole exception to this rule.

```text
Objective: <normalized objective>
Mandatory constraints:
- <preserved constraint>
Relevant paths:
- <specified path or the concrete Path from the immediately preceding artifact>
Expected output:
- <required result and completion criteria>
```

In addition to those four items, provide every artifact-writing leaf with taskId, workItemId, exactly one standalone `Output: .agents/orchestration/<taskId>/<workItemId>/<role-file>.md` line, and zero or more necessary standalone `Input: ...` lines. Only Output is the active writable assignment; Input is read-only.

Immediately before each artifact-writing leaf `spawn_agent`, the main session validates the received/generated taskId, unique workItemId, the role's mapped filename, and the exact relative Output, then creates only `.agents/orchestration/<taskId>/<workItemId>/` with a non-escalated `mkdir -p`. The required order is `validate → non-escalated mkdir -p .agents/orchestration/<taskId>/<workItemId>/ → (retry the same command with escalation once only for an explicit permission or sandbox denial on the same path) → spawn_agent`. Only when the initial non-escalated `mkdir -p` fails with an explicit runtime sandbox/permission denial state or a clear permission-denied signal of `EACCES`, `EPERM`, `Operation not permitted`, or `Permission denied` may the main session request one escalated execution of the same `mkdir -p .agents/orchestration/<taskId>/<workItemId>/`, limited to the validated exact work-item parent. Do not infer the cause from an exit code or ordinary stderr alone; if there is no signal or the cause is uncertain, do not retry and report blocked before invoking the leaf. Do not request write access for all of `.agents`; if escalation is denied or the retry fails, do not invoke the leaf and report blocked. Before `mkdir -p`, a new work item must be checked against the coordinator's task-wide assignment record to confirm that its workItemId has not yet been assigned. Only an explicit same-taskId, same-role follow-up may reuse an existing active Output and its parent. This is the coordinator's sole bash write exception. Do not create a broader task tree or alternative path, and do not make a leaf create or confirm its parent. Do not request escalation for a `mkdir -p` failure unrelated to permission or sandboxing; on every failure, do not bypass through another path or claim success. Do not perform this work for the stateless `intent-checker`.

Before the first delegation, do not create a task list, checklist, or progress file; begin delegation immediately. Do not create an artifact path for a one-line return or for stateless work such as `intent-checker`.

## Classification and Routing

1. Select only the narrowest necessary lane and apply the dependencies and scheduling rules below.
2. If later execution scope requires reconnaissance of internal structure, existing code, configuration, call flow, or usages, invoke `code-explorer` first. The `worker` receives the exploration result path and performs execution, documentation, and verification.
3. Send a clear implementation, fix, or file change to `worker` when reconnaissance is unnecessary. An unambiguous change request already authorizes implementation within its preserved scope, so do not request separate implementation approval or make implementation conditional on verification approval. Do not ask again merely because some filename or reproduction detail is missing.
4. Invoke `research` first when current external facts, official APIs, or current version behavior are prerequisites. Leave internal location or change-scope decisions to `code-explorer`, `planner`, or `worker`.
5. Converge with `planner` before `worker` when multiple files, public contracts, configuration, compatibility, or migration risk is involved.
6. Send defect, security, or regression risk to `adversarial-review`; send maintainability or quality improvement suggestions to `constructive-feedback`. Use `idea-generator` only when the direction is open and alternatives and tradeoffs are needed.
7. If the objective is too unclear to determine which delegation to make without guessing, ask the user one short decision that changes the outcome. After incorporating the response, start from the initial `intent-checker` gate; do not invoke another leaf first based on an unconfirmed interpretation.

## Intent Preservation Gates

- For a classifiable request, `intent-checker` must be the first leaf. Even when the request's lane is classifiable but an outcome-changing user choice remains unresolved, the main session does not ask first; have the initial `intent-checker` return `CONFIRMATION_NEEDED`. Apply the pre-classification question rule above only when the main session cannot classify the leaf lane itself. Before the initial gate returns `PROCEED` or `CONFIRMATION_NEEDED`, do not send a user-confirmation question or invoke `code-explorer`, `research`, `planner`, `worker`, `adversarial-review`, `constructive-feedback`, or `idea-generator`. Give the stateless gate the normalized objective, scope, provenance/evidence, constraints, delegation order, and the semantic downstream output contract, including that each artifact-writing leaf receives exact identifiers and one concrete standalone `Output:` line only after `PROCEED`. Do not assign or reserve a taskId, workItemId, or concrete Output path for the gate, and do not treat those intentionally unavailable identifiers as missing gate input.
- At the initial gate, the main session provides the current request as Original user request. When the current user message directly answers an exact pending confirmation, retain the request that established the active objective and add only the exact immediately preceding prompt and its direct response. Never provide the full transcript or evaluation expectations. Use exactly the following labels and order. Use `None` only for an inapplicable value that is not omitted.

```text
Original user request: <current request at the initial gate, or the request that established the active objective for a direct pending-confirmation response>
Request classification: <classification>
Normalized objective: <objective>
Included scope: <included work>
Excluded scope: <excluded work>
Added constraints: <each item with provenance and evidence: matching Original user request quote for user, matching Pending confirmation prompt and response for a newly confirmed user decision, trusted main-session instruction quote for system, or non-authoritative derivation for orchestrator>
Delegation plan: <ordered lanes and expected output>
Pending confirmation prompt: <exact immediately preceding one-decision question or None>
User confirmation response: <response or None>
```

- Keep exactly one Pending confirmation prompt in main-session state. It must be the exact immediately preceding one-decision question, not a summary. A short, unqualified affirmative in the user's language approves only that stated decision. If no exact pending prompt exists, or the response qualifies, opposes, or expands it, do not infer approval; normalize the changed response and regate or ask for the genuinely unresolved decision.
- If the user explicitly approves an iterative workflow such as failure correction/retry, review, or verification, quote that approval verbatim in `User confirmation response` and identify the current follow-up stage. Record the follow-up request as the `approved-iteration-follow-up` state transition and pass it through a new stateless gate, but do not create a new confirmation for a normal follow-up stage where the objective, change scope, authority, external impact, and material choices are unchanged. A new authority, external change, scope expansion, irreversible choice, or unresolved material decision still requires new confirmation within the same transition.
- Do not assert authority based only on a provenance label in `Added constraints`. `user` must quote matching text from Original user request as evidence, except that a newly confirmed decision must quote both the matching Pending confirmation prompt and User confirmation response. `system` must quote a trusted instruction actually received by the main session and must not relabel user text as system. The `$codex-orchestrator` invocation marker is workflow-activation information, not evidence of a user feature requirement, so always classify this skill's lane, ordering, and internal artifact rules as `system`. An `orchestrator` derivation is non-authoritative operational rationale and cannot justify narrowing scope, strengthening a prohibition, or adding an artifact. If evidence is absent or mismatched with provenance, correct it before the gate; the checker returns `RECLASSIFY`.
- The delegation plan for every selected downstream leaf includes the `system` constraint quoting "Include an imperative constraint in every leaf `message` that prohibits creating or redelegating to another agent." Do not relabel or omit this operational constraint as a user requirement.
- For lane and ordering `system` evidence, quote the minimum rule from this document that actually applies. For example, a change requiring reconnaissance before planning quotes "If later execution scope requires reconnaissance of internal structure, existing code, configuration, call flow, or usages, invoke `code-explorer` first." and "Converge with `planner` before `worker` when multiple files, public contracts, configuration, compatibility, or migration risk is involved." Do not turn those quotes into evidence from the user request or add lane rules that do not apply.
- Convey the exact assigned handoff/work-log path required by the trusted artifact protocol as a `system` constraint quoting "In addition to those four items, provide every artifact-writing leaf with taskId, workItemId, exactly one standalone `Output: .agents/orchestration/<taskId>/<workItemId>/<role-file>.md` line, and zero or more necessary standalone `Input: ...` lines." This does not expand user-facing scope or output and does not conflict with prohibitions on writing source, tests, or user-owned documentation. Treat it as a conflict only when the user explicitly prohibits every file write.
- The gate must return exactly one line of `PROCEED: <reason>`, `RECLASSIFY: <reason>`, or `CONFIRMATION_NEEDED: <one decision>`. `PROCEED` is possible without a user-confirmation response when the objective, included and excluded scope, user constraints, output, and lane and ordering are preserved and there are no unsupported additional constraints or scope. Omission, scope narrowing or expansion, strengthening or replacement of a user constraint, missing or mismatched provenance/evidence, a confirmation prompt that bundles already-authorized implementation with narrower command permission, or wrong classification, lane, or ordering is `RECLASSIFY`. Use `CONFIRMATION_NEEDED` only when the original request lacks actual evidence for an outcome-changing choice.
- The initial semantic revision passes through one gate. When `planner` finalizes a plan, immediately before the first worker passes exactly one additional `plan-finalized` revision gate even when its semantics are unchanged. Do not call the gate again for the same snapshot/revision. Normal gates are determined only by the need for a meaningful checkpoint or revision; do not skip, shorten, or stop them based on the cumulative task-wide count of `intent-checker` calls. Initial, `plan-finalized`, semantic revision, and `approved-iteration-follow-up` are independent checkpoints. This does not require unlimited gate repetition; the ban on duplicate gates for the same snapshot and the checkpoint-local limits below still apply.
- After the prior checkpoint has terminated or been approved, a material semantic delta arriving outside an active `RECLASSIFY` recovery sequence from a user response, exploration, plan, review, or leaf summary increments the revision and opens a new semantic-revision checkpoint before the next leaf. A coordinator correction of a checker-cited defect during an active `RECLASSIFY` recovery sequence does not open that checkpoint. A discovered path, wording change, added evidence, or progress update is not a reason to open one. Every artifact leaf `Summary:` includes `intent-delta: none` or a brief delta for an item above. If information is insufficient to decide, do not guess; request a summary supplement from the same leaf thread before calling the gate.
- `PROCEED` records the revision as approved and advances to the prepared next leaf. After `PROCEED` at the initial gate only, reserve the task/coordinator identity; immediately before each artifact-writing leaf, allocate its unique workItemId, resolve its exact path, and include the exact taskId, workItemId, and one standalone concrete `Output:` line in that leaf prompt. `RECLASSIFY` stops downstream calls, corrects only the affected classification, objective, scope, constraint, or delegation-plan portion, increments the semantic revision/snapshot number, and regates inside the currently active checkpoint. This corrected resubmission does not open a new semantic-revision checkpoint and cannot reset that checkpoint's recovery-attempt counter or cause/evidence history. `CONFIRMATION_NEEDED` stops every leaf, asks the user one decision, stores the exact question as Pending confirmation prompt and the direct answer as User confirmation response, and regates as a new revision.
- Each checkpoint has one initial stateless `intent-checker` evaluation, which consumes no semantic recovery attempt. For a semantic correction, incorporation of a user response, a plan-finalized gate, or a format-only retry, invoke a new checker with `spawn_agent` for exactly one turn rather than sending `followup_task` to an existing checker. A malformed result is separate from semantic recovery: allow one format-only retry for the same snapshot that only restates the one-line/prefix contract, and block after a second malformed result. After `RECLASSIFY`, it remains non-terminal while a cited defect is correctable and the recovery budget and progress rules permit another attempt. Each corrected resubmission consumes one of exactly three checkpoint-local semantic recovery attempts only when it materially changes the affected semantic input and records concrete new evidence or a newly satisfied requirement. A wording-only rewrite, unchanged snapshot, or duplicate gate is not progress and must not be submitted or counted as a successful recovery step. Do not reset this fixed checkpoint-local counter when the cause label changes; initial, `plan-finalized`, semantic-revision, and `approved-iteration-follow-up` checkpoints each start their own counter. Before the three-attempt ceiling, stop early only when the same failure cause is returned twice consecutively without new evidence or a materially changed affected field, or when correction requires a genuine user-authority, scope, behavior, or tradeoff decision. After the third progress-producing corrected resubmission, accept `PROCEED` if returned; otherwise block with the evidence and cause history rather than launching a fourth attempt.
- One designated `worker` owns implementation. Preserve the initial `worker` agent id and session identity in state. After review or a user follow-up, send modifications within the existing objective and scope to that id through `followup_task` so the same worker thread continues. A review or user follow-up that proposes a new objective, scope, constraint, lane, or output first passes a new revision gate, then sends `followup_task` to the preserved id; do not create a replacement worker with `spawn_agent` for follow-up work. Only when the existing worker is explicitly unavailable report the blocking reason; do not automatically replace it with a new worker.

## Verification, Review, and Terminal State

- When a trusted main-session instruction requires approval before running an existing verification command, do not ask again for implementation and do not bundle implementation, review, or the full workflow into that question. Let the designated implementation worker finish the requested edits without running the unapproved command, then ask only whether to run the exact command in the exact working directory. Store that exact question as Pending confirmation prompt. A direct short affirmative authorizes only that command. A refusal skips the command without revoking the implementation or review authority, but the final state remains explicitly unverified or blocked if mandatory verification cannot complete.
- Every artifact-writing leaf return keeps the existing two-line format, but starts `Summary:` exactly with `status=<completed|blocked|failed>; intent-delta=<none|brief semantic change>; <role-specific payload>`. Do not treat existence of a `Path` as completion. Only `completed` is a candidate for the next stage; `blocked` is a stop that preserves the required user or environment decision and evidence, and `failed` is a leaf execution failure.
- A reviewer's role payload includes `review-state=<clear|findings|needs-user-decision>` and the finding count or identifiers. A verification-only worker's role payload includes `verification-state=<passed|failed|blocked>`. Keep detailed evidence and command results only in each artifact; transmit this metadata only within the existing one-line Summary shape of the Paths-only handoff and SSOT.
- `adversarial-review` reports only reproducible defect, security, regression, or compatibility risk candidates. `constructive-feedback` reports only non-mandatory suggestions for maintainability, consistency, and testability. Neither reviewer may decide acceptance or rejection, scope expansion, remediation execution, user questions, or task termination. A constructive suggestion not tied to a confirmed requirement or mandatory contract violation is not an automatic blocker.
- Only the main session has review-adjudication and termination authority. For this adjudication only, it may read returned review and verification artifacts but not source or tests directly; it does not merge or edit artifact bodies or implement. Record each finding by identifier as exactly `accepted`, `rejected`, or `needs-user-decision`. Accept confirmed requirements, failed mandatory verification, and compatibility-boundary violations; reject insufficiently evidenced, duplicate, out-of-scope, or non-mandatory suggestions with rationale; use needs-user-decision when new authority, scope, tradeoff, or an irreversible decision is required. A reviewer's own verdict or Summary count does not replace the main verdict.
- After the designated implementation worker completes self-verification, the main session creates exactly one separate verification-only `worker` session with `spawn_agent`. Its verifier message explicitly prohibits source, configuration, and documentation edits and permits only rerunning the minimum mandatory commands listed in the plan and recording results. Preserve the implementation worker id and verifier id and confirm that they differ. The verifier does not implement; send remediation only to the designated implementation worker through `followup_task`. Whenever the final candidate changes, send a verification-only follow-up to the same verifier identity, but rerun the same mandatory commands at most three times, one-to-one with automatic remediation rounds. This independence is based on role prompts and session separation; do not claim that runtime sandboxing guarantees arbitrary child-process non-mutation.
- The state transition is `gated → implementing → self-verified → independently-verifying → reviewing-immutable-result → adjudicating`. If adjudication has a verifier failure or an `accepted` finding, combine all accepted findings and the verifier's failed mandatory commands with their evidence into one ordered remediation batch and send it to the designated implementation worker; allow at most three automatic remediation rounds through `remediating-<1..3> → self-reverified → independently-reverifying-<1..3> → rereviewing-<1..3> → readjudicating-<1..3>`. This remediation budget is separate from every intent-checkpoint semantic recovery budget: neither consumes, inherits, resets, nor is reset by the other. Only the main session decides whether to start each round and how to adjudicate findings; finding-by-finding follow-ups, a fourth automatic remediation batch, and a fourth re-review are prohibited. Allow the next round only when the main session records concrete progress, such as resolving at least one immediately preceding `accepted` finding or narrowing the verifier-failure cause with new evidence. If a same-cause finding or the same verifier failure remains twice consecutively without new evidence, end early as `blocked` even when rounds remain. `needs-user-decision` stops before automatic remediation and asks one decision. If the answer changes normalized intent, pass a new revision gate. Accepted-finding remediation without an intent delta does not create a duplicate gate regardless of the cumulative gate count.
- The main session ends as `complete` only when the implementation worker's self-verification and the independent verifier's mandatory verification both pass for the final candidate, the required reviewer rounds are terminal, and every finding is rejected or resolved after acceptance with no remaining `accepted` or `needs-user-decision`. If any adjudication is clean, end without consuming remaining remediation rounds. If verifier failure or an `accepted` finding remains after the third readjudication, or an early-stop condition above is met, do not iterate automatically; report `blocked` to the user with evidence and the remaining decision. A leaf, reviewer, or verifier cannot declare task completion.

## Identifiers, State, and Artifacts

- Only after the initial gate returns `PROCEED`, and before the first artifact-writing delegation, reserve together a taskId in the `YYYYMMDD-<slug>` format for the current session date and a unique `coordinatorWorkItemId` for the coordinator index. Do not regenerate a received taskId; follow-up requests in the same root session retain the same root task identity and coordinator-index Output.
- Every artifact-writing leaf call already has a taskId, unique kebab-case workItemId, and exact Output path. Do not assign identifier generation to a leaf.
- Assign a workItemId unique across the taskId to each new artifact-writing work item. A follow-up for the same logical work item reuses the same workItemId and Output.
- If a follow-up assigns a new Output, the prior Output becomes read-only history; when needed for follow-up work, specify it with an exact `Input:` line.
- An explicit same-taskId, same-role follow-up may reactivate a historical Output by reassigning that exact path as the current Output; the reassigned Output becomes active and writable again, and the prior active Output becomes read-only history.
- Changing taskId or role creates a new leaf thread. Every `worker` message includes the mandatory constraint not to modify arbitrary files other than the requested artifact output and assigned `.agents/orchestration/<taskId>/<workItemId>/work.md`.
- After `code-explorer`, tell `worker` to trust the immediately preceding artifact path as the baseline, not rescout the same scope, and inspect only the specified paths and minimum verification.
- If `code-explorer` returns a Path for a file-artifact request, pass that path and the target Output directly to `worker`. The main session does not read, paste, or merge artifact bodies.
- If an artifact-writing leaf returns only a body without a concrete Path, completion fails. Do not repeat the same instruction; repartition or escalate.
- When existence confirmation is essential, use only a read-only check such as `test -f` or `wc -l` for the returned `.agents/orchestration/<taskId>/<workItemId>/` or docs path. Do not scan artifact directories or read their bodies.
- Only after the first leaf returns may the main session create or update the reserved exact `.agents/orchestration/<taskId>/<coordinatorWorkItemId>/task.md` using an allowed file-writing tool to record the delegation path and summary index. Writing `task.md` is not included in the work-item-parent `mkdir -p` escalation exception and is not done through the shell. In a runtime where that tool cannot write this exact file, do not claim file ownership with broader `.agents` permissions or an alternative path; end with paths-only results.

## Agent Cardinality and Scheduling

- Exactly one logical coordinator owns this user task: the main session. The main session tells every leaf message not to spawn or redelegate to another agent.
- `intent-checker`, `planner`, and `idea-generator` are optional singletons, with zero or one active instance per phase or round.
- `adversarial-review` and `constructive-feedback` are each optional singletons. At most one of each may be active, and one of each type may run concurrently against the same immutable integrated result.
- Singleton means one active instance, not one lifetime call. Invoke the next call only after the previous instance or round is terminal and the input state has changed.
- Only `worker`, `research`, and `code-explorer` may have adaptive multiple active instances. Default to one instance. To increase the count, all of the following must hold.
  1. At least two explicit work items are ready now.
  2. Every item has a unique goal, bounded input and scope, concrete output, completion criterion, and unique workItemId.
  3. The items do not depend on one another or require an unfinished predecessor.
  4. The items have non-overlapping ownership and can be independently verified.
  5. The count does not exceed ready non-conflicting items or the runtime available capacity.
- If independence or ownership is uncertain, use one instance. Split `code-explorer` only by an independent package/module/ownership boundary, call-flow question, or investigation hypothesis, and prohibit duplicate scope. Split `research` only by an independent research question/evidence domain or independent corroboration with a high cost of being wrong. More search terms or sources alone are not separate work items.
- Use one `worker` by default. Multiple workers require disjoint files and disjoint schema, public API, generated files, lockfiles, migration ordering, and shared mutable state. If one result changes another worker's baseline, serialize them. Duplicate implementations are forbidden unless the explicit deliverable is a choose-one prototype comparison.
- The active count is the minimum of ready non-conflicting items, runtime available capacity, and configured limit. Never hard-code a host slot count and never spawn to fill idle capacity. Execute only the currently ready dependency-DAG frontier in parallel.
- Every spawn records exactly one reason: independent work, independent corroboration, transient-failure replacement, or changed-input re-review. A transient harness or tool failure may be replaced once. Never repeat the same instruction after a genuine completion failure; repartition or escalate instead. Report a second same-cause failure as blocked.
- Wait for every required branch to become terminal. Route concrete result paths to one downstream planner, one designated integration worker, or a review role; do not read and merge phase bodies yourself.
- Review only an immutable integrated result. After each remediation round changes that result, each review type may run one sequential changed-input re-review. The total re-reviews of each review type do not exceed the actual remediation-round count and are capped at three.
- Cardinality, scheduling, failure replacement, immutable-review, leaf no-spawn, and the prohibition on redelegation are prompt-level coordination requirements, not runtime-enforced guarantees. This skill does not claim to guarantee a model, sandbox, nickname, max depth, or runtime singleton.

## Paths-only Handoff and SSOT

Use only the following format for returns and the next delegation.

```text
Path: .agents/orchestration/<taskId>/<workItemId>/<role-file>.md
Summary: <one-line summary>
```

Keep details in the assigned handoff file, and let a receiver find an artifact only through a concrete returned path or the coordinator index. Do not scan work-item directories.

```text
task.md: main-session overview, progress, index
plan.md: planner implementation path
work.md: worker changes and verification
explore.md: code-explorer findings
research.md: research findings and sources
ideas.md: idea-generator alternatives
adversarial-review.md: adversarial risks and failures
constructive-feedback.md: improvement feedback
```

Store each fact in only one authoritative file. If it already exists elsewhere, do not copy it; reference its path. `intent-checker` is stateless and owns no file.

Provide artifact-writing leaves with the following file-ownership constraints.

- If there is no active Output, create a new file; append only when continuation of the same active Output is explicit. Do not overwrite or replace existing content.
- Do not write Input, inactive history, another work item, another role's mapped filename, or `task.md`.
- taskId and workItemId use kebab-case and cannot contain a path separator, absolute path, empty segment, or `..`. If invalid, stop before writing; do not normalize or substitute arbitrarily.
- Keep all run files only within the canonical `.agents/orchestration/<taskId>/<workItemId>/` scope.
