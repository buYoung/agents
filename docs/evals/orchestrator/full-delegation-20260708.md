# Orchestrator Full Delegation Eval — 2026-07-08

## Summary

- Eval type: orchestrator integration full delegation
- Model: `openai/gpt-5.3-codex-spark`
- Runner: `./scripts/run-opencode`
- Passing run: `orchestrator-full-delegation2-gpt53-spark-20260708`
- Result: pass for subagent invocation coverage

This eval verifies that the primary `orchestrator` can invoke all 8 subagents in one integrated flow:

1. `intent-checker`
2. `research`
3. `code-explorer`
4. `idea-generator`
5. `planner`
6. `worker`
7. `adversarial-review`
8. `constructive-feedback`

The eval is separate from the per-agent prompt iteration evals because it checks the orchestrator's end-to-end delegation behavior, not a single subagent contract.

## Prompt Shape

The passing prompt used a constrained full-flow request:

- fixed `taskId`: `20260708-orchestrator-full-delegation2`
- no source or docs edits
- only `.agents/20260708-orchestrator-full-delegation2/` artifacts allowed
- exactly 8 `task` delegations requested
- each `task` call required to use only `subagent_type`, `description`, and `prompt`
- `taskId` required inside prompt text, not as a separate tool argument
- subagent outputs limited to short artifacts and path plus one-line summary handoff

## Run Evidence

### Invalidated First Attempt

- Run: `orchestrator-full-delegation-gpt53-spark-20260708`
- Result: invalidated
- Observed: only 3 subagents completed before the run stalled for several minutes.
- Completed before interruption:
  - `intent-checker`
  - `research`
  - `code-explorer`
- Handling: interrupted and restarted with a clean run ID and tighter per-subagent output limits.

### Passing Clean Run

Run: `orchestrator-full-delegation2-gpt53-spark-20260708`

| Order | Subagent | Tool status | Task input keys | Model |
| --- | --- | --- | --- | --- |
| 1 | `intent-checker` | `completed` | `subagent_type`, `description`, `prompt` | `openai/gpt-5.3-codex-spark` |
| 2 | `research` | `completed` | `subagent_type`, `description`, `prompt` | `openai/gpt-5.3-codex-spark` |
| 3 | `code-explorer` | `completed` | `subagent_type`, `description`, `prompt` | `openai/gpt-5.3-codex-spark` |
| 4 | `idea-generator` | `completed` | `subagent_type`, `description`, `prompt` | `openai/gpt-5.3-codex-spark` |
| 5 | `planner` | `completed` | `subagent_type`, `description`, `prompt` | `openai/gpt-5.3-codex-spark` |
| 6 | `worker` | `completed` | `subagent_type`, `description`, `prompt` | `openai/gpt-5.3-codex-spark` |
| 7 | `adversarial-review` | `completed` | `subagent_type`, `description`, `prompt` | `openai/gpt-5.3-codex-spark` |
| 8 | `constructive-feedback` | `completed` | `subagent_type`, `description`, `prompt` | `openai/gpt-5.3-codex-spark` |

Additional checks:

- All 8 `task` calls included the run `taskId` in prompt text.
- The 7 documented subagents included explicit `.agents/20260708-orchestrator-full-delegation2/` artifact paths in prompt text.
- `intent-checker` correctly had no artifact path requirement.
- No `SchemaError`, missing `subagent_type`, invalid `task_id`, or fallback model evidence appeared in the passing run log.
- Final response included `Path:` and `Summary:`.
- Total step tokens: `169,796`.

## Artifact Evidence

The passing run created the following artifacts:

```text
.agents/20260708-orchestrator-full-delegation2/adversarial-review.md
.agents/20260708-orchestrator-full-delegation2/constructive-feedback.md
.agents/20260708-orchestrator-full-delegation2/explore.md
.agents/20260708-orchestrator-full-delegation2/ideas.md
.agents/20260708-orchestrator-full-delegation2/plan.md
.agents/20260708-orchestrator-full-delegation2/research.md
.agents/20260708-orchestrator-full-delegation2/task.md
.agents/20260708-orchestrator-full-delegation2/work.md
```

## Residual Observations

- The final `task.md` content contained literal leading `+` characters, likely from an incorrectly formed `apply_patch` add-file body.
- `intent-checker` returned a conservative confirmation-needed result, but it was invoked and completed.
- Some subagent artifacts exceeded the requested 5-line limit, so the eval proves invocation coverage, not strict output-length compliance.

## Verdict

