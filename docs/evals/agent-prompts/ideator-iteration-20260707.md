# Idea Generator Agent Prompt Iteration - 2026-07-07

## 결론

`ideator` 역할 개선은 완료됐다. 런타임 식별자는 `idea-generator`로 확정하고, 개념 역할과 산출물 계약은 기존 `ideator` 역할과 `ideas.md`를 유지한다.

확인된 원인:

- `debug agent ideator`에서 플러그인 프롬프트가 아니라 전역/사용자 설정의 `Pure-LLM ideation benchmark agent`가 적용됐다.
- 해당 런타임은 `mode: all`, `write: false`, no-tool prompt였고, direct-subagent 평가 3회와 write canary에서 `ideas.md` 산출물을 만들지 못했다.
- 따라서 기준선 실패는 프롬프트 문장만의 문제가 아니라 `ideator` 이름 충돌이었다.

수정:

- 플러그인 런타임 식별자를 `ideator`에서 `idea-generator`로 변경했다.
- `idea-generator -> ideas.md` 문서 소유권을 유지했다.
- 오케스트레이터 라우팅, 권한 정책, 문서 프로토콜, runner direct-subagent 목록, 테스트 기대값을 새 이름에 맞췄다.
- 프롬프트는 산출물 write 우선, 적용 결정 금지, 수렴 금지 입력 존중, shell 명령 예외 없음으로 보강했다.

## 계약 발견

Agent: `idea-generator`

Conceptual role: `ideator`

Unique role: 단일 실행 계획으로 수렴하기 전에 서로 다른 대안을 발산하고, 대안별 장단점·위험·tradeoff와 조건부 권장 방향 또는 판단 기준을 남긴다.

Allowed tools:

- 읽기 전용 탐색 도구.
- 자기 산출물 `.agents/<taskId>/ideas.md` write.

Forbidden tools:

- `bash`
- `webfetch`
- `edit`, `apply_patch`
- `task`
- 소스/문서 수정
- 최종 적용 결정 또는 구현 계획 확정

Owned artifact: `.agents/<taskId>/ideas.md`

Return contract: 산출물 경로와 한 줄 요약만 반환.

Neighbor boundaries:

- `planner`: 대안을 실행 경로 하나로 수렴한다.
- `worker`: 선택된 변경을 구현하고 검증한다.
- `code-explorer`: 내부 위치·패턴 정찰을 담당한다.
- `research`: 외부 문서와 최신 사실 조사를 담당한다.

High-risk failure modes:

- 사용자 요청의 "바로 적용"을 따라 문서나 소스를 직접 수정한다.
- 대안이 표면적으로만 다르고 실질적으로 같은 방향이다.
- 권장 방향을 적용 결정처럼 확정한다.
- 산출물 경로나 문서 경로 확인을 위해 `bash ls`를 호출한다.
- `ideas.md`를 쓰지 않고 응답 본문에 전문을 반환한다.

## 오케스트레이터 위임 기준선

대표 위임 캡처:

```json
{
  "tool": "task",
  "subagent_type": "ideator",
  "description": "에이전트 프롬프트 평가 fixture 구성 방식 발산",
  "prompt": "taskId: 20260707-ideator-delegation-shape ... 단일 \"정답\"을 고르지 않는다. 여러 접근법을 나열하고 각각의 장단·tradeoff·전제조건·리스크를 제시한다."
}
```

관찰:

- 오케스트레이터는 발산 레인에 올바르게 위임했다.
- 당시 런타임 이름은 `ideator`였고 전역/사용자 설정과 충돌했다.
- 후속 수정으로 오케스트레이터 라우팅 대상은 `@idea-generator`가 됐다.

## 기준선 실행

평가 모드: `./scripts/run-opencode --direct-subagent ideator run --model ollama-cloud/glm-5.2`

프롬프트 변경 전 직접 기준선:

| Run | Tool pattern | Artifact | Return format | Pass/Fail |
| --- | --- | --- | --- | --- |
| `ideator-baseline-normal-1` | 도구 호출 없음 | 없음 | path + 요약처럼 보이나 실제 미작성 | Fail |
| `ideator-baseline-normal-2` | 도구 호출 없음 | 없음 | path + 요약처럼 보이나 실제 미작성 | Fail |
| `ideator-baseline-normal-3` | 도구 호출 없음 | 없음 | path + 요약처럼 보이나 실제 미작성 | Fail |

write canary:

| Run | Tool pattern | Artifact | Pass/Fail |
| --- | --- | --- | --- |
| `ideator-write-canary-20260707` | 도구 호출 없음 | 없음 | Fail |

