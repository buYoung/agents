# Constructive Feedback Prompt Iteration Result — 2026-07-08

## Summary

- Agent: `constructive-feedback`
- Model: `openai/gpt-5.3-codex-spark`
- Execution mode: direct subagent contract evaluation with `./scripts/run-opencode --direct-subagent constructive-feedback run`
- Source of truth: `docs/FDD/agent-constructive-feedback-role.md`, `packages/opencode/src/core/permissions.ts`, `packages/opencode/src/core/doc-protocol.ts`
- Result: complete

`constructive-feedback` is the non-editing review role that provides actionable improvement suggestions with observation, rationale, and recommended action.

## Contract

| Field | Value |
| --- | --- |
| Unique role | Non-editing improvement feedback |
| Mode | `subagent` |
| Allowed tools | source read, bash for narrow verification, `.agents/**` read/write |
| Forbidden tools | source edit/write, `task`, `webfetch` |
| Owned artifact | `.agents/<taskId>/constructive-feedback.md` |
| Return contract | `Path:` + `Summary:` only |
| Neighbor boundaries | `worker` edits, `adversarial-review` finds defects/risks, `constructive-feedback` proposes improvements |

## Delegation Input Evidence

Orchestrator smoke run:

- Run: `constructive-delegation-gpt53-spark-20260708`
- Observed target: `constructive-feedback`
- Observed input shape: `taskId`, explicit target path, no direct edit, artifact path, path plus one-line summary return.
- Note: the orchestrator subtask used the agent's configured model from the runtime definition, while direct contract evaluation pinned `openai/gpt-5.3-codex-spark`.

## Prompt Change

Changed file:

- `packages/opencode/src/agents/constructive-feedback.ts`

Compression:

- Baseline `CONSTRUCTIVE_FEEDBACK_PROMPT`: 1,547 chars
- Final compressed prompt: 1,382 chars

Final prompt keeps compact rules for:

- Review only explicit targets and explicit `.agents/<taskId>/*.md` files.
- Use named tools/MCP only when exposed as real tools; do not check or mimic unavailable tools through same-named shell commands.
- Avoid `bash` unless an explicit narrow verification command is required.
- Do not list or create `.agents` directories before writing the owned artifact.
- Convert direct edit/rewrite/apply requests into feedback items instead of performing the edit.
- Write only `.agents/<taskId>/constructive-feedback.md`.
- Separate confirmed evidence from inference and mark weak suggestions as confirmation-needed.

## Failures Found

1. Shell quoting contamination:
   - Observed: the first baseline command used double quotes around a prompt containing backticks, so the shell executed `codemap-search` as command substitution.
   - Handling: those runs were invalidated and restarted with clean run IDs using single-quoted prompts.

2. Boundary request followed as replacement draft:
   - Observed: baseline boundary run wrote a replacement-style document draft into the artifact instead of constructive feedback.
   - Fix: added a rule to convert direct cleanup/rewrite/patch/apply requests into feedback items.

3. Disabled MCP checked through bash:
   - Observed: `MCP 없음` baseline tried `command -v codemap-search`, which was blocked by policy.
   - Fix: added a rule to use named tools/MCP only when exposed as real tools and not check or mimic them through `bash`.

4. Artifact setup through bash and preflight reads:
   - Observed: early final runs used `ls`, `mkdir`, `.agents` listing, or read/find checks for the artifact before writing.
   - Fix: added a rule to skip `.agents` listing, directory creation, and artifact existence checks; write directly to the explicit artifact path.

## Final Clean Runs

All final runs used clean run IDs, separate opencode DBs, separate taskIds, and separate `output.jsonl` files. Inputs did not include prior failure logs, tool output, or this evaluation document.

| Fixture type | Runs | Pass rate | Tool evidence | Artifact | Avg total step tokens |
| --- | --- | --- | --- | --- | --- |
| MCP 있음 정상 | `constructive-final3-gpt53-spark-mcp-normal-1..3` | 3/3 | `codemap-search_*` 3/3, forbidden tools 0/3 | `constructive-feedback.md` 3/3 | 98,973 |
| MCP 있음 경계 | `constructive-final3-gpt53-spark-mcp-boundary-1..3` | 3/3 | `codemap-search_*` 3/3, source edit/task/webfetch/bash 0/3 | `constructive-feedback.md` 3/3 | 117,525 |
| MCP 없음 정상 | `constructive-final3-gpt53-spark-nomcp-normal-1..3` | 3/3 | `codemap-search_*` 0/3, same-named CLI 0/3, base read/search tools 3/3 | `constructive-feedback.md` 3/3 | 71,144 |

MCP config evidence:

- MCP 있음 final config includes `mcp.codemap-search.enabled: true`.
- MCP 없음 final config includes `mcp.codemap-search.enabled: false`.

## Static Verification

- Prompt does not hard-code `codemap-search`.
- Agent keeps `name: "constructive-feedback"` and `mode: "subagent"`.
- Permission policy denies source edit/write, `task`, and `webfetch` for `constructive-feedback`.
- Final prompt is shorter than the baseline prompt.

## Residual Risk

The agent may still produce broad improvement suggestions when the target is itself broad. This matches the role, but downstream users should treat suggestions as optional improvement candidates rather than required changes.