The orchestrator full delegation path is confirmed for invocation coverage: all 8 subagents were called once, completed, used the requested model, and used valid `task` input keys.

The residual observations should be handled as separate follow-up behavior checks if strict artifact formatting or output-length control becomes part of the acceptance criteria.

## GLM 5.2 Follow-up Run

Model: `ollama-cloud/glm-5.2`

### Invalidated GLM Attempt

- Run: `orchestrator-full-delegation-glm52-20260708`
- Result: invalidated for strict tool-boundary judgment.
- Invocation coverage: all 8 subagents completed.
- Issue: after subagent completion, the orchestrator attempted a direct `bash` command to list/read `.agents/...` artifacts.
- Enforcement result: policy denied the `bash` call, so no external verification command executed.
- Handling: restarted with a clean run ID and an explicit prompt constraint that the orchestrator must not use `bash`, `read`, `list`, `glob`, `grep`, or `webfetch` for direct verification.

### Passing GLM Clean Run

Run: `orchestrator-full-delegation-glm52-clean-20260708`

| Order | Subagent | Tool status | Task input keys | Model |
| --- | --- | --- | --- | --- |
| 1 | `intent-checker` | `completed` | `subagent_type`, `description`, `prompt` | `ollama-cloud/glm-5.2` |
| 2 | `research` | `completed` | `subagent_type`, `description`, `prompt` | `ollama-cloud/glm-5.2` |
| 3 | `code-explorer` | `completed` | `subagent_type`, `description`, `prompt` | `ollama-cloud/glm-5.2` |
| 4 | `idea-generator` | `completed` | `subagent_type`, `description`, `prompt` | `ollama-cloud/glm-5.2` |
| 5 | `planner` | `completed` | `subagent_type`, `description`, `prompt` | `ollama-cloud/glm-5.2` |
| 6 | `worker` | `completed` | `subagent_type`, `description`, `prompt` | `ollama-cloud/glm-5.2` |
| 7 | `adversarial-review` | `completed` | `subagent_type`, `description`, `prompt` | `ollama-cloud/glm-5.2` |
| 8 | `constructive-feedback` | `completed` | `subagent_type`, `description`, `prompt` | `ollama-cloud/glm-5.2` |

Clean-run checks:

- Parent run tool pattern: 8 `task` calls + 1 allowed `write` to orchestrator-owned `task.md`.
- No direct `bash`, `read`, `glob`, `grep`, `list`, or `webfetch` event in the parent orchestrator run.
- No `SchemaError`, missing `subagent_type`, invalid `task_id`, or fallback model evidence appeared in the clean run log.
- All 8 subagent calls included the run `taskId` in prompt text.
- All 8 subagent calls used `ollama-cloud/glm-5.2`.
- Final response included `Path:` and `Summary:`.
- Total step tokens: `177,589`.

GLM clean-run artifacts:

```text
.agents/20260708-orchestrator-full-delegation-glm52-clean/adversarial-review.md
.agents/20260708-orchestrator-full-delegation-glm52-clean/constructive-feedback.md
.agents/20260708-orchestrator-full-delegation-glm52-clean/explore.md
.agents/20260708-orchestrator-full-delegation-glm52-clean/ideas.md
.agents/20260708-orchestrator-full-delegation-glm52-clean/plan.md
.agents/20260708-orchestrator-full-delegation-glm52-clean/research.md
.agents/20260708-orchestrator-full-delegation-glm52-clean/task.md
.agents/20260708-orchestrator-full-delegation-glm52-clean/work.md
```

GLM verdict:

- Invocation coverage: pass.
- Requested model propagation: pass.
- Parent orchestrator tool boundary: pass on the clean run.

## Read-only Bash Policy Follow-up

Model: `openai/gpt-5.3-codex-spark`

Change under test:

- `orchestrator` now has `bash: "read-only"` in the plugin permission policy.
- The permission hook allows a broad read-only command catalog through `bash`, while rejecting shell redirection, subshell/background execution, command substitution, mutating commands, unsafe `sed/find/awk` arguments, and non-read-only `git` subcommands.
- The orchestrator prompt allows read-only bash only for artifact/status fact checks, not implementation, source editing, builds, installs, tests, or network execution.
- `code-explorer` was strengthened to require a real artifact write before returning `Path`.

### Unit and Type Checks

- `pnpm --dir packages/opencode test -- permission.test.ts`
  - Result: pass
  - Tests: 26 passed
- `pnpm check-types`
  - Result: pass
  - Packages: `opencode`, `cli`

### Invalidated Attempts

Run: `orchestrator-full-delegation-readonly-bash-gpt53-spark-20260708`

