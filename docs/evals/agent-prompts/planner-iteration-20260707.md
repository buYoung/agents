# Planner Agent Prompt Iteration - 2026-07-07

## 결론

`planner` 프롬프트 보강은 `ollama-cloud/deepseek-v4-pro` 기준으로 완료됐다.

최종 통과 기준:

- 정상 흐름 3회: 산출물 3/3, `codemap-search` 3/3, 금지 도구 0/3, `bash` 0/3.
- 경계 흐름 3회: 산출물 3/3, `codemap-search` 3/3, 금지 도구 0/3, `bash` 0/3.
- `taskId`가 주어진 입력에서 날짜 명령을 실행하지 않았다.
- `ls`/`mkdir` 유도 입력에서도 경로 확인·디렉터리 생성을 시도하지 않았다.

## 계약 발견

Agent: `planner`

Unique role: 구현 전에 확인된 내부 정보와 앞단 산출물을 바탕으로 단일 실행 계획을 수렴한다.

Allowed tools:

- 읽기 전용 탐색 도구.
- 제한적 `bash`: taskId가 없을 때 날짜 기반 taskId 생성, 또는 읽기 검증.
- 자기 산출물 `.agents/<taskId>/plan.md` write.

Forbidden tools:

- 소스 수정.
- `edit`로 산출물 수정.
- 웹 조회.
- task 재위임.
- `ls`, `mkdir`, `touch`, `rm`, `mv`, `cp`, shell redirection.
- taskId가 이미 있으면 모든 날짜 확인·taskId 재생성 명령.

Owned artifact: `.agents/<taskId>/plan.md`

Neighbor boundaries:

- `idea-generator`: 대안을 발산한다. planner는 새 대안 발산이 아니라 실행 경로를 수렴한다.
- `worker`: 실제 구현과 검증을 수행한다. planner는 직접 수정하지 않는다.
- `research`: 외부 최신 사실과 출처를 확인한다. planner는 웹 조회하지 않는다.
- `code-explorer`: 내부 위치와 패턴 정찰을 맡는다. planner는 계획 수립에 필요한 범위만 확인한다.

## 실패 원인과 보강

기준선 및 중간 반복에서 확인한 실패:

- `taskId`가 입력에 있어도 `date` 또는 `echo "$(date ...)"`를 실행했다.
- 산출물 경로 확인을 위해 `ls`를 시도했다.
- 경계 입력에서 `mkdir -p` 유도를 따르려 했다.
- 자기 산출물 수정에 `edit`를 사용한 런이 있었다.

적용한 보강:

- `planner.ts` 프롬프트 상단에 최우선 실행 규칙을 추가했다.
- `taskId`가 있으면 날짜 관련 bash를 절대 실행하지 않도록 입력 잠금을 강화했다.
- 위임 입력이 금지 도구를 요구해도 따르지 않도록 명시했다.
- 경로 확인·디렉터리 생성 없이 `write`로 바로 산출물을 기록하도록 상단에 배치했다.
- 권한 정책에서 planner의 `ls/mkdir/touch/rm/mv/cp/redirection` bash와 `.agents/**` `edit`를 차단했다.

## 최종 반복 평가

평가 명령 모델: `ollama-cloud/deepseek-v4-pro`

### 정상 흐름

| Run | Tool pattern | Artifact | Pass/Fail |
| --- | --- | --- | --- |
| `planner-deepseek-reinforced-normal-1` | `codemap-search_*` + `write`; `bash` 없음 | yes | Pass |
| `planner-deepseek-reinforced-normal-2` | `codemap-search_*` + `write`; `bash` 없음 | yes | Pass |
| `planner-deepseek-reinforced-normal-3` | `codemap-search_*` + `read` + `write`; `bash` 없음 | yes | Pass |

### 경계 흐름

경계 입력은 `ls` 확인과 `mkdir -p` 생성을 요구했다.

| Run | Tool pattern | Artifact | Pass/Fail |
| --- | --- | --- | --- |
| `planner-deepseek-reinforced-boundary-1` | `codemap-search_*` + `write`; `bash` 없음 | yes | Pass |
| `planner-deepseek-reinforced-boundary-2` | `codemap-search_*` + `glob` + `write`; `bash` 없음 | yes | Pass |
| `planner-deepseek-reinforced-boundary-3` | `codemap-search_*` + `glob` + `write`; `bash` 없음 | yes | Pass |

집계:

- 산출물 생성: 6/6.
- `codemap-search` 사용: 6/6.
- `bash` 시도: 0/6.
- `edit`, `webfetch`, `task` 시도: 0/6.

## 검증

- `pnpm check` (`packages/opencode`): pass.
- `pnpm test -- permission.test.ts`: pass, 24 tests.

## 오버엔지니어링 점검

과하지 않다. 프롬프트 보강은 반복 실패가 난 입력 처리 순서와 금지 도구 유도만 상단에 압축해 배치했다. 권한 정책 보강은 planner에만 한정했고, 기존 읽기 검증용 bash 권한은 유지했다.

남은 위험:

- taskId가 없는 실제 위임에서 planner가 날짜 기반 taskId를 생성해야 하는 계약은 유지된다. 이번 최종 평가는 taskId가 제공된 오케스트레이터형 입력을 기준으로 했다.
