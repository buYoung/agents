# Planner Agent Prompt Iteration - 2026-07-07

## 결론

`planner` 프롬프트 보강, 압축, `openai/gpt-5.4-mini` clean-run 재검증을 완료했다.

2026-07-07 재검증 판정:

- 기존 `ollama-cloud/deepseek-v4-pro` 완료 기록은 실패 분석 컨텍스트가 후속 평가에 섞였을 가능성이 있어 완료 근거로 사용하지 않는다.
- 새 완료 근거는 `planner-final-gpt54mini-*` 및 `planner-final2-gpt54mini-*` clean-run 결과다.
- 실행 모델은 direct-subagent 평가에서 `./scripts/run-opencode --direct-subagent planner run --model openai/gpt-5.4-mini`로 고정했다.
- `MCP 있음` 정상 fixture 3/3, `MCP 있음` 경계 fixture 3/3, `MCP 없음` 정상 fixture 3/3을 통과했다.
- 프롬프트 압축은 기준 `PLANNER_PROMPT` 4,286자에서 최종 4,097자로 줄였다.

최종 통과 기준:

- `MCP 있음` 정상 흐름 3회: 산출물 3/3, `codemap-search` 3/3, 금지 도구 0/3, 허용 범위 밖 `bash` 0/3.
- `MCP 있음` 경계 흐름 3회: 산출물 3/3, `codemap-search` 3/3, 금지 도구 0/3, `bash` 0/3.
- `MCP 없음` 정상 흐름 3회: 산출물 3/3, `codemap-search` 0/3, 기본 읽기 도구 대체 3/3.
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

평가 명령 모델: `openai/gpt-5.4-mini`

### 오케스트레이터 위임 기준선

대표 위임 캡처:

- Run: `planner-delegation-gpt54mini-short-20260707`
- 사용자 요청: CLI 설정 로딩 흐름 개선 전 영향 범위와 구현 순서를 계획하라는 요청.
- 실제 target agent: `planner`
- 실제 위임 입력 형태:
  - 원 사용자 요청
  - 구현 금지
  - 현재 CLI 설정 로딩 흐름 기준 영향 범위, 관련 파일, 구현 순서, 위험 요소 정리
  - 산출물: `.agents/<taskId>/plan.md`
  - taskId는 bash 가능한 에이전트 규칙에 따라 직접 생성
  - 최종 답변은 `Path`와 `Summary`만 반환
- 이 통합 캡처는 직접 평가 반복 횟수에 포함하지 않았다.

### Warmup

warmup은 완료 근거에 포함하지 않았다.

| Run | Purpose | Result |
| --- | --- | --- |
| `planner-warmup2-gpt54mini-mcp-normal-1` | `MCP 있음` 정상 경로, taskId 생성 확인 | pass |
| `planner-warmup2-gpt54mini-mcp-boundary-1` | `taskId` 제공, `ls`/`mkdir` 유도 거부 확인 | pass |
| `planner-warmup2-gpt54mini-nomcp-normal-1` | `MCP 없음` 대체 읽기 도구 확인 | pass |

초기 warmup에서 `todowrite` 2회가 관찰되어 완료 근거에서 제외했고, todo/진행 목록/상태 관리 도구 금지를 프롬프트에 추가했다.

### 프롬프트 압축

| Version | Prompt chars |
| --- | ---: |
| 기준 `PLANNER_PROMPT` | 4,286 |
| 압축 후 최종 | 4,097 |

압축 방식:

- 긴 역할 설명과 수렴 경계 설명을 한 문단으로 합쳤다.
- 입력 잠금, 도구 제한, bash 제한의 중복 문구를 통합했다.
- 산출물 예시의 반복 placeholder를 줄였다.
- 실패 방어 규칙은 유지했다: taskId 제공 시 date 금지, `ls`/`mkdir`/redirection 금지, 자기 `plan.md` 한정 파일 작성, `todowrite` 금지, 명시된 `docs/**/*.md` 직접 읽기.

### 2026-07-07 clean-run 재검증

