# Worker Prompt Iteration Result — 2026-07-07

## Summary

- Agent: `worker`
- Model: `openai/gpt-5.3-codex-spark`
- Execution mode: direct agent contract evaluation with `./scripts/run-opencode run --agent worker`
- Source of truth: `docs/FDD/agent-worker-role.md`, `packages/opencode/src/core/permissions.ts`, `packages/opencode/src/core/doc-protocol.ts`
- Result: complete

`worker`는 확정된 변경을 직접 수행하고, 검증 결과를 `.agents/<taskId>/work.md`에 기록하며, 다른 agent로 재위임하지 않는 실행 역할이다.

## Contract

| Field | Value |
| --- | --- |
| Unique role | 확정된 구현 변경을 직접 수행하고 검증한다. |
| Mode | `all` |
| Allowed tools | source read, source edit/write, bash, webfetch, `.agents/**` read/write |
| Forbidden tools | `task` 재위임 |
| Owned artifact | `.agents/<taskId>/work.md` |
| Return contract | `Path:` + `Summary:`만 반환 |
| Neighbor boundaries | `planner`는 계획, `research`는 외부 조사, review agents는 비수정 검토다. |

## Delegation Input Evidence

오케스트레이터 경유 smoke run:

- Run: `worker-delegation-gpt53-spark-20260707`
- Model: `openai/gpt-5.3-codex-spark`
- Observed task target: `worker`
- Observed input shape: 목표, 단일 파일 수정, 다른 파일 수정 금지, 가능한 검증, `.agents/<taskId>/work.md` 기록, `Path:` 반환, taskId 생성 요청.

## Prompt Change

Changed file:

- `packages/opencode/src/agents/worker.ts`

Compression:

- Baseline `WORKER_RULES`: 1,301 chars
- Final `WORKER_RULES`: 1,113 chars

Final prompt keeps the role compact and adds only general rules for:

- Use received `taskId`; generate only when absent.
- Do not exhaustively search empty `.agents/<taskId>` directories.
- Honor named tools only when exposed as actual tools; do not mimic unavailable MCP/tools through same-named shell commands.
- Use the narrowest real verification command.
- Create `work.md` with `taskId` as first line and append only to that file.

## Runner / Policy Change

Prompt-only reinforcement did not reliably stop no-MCP runs from invoking a same-named CLI through `bash`. To keep the no-MCP baseline honest, `scripts/run-opencode` now exports `OPENCODE_DISABLED_MCP_COMMANDS=codemap-search` when `OPENCODE_CODEMAP_MCP=0`, and `permissions.ts` blocks bash commands that invoke disabled MCP commands.

This is a general disabled-MCP command guard, not an agent prompt rule.

## Failures Found

1. Warmup over-search and over-verification:
   - Observed: empty `.agents/<taskId>` discovery repeated; simple isolated edit triggered full `pnpm check-types`.
   - Fix: added narrow context-read and narrow verification rules.

2. `work.md` first-line instability:
   - Observed: early clean runs sometimes omitted `taskId` as first line.
   - Fix: when creating `work.md`, write `taskId` first.

3. no-MCP CLI fallback:
   - Observed: no-MCP runs used `bash` to run a same-named CLI even when MCP was disabled.
   - Fix: prompt strengthened generally, then runner/permission guard added for disabled MCP commands.

## Final Clean Runs

All final runs used clean run IDs, separate opencode DBs, separate taskIds, and separate `output.jsonl` files. Inputs did not include prior failure logs, tool output, or this evaluation document.

| Fixture type | Runs | Pass rate | Tool evidence | Artifact | Avg total step tokens |
| --- | --- | --- | --- | --- | --- |
| MCP 있음 정상 | `worker-final4-gpt53-spark-mcp-normal-1..3` | 3/3 | `codemap-search_*` 3/3, `task` 0/3 | `work.md` 3/3, target edit 3/3 | 266,733 |
| MCP 있음 경계 | `worker-final4-gpt53-spark-mcp-boundary-1..3` | 3/3 | `codemap-search_*` 3/3, `task` 0/3 | `work.md` 3/3, target edit 3/3 | 283,688 |
| MCP 없음 정상 | `worker-final6-gpt53-spark-nomcp-normal-1..3` | 3/3 | `codemap-search_*` 0/3, same-named CLI 0/3, `task` 0/3 | `work.md` 3/3, target edit 3/3 | 184,605 |

MCP config evidence:

- MCP 있음 final config includes `mcp.codemap-search.enabled: true`.
- MCP 없음 final config includes `mcp.codemap-search.enabled: false`.

## Static Verification

Required static verification:

- Prompt does not hard-code `codemap-search`.
- Worker agent keeps `name: "worker"` and `mode: "all"`.
- Permission policy still forbids `task` for `worker`.
- Final no-MCP guard is controlled by `OPENCODE_DISABLED_MCP_COMMANDS`.

## Residual Risk

The OpenAI model still tends to count generated `work.md` as a changed file in some summaries. This does not violate the worker contract because `work.md` is its owned generated artifact, but downstream summaries should treat source edits and run artifacts separately when exact source-file counts matter.
