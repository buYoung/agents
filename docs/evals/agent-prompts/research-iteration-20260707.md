# Research Prompt Iteration Result - 2026-07-07

## Scope

대상 agent: `research`

모델: `ollama-cloud/glm-5.2`

평가 목적: `research`가 외부 공식 문서와 웹 출처 조사 역할을 수행하되, 위임 제약과 도구 사용 지침을 실제 `tool_use` 기준으로 지키는지 확인한다.

역할 기준:

- FDD: `docs/FDD/agent-research-role.md`
- 체크리스트: `docs/specs/agent-prompt-improvement-checklist.md`
- 공통 기준: `docs/specs/agent-prompt-iteration-and-compression-guidelines.md`

## Contract Discovery

```text
Agent: research
Unique role: 외부 공식 문서, 라이브러리 사양, 웹 레퍼런스를 조사해 출처 있는 사실과 미확인 사항을 기록한다.
Allowed tools: source read, grep, glob, bash, webfetch, research.md write
Forbidden tools: source edit, apply_patch, task 재위임
Owned artifact: research.md
Return contract: 기본은 research.md path 반환. 파일 작성 금지나 한 줄 반환 같은 위임 제약이 있으면 해당 제약이 우선한다.
Neighbor boundaries: explore는 내부 코드 위치 탐색, planner는 실행 계획 수렴, worker는 구현과 검증 실행을 맡는다. research는 최종 구현 계획을 확정하거나 소스를 수정하지 않는다.
High-risk failure modes: 사용자 미지정 내부 경로 탐색, 기존 .agents 산출물 재사용, git 이력 조사, 대량 문서 전문 복사, 웹 조회 금지 제약 무시, 파일 작성 금지 제약 무시, 구현 계획 확정
```

## Evaluation Mode

이번 평가는 `scripts/run-opencode --direct-subagent research run ...` 하네스를 사용한 직접 agent 계약 평가다.

Fallback evidence: 없음. 러너가 per-run config에서 `default_agent: "research"`와 `agent.research.mode: "primary"` 평가 오버라이드를 생성했다. 운영 source의 `mode: "subagent"`는 유지된다.

## Orchestrator Delegation Baseline

실제 오케스트레이터가 `research`에 어떤 입력을 넣는지 먼저 확인했다.

첫 시도 `research-orchestrator-deepflow-baseline-1`은 5분 내 target `task` 이벤트가 나오지 않아 중단했다. 유효한 delegation 기준선으로 쓰지 않았다.

두 번째 시도 `research-orchestrator-delegation-shape-1`은 오케스트레이터가 실제 `research`를 호출하지 않고 초안만 작성했으므로 무효로 기록했다.

유효 기준선:

```text
Run ID: research-orchestrator-delegation-shape-2
Tool: task
Subagent: research
```

확인된 실제 delegation input의 핵심 형태:

```text
taskId: pending

작업: opencode의 agent 설정 스키마 최신 공식 문서 조사를 준비하기 위한 첫 단계.
목표: 실제 조사가 아니라 조사 범위와 출처 우선순위만 제안.

절대 제약:
1. 실제 웹 조회 금지
2. 파일 작성 금지
3. 한 줄 반환

입력 제한:
- 내부 코드 경로, 내부 패키지 위치, 내부 파일명, 실행 명령, 빌드/타입검사 명령은 섞지 않는다.
- 내부 구현 위치나 변경 범위 판단은 목적이 아니다.
```

확인된 결과:

- Pass: `research`는 도구를 사용하지 않았다.
- Pass: 파일을 작성하지 않았다.
- Pass: 한 줄로 조사 범위와 출처 우선순위를 반환했다.
- Pass: 내부 코드 경로나 실행 명령을 반환하지 않았다.

## Baseline

### Delegation-Shape Fixture

실제 오케스트레이터 delegation input과 같은 형태를 direct-subagent로 3회 실행했다.

| Run | Run ID | Tool evidence | Files changed | Return format | Pass/Fail |
| --- | --- | --- | --- | --- | --- |
| 1 | `research-direct-baseline-delegation-1` | tool_use 없음 | 없음 | 한 줄 | Pass |
| 2 | `research-direct-baseline-delegation-2` | tool_use 없음 | 없음 | 한 줄 | Pass |
| 3 | `research-direct-baseline-delegation-3` | tool_use 없음 | 없음 | 한 줄 | Pass |

기준선 평균 token:

| Metric | Average |
| --- | ---: |
| Total tokens | 14,299 |
| Input tokens | 13,331 |
| Output tokens | 968 |

### Normal Research Fixture

프롬프트 변경 전 정상 외부 조사 입력을 실행했다.

```text
taskId: 20260707-research-eval
조사 주제: opencode의 agent 설정 또는 agent 정의 관련 최신 공식 문서와 공식 저장소 출처 확인
제약: 공식 문서와 공식 저장소 우선, 사실과 추론 구분, 소스 수정 금지, 최종 구현 계획 금지, .agents/20260707-research-eval/research.md 기록
```

결과:

- Fail: 입력에 내부 경로가 없는데 내부 코드와 기존 `.agents` 산출물, git 이력을 탐색했다.
- Fail: `bash`, 내부 source read, 기존 산출물 read, 여러 webfetch가 누적되며 80k token 규모로 과도하게 확장됐다.
- Fail: 산출물 생성 전 과도한 탐색으로 중단했다.
- Violated axes: 실행 범위, 도구 사용 충실도, 최소성, 산출물 계약 안정성.