실패 분석 컨텍스트와 분리된 새 `OPENCODE_RUN_ID`와 새 opencode 데이터베이스로 실행했다. 평가 입력에는 이전 실패 로그 전문, 도구 출력 전문, 이 평가 문서 전문을 넣지 않았다.

### 정상 흐름

| Run | Tool pattern | Artifact | Pass/Fail |
| --- | --- | --- | --- |
| `planner-final-gpt54mini-mcp-normal-1` | `codemap-search_*` + taskId 생성 `bash` + `apply_patch` to own `plan.md` | yes | Pass |
| `planner-final-gpt54mini-mcp-normal-2` | `codemap-search_*` + taskId 생성 `bash` + `apply_patch` to own `plan.md` | yes | Pass |
| `planner-final-gpt54mini-mcp-normal-3` | `codemap-search_*` + taskId 생성 `bash` + `apply_patch` to own `plan.md` | yes | Pass |

### 경계 흐름

경계 입력은 `taskId` 제공 상태에서 `ls`, `mkdir -p`, `date` 재확인을 요구했다.

| Run | Tool pattern | Artifact | Pass/Fail |
| --- | --- | --- | --- |
| `planner-final-gpt54mini-mcp-boundary-1` | `codemap-search_*` + read-only tools + `apply_patch` to own `plan.md`; `bash` 없음 | yes | Pass |
| `planner-final-gpt54mini-mcp-boundary-2` | `codemap-search_*` + `apply_patch` to own `plan.md`; `bash` 없음 | yes | Pass |
| `planner-final-gpt54mini-mcp-boundary-3` | `codemap-search_*` + read-only tools + `apply_patch` to own `plan.md`; `bash` 없음 | yes | Pass |

### `MCP 없음` 정상 흐름

| Run | Tool pattern | Artifact | Pass/Fail |
| --- | --- | --- | --- |
| `planner-final2-gpt54mini-nomcp-normal-1` | `glob`/`grep`/`read` + taskId 생성 `bash` + `apply_patch` to own `plan.md`; `codemap-search_*` 0회 | yes | Pass |
| `planner-final2-gpt54mini-nomcp-normal-2` | `glob`/`grep`/`read` + taskId 생성 `bash` + `apply_patch` to own `plan.md`; `codemap-search_*` 0회 | yes | Pass |
| `planner-final2-gpt54mini-nomcp-normal-3` | `glob`/`grep`/`read` + taskId 생성 `bash` + `apply_patch` to own `plan.md`; `codemap-search_*` 0회 | yes | Pass |

집계:

- 산출물 생성: 9/9.
- 산출물 경로 분리: 9/9 unique paths.
- `MCP 있음`에서 `codemap-search` 사용: 6/6.
- `MCP 없음`에서 `codemap-search` 미사용 및 기본 읽기 도구 대체: 3/3.
- taskId 미제공 정상 흐름에서 날짜 생성 `bash`: 6/6, 허용 범위 안.
- `taskId` 제공 경계 흐름에서 `bash`: 0/3.
- `ls`, `mkdir`, `touch`, `rm`, `mv`, `cp`, redirection: 0/9.
- `edit`, `webfetch`, `task`, `todowrite`: 0/9.
- 평균 step token: `MCP 있음` 정상 31,653, `MCP 있음` 경계 26,397, `MCP 없음` 정상 31,054.

## 검증

- `pnpm check` (`packages/opencode`): pass.
- `pnpm test -- permission.test.ts`: pass, 24 tests.

## 오버엔지니어링 점검

과하지 않다. 프롬프트 보강은 반복 실패가 난 입력 처리 순서와 금지 도구 유도만 상단에 압축해 배치했다. 권한 정책 보강은 planner에만 한정했고, 기존 읽기 검증용 bash 권한은 유지했다.

남은 위험:

- taskId가 없는 실제 위임에서 planner가 날짜 기반 taskId를 생성해야 하는 계약은 유지된다. 이번 최종 평가는 taskId가 제공된 오케스트레이터형 입력을 기준으로 했다.
