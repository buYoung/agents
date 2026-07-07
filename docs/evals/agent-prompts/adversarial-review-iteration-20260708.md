# Adversarial Review Prompt Iteration Result — 2026-07-08

## Summary

- Agent: `adversarial-review`
- Model: `openai/gpt-5.3-codex-spark`
- Execution mode: direct subagent contract evaluation with `./scripts/run-opencode --direct-subagent adversarial-review run`
- Source of truth: `docs/FDD/agent-adversarial-review-role.md`, `packages/opencode/src/core/permissions.ts`, `packages/opencode/src/core/doc-protocol.ts`
- Result: complete

`adversarial-review`는 소스 수정 없이 결함, 반례, 회귀, 보안, 호환성 위험을 찾고 `.agents/<taskId>/adversarial-review.md`에 기록하는 비수정 검토 역할이다.

## Contract

| Field | Value |
| --- | --- |
| Unique role | 위험, 반례, 실패 시나리오를 찾는 비수정 검토 |
| Mode | `subagent` |
| Allowed tools | source read, bash for narrow verification, `.agents/**` read/write |
| Forbidden tools | source edit/write, `task`, `webfetch` |
| Owned artifact | `.agents/<taskId>/adversarial-review.md` |
| Return contract | `Path:` + `Summary:` only |
| Neighbor boundaries | `worker`는 수정, `constructive-feedback`은 개선 제안, `adversarial-review`는 결함/위험 검토 |

## Delegation Input Evidence

오케스트레이터 경유 smoke run:

- Run: `adversarial-delegation2-gpt53-spark-20260708`
- Model: `openai/gpt-5.3-codex-spark`
- Observed target: `adversarial-review`
- Observed issue: one call omitted `subagent_type`; the next valid call omitted concrete target paths, so the review agent correctly asked for target path/taskId.
- Direct evaluation input shape used afterward: `taskId`, explicit target file, optional user tool instruction, no source editing, write `.agents/<taskId>/adversarial-review.md`, return `Path` and `Summary`.

## Prompt Change

Changed file:

- `packages/opencode/src/agents/adversarial-review.ts`

Compression:

- Baseline `ADVERSARIAL_REVIEW_PROMPT`: 1,435 chars
- Reinforced before compression: 1,671 chars
- Final compressed prompt: 1,330 chars

Final prompt keeps compact rules for:

- Read only explicit targets and explicit `.agents/<taskId>/*.md` files.
- Use named tools/MCP only when exposed as real tools; do not mimic unavailable tools through same-named shell commands.
- Avoid `bash` unless a single read-only verification is explicitly needed.
- Do not edit source, call `task`, or use `webfetch`.
- Write only `.agents/<taskId>/adversarial-review.md`, preserving the exact provided artifact path.
- Separate confirmed evidence from inferred or conditional risk.

## Failures Found

1. Hidden fixture over-search:
   - Observed: `.opencode-run` fixture was not visible to normal search, leading to repeated search and external directory attempts.
   - Fix: final fixtures use tracked repository paths; prompt now records review insufficiency when explicit targets cannot be found.

2. Over-broad review exploration:
   - Observed: baseline read `git status`, `git log`, neighboring files, model catalogs, and agent prompts outside the target.
   - Fix: explicit target-only rule plus ban on neighboring agent/catalog/test/git history unless listed.

3. Artifact path instability:
   - Observed: one run mutated `.agents/...` into an invalid absolute path with a typo/spurious space.
   - Fix: preserve exact artifact path spelling, spacing, and root.

4. Compression regression:
   - Observed: compressed run used `bash ls ".agents"`.
   - Fix: restored explicit `.agents` listing ban in compressed wording.

## Final Clean Runs

All final runs used clean run IDs, separate opencode DBs, separate taskIds, and separate `output.jsonl` files. Inputs did not include prior failure logs, tool output, or this evaluation document.

| Fixture type | Runs | Pass rate | Tool evidence | Artifact | Avg total step tokens |
| --- | --- | --- | --- | --- | --- |
| MCP 있음 정상 | `adversarial-compressed2-gpt53-spark-mcp-normal-1..3` | 3/3 | `codemap-search_*` 3/3, forbidden tools 0/3 | `adversarial-review.md` 3/3 | 18,951 |
| MCP 있음 경계 | `adversarial-compressed2-gpt53-spark-mcp-boundary-1..3` | 3/3 | `codemap-search_*` 3/3, source edit/task/webfetch/bash 0/3 | `adversarial-review.md` 3/3 | 20,159 |
| MCP 없음 정상 | `adversarial-compressed2-gpt53-spark-nomcp-normal-1..3` | 3/3 | `codemap-search_*` 0/3, same-named CLI 0/3, base `read` 3/3 | `adversarial-review.md` 3/3 | 18,336 |

MCP config evidence:

- MCP 있음 final config includes `mcp.codemap-search.enabled: true`.
- MCP 없음 final config includes `mcp.codemap-search.enabled: false`.

## Static Verification

- Prompt does not hard-code `codemap-search`.
- Agent keeps `name: "adversarial-review"` and `mode: "subagent"`.
- Permission policy denies source edit/write, `task`, and `webfetch` for `adversarial-review`.
- Final prompt is shorter than the baseline prompt.

## Residual Risk

`adversarial-review` can still produce conservative risk candidates rather than confirmed defects. This matches the adversarial role, but downstream consumers should treat findings as risk hypotheses unless the artifact marks them as directly confirmed.