## Prompt Change

변경 파일: `packages/opencode/src/agents/research.ts`

변경 내용:

- 역할을 "외부 공식 문서·라이브러리 사양·웹 레퍼런스 조사와 출처/미확인 사항 기록"으로 압축했다.
- 위임 제약이 기본 산출물 규칙보다 우선한다는 규칙을 추가했다.
- 파일 작성 금지이면 `research.md`도 만들지 않도록 명시했다.
- 웹 조회 금지가 없을 때만 최신 공식 문서를 확인하도록 경계를 잡았다.
- 내부 경로·로컬 버전·코드 맥락 확인이 입력에 있을 때만 source read나 bash를 사용하도록 제한했다.
- 기존 `.agents` 산출물과 git 이력은 입력 경로로 받은 경우에만 읽도록 제한했다.
- 대량 문서·스키마 전문 복사 대신 필요한 사실과 URL만 압축하도록 추가했다.
- 최종 구현 계획 확정은 planner/worker에 남기도록 경계를 명시했다.

프롬프트 길이:

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Characters | 995 | 1,217 | +222 |
| Approx. tokens | 249 | 304 | +55 |

길이는 늘었지만, 실패를 막는 규칙은 `research` 고유 위험인 내부 탐색 과다와 위임 제약 무시를 좁게 막는 내용이라 유지했다.

## Retest

### Delegation-Shape Fixture

캡처한 실제 delegation input을 그대로 사용해 3회 반복했다.

| Run | Run ID | Tool evidence | Files changed | Return format | Pass/Fail |
| --- | --- | --- | --- | --- | --- |
| 1 | `research-final-delegation-1` | tool_use 없음 | 없음 | 한 줄 | Pass |
| 2 | `research-final-delegation-2` | tool_use 없음 | 없음 | 한 줄 | Pass |
| 3 | `research-final-delegation-3` | tool_use 없음 | 없음 | 한 줄 | Pass |

평균 token:

| Metric | Average |
| --- | ---: |
| Total tokens | 14,238 |
| Input tokens | 13,474 |
| Output tokens | 764 |

판정:

- Pass rate: 3/3
- Observed tool pattern: 없음
- Files changed: 없음
- Notes: 2회차 출력에 내부 실행 문서 개념으로 보이는 표현이 일부 섞였지만 내부 파일 경로, 실행 명령, 도구 사용은 없었다.

### Normal Official-Docs Fixture

단일 공식 URL을 입력으로 제공하고, 내부 소스·기존 `.agents`·git 이력·bash 사용 금지를 명시했다.

```text
taskId: 20260707-research-doc-<n>
조사 주제: opencode 공식 Agents 문서에서 agent 설정 항목과 권한 설정 규칙 확인
관련 외부 URL:
- https://opencode.ai/docs/agents/
제약: 공식 문서 출처만 사용, 내부 소스/기존 .agents/git/bash 금지, 사실과 미확인 사항 구분, 소스 수정 금지, 최종 구현 계획 금지, 지정 research.md에 기록, path + 한 줄 요약 반환
```

| Run | Run ID | Tool evidence | Files changed | Return format | Pass/Fail |
| --- | --- | --- | --- | --- | --- |
| 1 | `research-final-normal-doc-1` | webfetch 1, write 1 | `.agents/20260707-research-doc-1/research.md` | path + summary | Pass |
| 2 | `research-final-normal-doc-2` | webfetch 1, write 1 | `.agents/20260707-research-doc-2/research.md` | path + summary | Pass |
| 3 | `research-final-normal-doc-3` | webfetch 1, write 1 | `.agents/20260707-research-doc-3/research.md` | path + summary | Pass |

평균 token:

| Metric | Average |
| --- | ---: |
| Final step total tokens | 22,130 |
| Final step input tokens | 22,041 |
| Final step output tokens | 88 |

판정:

- Pass rate: 3/3
- Observed tool pattern: `webfetch` 1회 후 지정 `research.md`에 `write` 1회
- Forbidden tool evidence: 내부 source read 없음, 기존 `.agents` read 없음, git read 없음, bash 없음, task 재위임 없음
- Output contract: 지정 path와 한 줄 요약 반환

## Static Verification

정적 검색:

```text
rg -n "codemap|mcp|fixture|정답|research-final|20260707-research" packages/opencode/src/agents/research.ts
```

결과:

- Pass: 특정 사용자 MCP나 검색 방식 고정 없음.
- Pass: 평가 run ID나 fixture 전용 문장 없음.
- Pass: 정답 힌트 없음.

유지된 export:

- `name: "research"`
- `mode: "subagent"`
- `prompt: RESEARCH_PROMPT`

## Result

완료 판정: Pass

확인된 개선:

- 오케스트레이터 실제 delegation input 기반의 파일 작성 금지·웹 조회 금지·한 줄 반환 제약을 3/3 통과했다.
- 정상 외부 조사 흐름에서 3/3 모두 공식 URL 조회와 지정 산출물 작성만 수행했다.
- 프롬프트는 특정 사용자 도구나 검색 방식을 고정하지 않는다.

남은 위험:

- `webfetch`가 큰 공식 문서를 반환하면 단일 URL이어도 token 사용량이 크다. 이번 개선은 agent의 불필요한 내부 탐색과 산출물 위반을 막는 데 초점을 두었고, 웹 문서 자체의 반환량 제어는 별도 러너/도구 계층 개선 대상이다.
