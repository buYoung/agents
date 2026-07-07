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