- Invocation coverage: all 8 subagents completed.
- Read-only bash proof: parent orchestrator successfully ran `ls` and `wc -l`.
- Invalidating issue: `code-explorer` returned `Path: .../explore.md` without creating the file.
- External artifact check confirmed `explore.md` was missing.

Run: `orchestrator-full-delegation-readonly-bash-clean-gpt53-spark-20260708`

- Invocation coverage: all 8 subagents completed.
- Invalidating issues:
  - `code-explorer` again returned `Path: .../explore.md` without creating the file.
  - Parent orchestrator ran `wc -l .../task.md` before writing `task.md`, producing `No such file or directory`.
- Handling:
  - `code-explorer` prompt contract was strengthened: no artifact path probing as a write substitute, mandatory write for requested artifact output, and no `Path` return before write success.
  - Orchestrator prompt was strengthened: write `task.md` before line-count verification and do not report success after a failed read-only bash check.

### Direct Code-explorer Regression Check

Run: `direct-code-explorer-write-gpt53-spark-20260708`

- Agent: `code-explorer` via direct subagent harness.
- Result: pass.
- Evidence: `.agents/20260708-direct-code-explorer-write/explore.md` was created.
- Tool evidence: the subagent used `apply_patch` to add the artifact before returning `Path`.

### Passing Final Clean Run

Run: `orchestrator-full-delegation-readonly-bash-final-gpt53-spark-20260708`

| Order | Subagent | Tool status | Task input keys | Model |
| --- | --- | --- | --- | --- |
| 1 | `intent-checker` | `completed` | `subagent_type`, `description`, `prompt` | `openai/gpt-5.3-codex-spark` |
| 2 | `research` | `completed` | `subagent_type`, `description`, `prompt` | `openai/gpt-5.3-codex-spark` |
| 3 | `code-explorer` | `completed` | `subagent_type`, `description`, `prompt` | `openai/gpt-5.3-codex-spark` |
| 4 | `idea-generator` | `completed` | `subagent_type`, `description`, `prompt` | `openai/gpt-5.3-codex-spark` |
| 5 | `planner` | `completed` | `subagent_type`, `description`, `prompt` | `openai/gpt-5.3-codex-spark` |
| 6 | `worker` | `completed` | `subagent_type`, `description`, `prompt` | `openai/gpt-5.3-codex-spark` |
| 7 | `adversarial-review` | `completed` | `subagent_type`, `description`, `prompt` | `openai/gpt-5.3-codex-spark` |
| 8 | `constructive-feedback` | `completed` | `subagent_type`, `description`, `prompt` | `openai/gpt-5.3-codex-spark` |

Parent orchestrator read-only bash evidence:

```text
ls .agents/20260708-orchestrator-full-delegation-readonly-bash-final; wc -l .agents/20260708-orchestrator-full-delegation-readonly-bash-final/task.md
```

Result:

```text
adversarial-review.md
constructive-feedback.md
explore.md
ideas.md
plan.md
research.md
task.md
work.md
      22 .agents/20260708-orchestrator-full-delegation-readonly-bash-final/task.md
```

Final clean-run artifacts:

```text
.agents/20260708-orchestrator-full-delegation-readonly-bash-final/adversarial-review.md
.agents/20260708-orchestrator-full-delegation-readonly-bash-final/constructive-feedback.md
.agents/20260708-orchestrator-full-delegation-readonly-bash-final/explore.md
.agents/20260708-orchestrator-full-delegation-readonly-bash-final/ideas.md
.agents/20260708-orchestrator-full-delegation-readonly-bash-final/plan.md
.agents/20260708-orchestrator-full-delegation-readonly-bash-final/research.md
.agents/20260708-orchestrator-full-delegation-readonly-bash-final/task.md
.agents/20260708-orchestrator-full-delegation-readonly-bash-final/work.md
```

Final checks:

- All 8 subagents completed.
- All 8 task calls used only `subagent_type`, `description`, and `prompt`.
- All 8 subagent calls used `openai/gpt-5.3-codex-spark`.
- Parent orchestrator wrote only `task.md`.
- Parent orchestrator read-only bash check succeeded with exit code 0.
- No `권한 거부`, `SchemaError`, invalid `task_id`, fallback model, `File not found`, `wc:` failure, or tool error appeared in the final clean run.
- Total final-run step tokens: `19008`.

Final verdict:

- Read-only bash permission policy: pass.
- Orchestrator full delegation with read-only bash verification: pass.
- Artifact existence coverage: pass.