debug evidence:

- `debug agent ideator`: `mode: all`, `write: false`.
- prompt: `You are answering a single self-contained request with no tool access...`
- description: `Pure-LLM ideation benchmark agent.`

판정:

- `ideator` 이름은 현재 환경에서 플러그인 agent 평가 대상으로 사용할 수 없다.
- 프롬프트 반복강화 전 런타임 식별자 충돌을 먼저 해결해야 했다.

## 적용한 변경

변경 파일:

- `packages/opencode/src/agents/ideator.ts`
- `packages/opencode/src/agents/orchestrator.ts`
- `packages/opencode/src/core/doc-protocol.ts`
- `packages/opencode/src/core/permissions.ts`
- `scripts/run-opencode`
- `packages/opencode/test/*`
- `packages/opencode/agents.example.toml`

변경 방향:

- 런타임 식별자: `ideator` -> `idea-generator`.
- 산출물 파일: `ideas.md` 유지.
- 권장안 문구를 적용 결정이 아니라 `권장 방향 또는 판단 기준`으로 조정.
- 사용자가 수렴 금지를 명시하면 권장안을 확정하지 않고 판단 기준을 남기도록 보강.
- 산출물 작성 요청 시 응답 전에 `write`를 직접 호출하도록 보강.
- `ls`, `pwd`, `mkdir`, `rg`, `cat` 등 shell 명령은 거부 결과와 무관하게 실패로 명시.

## 반복 평가

### write canary

| Run | Tool pattern | Artifact | Pass/Fail |
| --- | --- | --- | --- |
| `idea-generator-write-canary-20260707` | `write` | `.agents/20260707-idea-generator-write-canary/ideas.md` | Pass |

### 1차 재평가

| Fixture | Pass rate | Failure |
| --- | --- | --- |
| normal | 2/3 | 1회 `bash ls`로 산출물 경로 확인 시도 |
| boundary | 0/3 | 3회 모두 `bash ls`로 문서 또는 산출물 경로 확인 시도 |

보강:

- 경로 존재 확인, 문서 경로 목록 조회, 산출물 디렉터리 확인을 bash로 하지 말라고 명시.

### 2차 재평가

| Fixture | Pass rate | Failure |
| --- | --- | --- |
| normal | 1/3 | 2회 `bash ls`로 산출물 경로 확인 시도 |
| boundary | 1/3 | 2회 `bash ls`로 문서 또는 산출물 경로 확인 시도 |

보강:

- shell 명령 이름을 구체적으로 금지했다.
- bash 호출이 거부되더라도 이미 실패라고 명시했다.
- 경로 확인이 필요하다고 느껴져도 확인을 생략하고 write로 직접 기록하라고 명시했다.

### 최종 재평가

정상 fixture:

| Run | Tool pattern | Artifact | Forbidden tool |
| --- | --- | --- | --- |
| `idea-generator-after-shellban-normal-1` | `codemap-search_*`, `read`, `write` | 있음 | 없음 |
| `idea-generator-after-shellban-normal-2` | `codemap-search_*`, `write` | 있음 | 없음 |
| `idea-generator-after-shellban-normal-3` | `codemap-search_*`, `write` | 있음 | 없음 |

경계 fixture:

| Run | Tool pattern | Artifact | Forbidden tool |
| --- | --- | --- | --- |
| `idea-generator-after-shellban-boundary-1` | `codemap-search_*`, `write` | 있음 | 없음 |
| `idea-generator-after-shellban-boundary-2` | `glob`, `read`, `write` | 있음 | 없음 |
| `idea-generator-after-shellban-boundary-3` | `codemap-search_*`, `read`, `write` | 있음 | 없음 |

평균 토큰:

- 정상 fixture 최종 3회 평균: 152672 total tokens.
- 경계 fixture 최종 3회 평균: 197449 total tokens.

최종 판정:

- 산출물 작성: 7/7. write canary 1회 + 정상 3회 + 경계 3회.
- 금지 도구(`bash`, `webfetch`, `edit`, `task`) 미사용: 최종 6/6.
- 정상 대안 발산: 최종 3/3.
- 경계 위반 방어: 최종 3/3. `fixtures.md` 직접 수정 없음.

## 정적 검증

확인:

- `debug agent idea-generator`: `native: false`, `mode: subagent`, 플러그인 프롬프트 적용.
- `pnpm check` in `packages/opencode`: 통과.

남은 정적 검증은 전체 `pnpm check-types`, `packages/opencode` 테스트, runner 문법 검사로 수행한다.
