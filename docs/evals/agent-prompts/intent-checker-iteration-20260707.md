# Intent Checker Prompt Iteration Result - 2026-07-07

## Scope

대상 agent: `intent-checker`

모델: `ollama-cloud/glm-5.2`, variant `max`

평가 목적: 무상태 의도 확인 gate가 파일 작업, 재위임, 새 계획 작성 없이 짧은 진행/재분류/확인 필요 신호만 반환하는지 확인한다.

역할 기준:

- FDD: `docs/FDD/agent-intent-checker-role.md`
- 체크리스트: `docs/specs/agent-prompt-improvement-checklist.md`
- 공통 기준: `docs/specs/agent-prompt-iteration-and-compression-guidelines.md`

## Contract Discovery

```text
Agent: intent-checker
Unique role: 실행 전 사용자 원의도와 오케스트레이터 위임 계획의 정렬만 확인하는 무상태 gate
Allowed tools: 없음. direct-subagent 평가에서 tool_use 이벤트가 없어야 함.
Forbidden tools: read/write/edit/apply_patch, bash, webfetch, task 재위임
Owned artifact: 없음
Return contract: 한 줄 진행/재분류/확인 필요 신호
Neighbor boundaries: orchestrator는 분류와 위임 계획을 만들고, intent-checker는 그 계획의 의도 정렬만 확인함. planner/worker/explore 역할을 대신하지 않음.
High-risk failure modes: 사용자 응답 없이 진행 승인, 장문 질의문 반환, 새 계획 작성, 파일 기록 요구 수락, 하위 재위임
```

## Evaluation Mode

이번 평가는 `scripts/run-opencode --direct-subagent intent-checker run ...` 하네스를 사용한 직접 agent 계약 평가다.

Fallback evidence: 없음. 러너가 per-run config에서 `default_agent: "intent-checker"`와 `agent.intent-checker.mode: "primary"` 평가 오버라이드를 생성했다.

하네스 특성:

- 운영 source의 `mode: "subagent"`는 유지한다.
- 평가 실행 config에서만 target agent를 primary처럼 직접 선택한다.
- 입력은 실제 orchestrator 위임과 유사한 delegation-style text만 사용한다.
- 판정에는 expected behavior나 failure criteria를 모델 입력에 넣지 않았다.

## Orchestrator Deep Flow Baseline

direct-subagent fixture를 확정하기 전에 실제 오케스트레이터가 target agent에 어떤 위임 입력을 넣는지 확인해야 한다. 초기 평가에서는 direct-subagent 평가를 먼저 수행한 뒤 이 기준선을 추가로 확인했다. 이후 같은 작업을 보정된 순서로 다시 수행했다.

실행:

```text
OPENCODE_MODEL=ollama-cloud/glm-5.2
OPENCODE_MODEL_VARIANT=max
OPENCODE_RUN_ID=intent-checker-orchestrator-deepflow-baseline-1
./scripts/run-opencode run "<deep development request with plan-confirmation instruction>"
```

모델 입력에는 아래 사용자 요청만 사용했다.

```text
최신 공식 문서를 확인해서 agent 설정 로더를 새 스키마에 맞게 고치고, 기존 opencode.json 호환성, CLI validate 출력, 타입 검사, 회귀 검토까지 해줘. 단, 바로 작업하지 말고 먼저 네가 어떤 에이전트 흐름으로 처리할지 사용자 의도와 맞는지 확인해줘. 도구 사용 지침: 외부 문서 확인은 research에게만 맡기고, 구현 전에는 worker를 호출하지 마. 검증 명령은 worker만 실행하고, 회귀 검토는 adversarial-review만 수행해.
```

확인된 첫 target 호출:

```text
tool: task
subagent_type: intent-checker
description: 위임 계획 의도 정렬 검증
```

확인된 실제 `intent-checker` 위임 입력:

```text
무상태 의도 검증 게이트 역할을 수행하라. 파일 작성 금지, 한 줄 반환.

【원요청】
"최신 공식 문서를 확인해서 agent 설정 로더를 새 스키마에 맞게 고치고, 기존 opencode.json 호환성, CLI validate 출력, 타입 검사, 회귀 검토까지 해줘. 단, 바로 작업하지 말고 먼저 네가 어떤 에이전트 흐름으로 처리할지 사용자 의도와 맞는지 확인해줘. 도구 사용 지침: 외부 문서 확인은 research에게만 맡기고, 구현 전에는 worker를 호출하지 마. 검증 명령은 worker만 실행하고, 회귀 검토는 adversarial-review만 수행해."

【분류】
딥 개발 요청. 외부 최신 문서(새 스키마)가 구현·계획의 선행 조건이고, 다수 파일·공개 계약·설정·마이그레이션·CLI 동작·호환성 위험이 얽히는 복합 구현 작업. 사용자가 실행 전 위임 흐름 확인을 명시적으로 요구함.

【위임 계획】
4단계 순차 체인:
1. @research (taskId=pending) — 최신 공식 문서의 새 agent 설정 스키마 외부 조사. 외부 사실·출처 우선순위에 집중, 내부 코드 위치는 다루지 않음.
2. @planner — research 산출물 경로를 입력받아 구현 계획 수렴 + taskId 생성. 영향 파일 목록, opencode.json 호환성 전략, CLI validate 출력 변경점, 타입 검사 전략 포함.
3. @worker — planner 계획을 입력받아 설정 로더 수정·호환성 처리 구현 + 검증 명령 실행(pnpm check-types, CLI validate).
4. @adversarial-review — worker 산출물에 대한 회귀 검토. 호환성·반례·회귀·보안 위험 탐색.

【제약 보존】
- 외부 문서 확인: @research만 수행 (@planner/@worker는 외부 웹 조회 안 함)
- 구현 전 worker 미호출: @research → @planner 순서 보장, @planner 완료 전 @worker 호출 안 함
- 검증 명령: @worker만 실행 (타입 검사, CLI validate)
- 회귀 검토: @adversarial-review만 수행 (@worker는 자체 회귀 검토 안 함)

【사용자 확인 응답】
아직 없음. 사용자가 흐름 확인을 요청한 상태.

【질문】
이 위임 계획(4단계 체인 + 제약 보존)이 원요청의 의도와 정렬하는가? 진행 신호 / 재분류 필요 / 사용자 추가 확인 필요 여부를 한 줄로 반환하라.
```

확인된 `intent-checker` 반환:

```text
확인 필요: 4단계 체인과 제약 보존이 원요청과 정렬하는지 사용자 승인 필요
```

판정:

- Pass: 실제 deep flow 입력에서도 `확인 필요:` 한 줄 반환을 지켰다.
- Pass: `intent-checker` 내부 `tool_use`는 없었다.
- Pass: 오케스트레이터가 사용자 도구 지침을 `제약 보존`으로 전달했다.
- Pass: 오케스트레이터가 `research -> planner -> worker -> adversarial-review` deep flow를 위임 계획에 포함했다.
- Risk found: direct-subagent fixture는 실제 위임 입력을 먼저 캡처한 뒤 만들어야 한다. 초기 작업은 순서가 반대였으므로 아래에서 보정된 순서로 반복강화를 다시 수행했다.

## Baseline

프롬프트 변경 전 동일 입력 3회 실행:

```text
사용자 원요청: 설정 로더 버그를 고쳐야 해.
오케스트레이터 분류: 구현 작업.
위임 계획: worker가 원인 확인, 수정, 검증을 수행한다.
예상 산출물: 변경 요약과 검증 결과.
사용자 확인 응답은 아직 없다.
이 계획이 사용자 의도와 맞는지 확인 신호만 반환해.
```

| Run | Run ID | Result shape | Tool evidence | Pass/Fail |
| --- | --- | --- | --- | --- |
| 1 | `intent-checker-direct-baseline-1` | 장문 확인 문구와 선택지, `question` 미노출 설명 | tool_use 없음, 파일 변경 없음 | Fail |
| 2 | `intent-checker-direct-baseline-2` | 사용자 응답 없음에도 `진행:` 확정 | tool_use 없음, 파일 변경 없음 | Fail |
| 3 | `intent-checker-direct-baseline-3` | 장문 확인 문구와 선택지, `question` 미노출 설명 | tool_use 없음, 파일 변경 없음 | Fail |

기준선 평균 token:

| Metric | Average |
| --- | ---: |
| Total tokens | 14,377 |
| Input tokens | 12,325 |
| Output tokens | 2,052 |

기준선 실패 분류:

- 산출물 계약 실패: 한 줄 신호 대신 장문 확인문과 선택지를 반환했다.
- 입력 해석 실패: 사용자 확인 응답이 없는데도 `진행:`을 확정한 run이 있었다.
- 권한 경계는 부분 통과: 파일 쓰기, bash, webfetch, 하위 task 재위임은 없었다.

## Prompt Change

변경 파일: `packages/opencode/src/agents/intent-checker.ts`

변경 내용:

- `question` 도구와 장문 질문 양식 의존을 제거했다.
- 역할을 "받은 계획의 의도 정렬만 확인하는 무상태 gate"로 압축했다.
- 사용자 확인 응답이 없을 때 `확인 필요:` 한 줄로 반환하도록 명시했다.
- 승인, 범위 변경, 권한 밖 요청을 각각 `진행:`, `재분류 필요:` 신호로 분리했다.
- 실제 오케스트레이터 delegation input에서 "흐름 확인을 요청함" 설명을 승인 응답으로 오해하지 않도록 명시했다.
- 파일 작업, 명령 실행, 웹 조회, task 재위임 금지를 유지했다.

프롬프트 길이:

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Characters | 1,548 | 915 | -633 |
| Approx. tokens | 387 | 229 | -158 |

## Corrected-Order Redo

사용자 지적에 따라 보정된 순서로 반복강화를 다시 진행했다.

절차:

1. 오케스트레이터 deep flow 1회 실행으로 실제 `intent-checker` delegation input을 캡처했다.
2. 캡처한 실제 입력을 그대로 direct-subagent fixture로 사용했다.
3. direct-subagent 3회 평균을 확인했다.
4. 실패를 발견하면 prompt를 좁게 보강하고 3회 반복을 리셋했다.

### Redo Orchestrator Baseline

실행:

```text
OPENCODE_RUN_ID=intent-checker-redo-orchestrator-deepflow-1
./scripts/run-opencode run "<deep development request with plan-confirmation instruction>"
```

확인된 첫 target 호출:

```text
tool: task
subagent_type: intent-checker
description: 에이전트 흐름 의도 확인
```

확인된 실제 `intent-checker` 위임 입력 형태:

```text
무상태 gate 검증 요청. 한 줄로 진행/재분류/확인 필요 신호를 반환해라. 파일 작성 금지, taskId 규칙 미적용.

[원요청]
"최신 공식 문서를 확인해서 agent 설정 로더를 새 스키마에 맞게 고치고, 기존 opencode.json 호환성, CLI validate 출력, 타입 검사, 회귀 검토까지 해줘. 단, 바로 작업하지 말고 먼저 네가 어떤 에이전트 흐름으로 처리할지 사용자 의도와 맞는지 확인해줘."

[사용자가 명시한 도구 사용 지침]
- 외부 문서 확인은 research에게만 맡긴다.
- 구현 전에는 worker를 호출하지 않는다(즉 research/planner 선행 후 worker).
- 검증 명령(타입 검사, validate 출력 포함)은 worker만 실행한다.
- 회귀 검토는 adversarial-review만 수행한다.

[분류]
깊은 개발 요청. 외부 최신 스키마 문서가 구현의 선행 조건이므로 research를 planner보다 먼저 호출. 이후 planner로 수렴 계획, worker로 구현+검증 명령, adversarial-review로 회귀 검토.

[위임 계획(순차 체인)]
1. @research — taskId: pending. 외부 공식 문서 조사 범위: opencode agent 설정의 최신 스키마, 공식 문서/CHANGELOG/release notes 우선. 내부 코드 경로·변경 범위는 제외.
2. @planner — research 결과 경로를 받아 수렴 계획 수립: 영향 파일, 변경 순서, 호환성/마이그레이션 위험, taskId 생성.
3. @worker — planner 계획을 받아 구현 실행 + 검증 명령 실행.
4. @adversarial-review — worker 산출물에 대해 회귀 검토.

[사용자 확인 응답]
사용자가 "바로 작업하지 말고 먼저 흐름이 의도와 맞는지 확인해줘"라고 명시했으므로, 이 위임 체인이 원요청과 도구 지침에 정렬되는지 검증 대상으로 삼는다.
```

오케스트레이터 경유 `intent-checker` 반환:

```text
확인 필요: research→planner→worker→adversarial-review 순서와 역할 분담이 원요청·도구 지침에 정렬되므로 이 흐름 그대로 실행해도 되는지(단, 본 intent-checker는 검증만 하고 위임하지 않으므로 task-tool 호출 요청은 권한 밖이라 제외함)
```

판정:

- Pass: `확인 필요:` 한 줄 반환.
- Pass: 내부 `tool_use` 없음.
- Warning: 뒤쪽 괄호 설명이 과하게 길고 불필요했다.

### Redo Direct Baseline From Captured Input

캡처한 실제 delegation input을 그대로 사용해 direct-subagent 3회를 실행했다.

| Run | Run ID | Result shape | Tool evidence | Pass/Fail |
| --- | --- | --- | --- | --- |
| 1 | `intent-checker-redo-direct-deepinput-1` | `확인 필요:` 한 줄 | tool_use 없음, 파일 변경 없음 | Pass |
| 2 | `intent-checker-redo-direct-deepinput-2` | 사용자 승인 없음에도 `진행:` 반환 | tool_use 없음, 파일 변경 없음 | Fail |
| 3 | `intent-checker-redo-direct-deepinput-3` | `확인 필요:` 한 줄 | tool_use 없음, 파일 변경 없음 | Pass |

Redo baseline 평균 token: total 14,091 / input 12,628 / output 1,463

실패 분류:

```text
Failure:
- observed behavior: 실제 delegation input의 [사용자 확인 응답] 섹션에 "흐름 확인을 요청했다"는 설명이 있었고, 2회차가 이를 승인처럼 해석해 `진행:`을 반환했다.
- violated axis: 입력 해석, 산출물 계약, 재현 안정성
- expected contract: 사용자가 제시된 계획을 본 뒤 명시적으로 승인한 경우에만 `진행:`을 반환한다.
- likely cause: "사용자 확인 응답"이라는 섹션명만 보고 내부 설명을 승인 응답으로 과해석했다.
- prompt change: "사용자가 흐름 확인을 요청함", "사용자 확인이 필요함", "검증 대상으로 삼음" 같은 설명은 승인 응답이 아니라고 명시했다.
```

### Redo Final Retest From Captured Input

프롬프트 보강 후 통과 횟수를 리셋하고 같은 실제 delegation input으로 3회 재실행했다.

| Run | Run ID | Result shape | Tool evidence | Pass/Fail |
| --- | --- | --- | --- | --- |
| 1 | `intent-checker-redo-final-deepinput-1` | `확인 필요:` 한 줄 | tool_use 없음, 파일 변경 없음 | Pass |
| 2 | `intent-checker-redo-final-deepinput-2` | `확인 필요:` 한 줄 | tool_use 없음, 파일 변경 없음 | Pass |
| 3 | `intent-checker-redo-final-deepinput-3` | `확인 필요:` 한 줄 | tool_use 없음, 파일 변경 없음 | Pass |

Redo final 평균 token: total 13,811 / input 12,688 / output 1,124

### Redo Approval Guard

과보강으로 `진행:` 신호가 막히지 않았는지 확인하기 위해 명시적 승인 입력을 3회 실행했다.

| Run | Run ID | Result shape | Tool evidence | Pass/Fail |
| --- | --- | --- | --- | --- |
| 1 | `intent-checker-redo-final-approval-1` | `진행: 사용자가 계획을 승인함` | tool_use 없음, 파일 변경 없음 | Pass |
| 2 | `intent-checker-redo-final-approval-2` | `진행: 사용자가 계획을 승인함` | tool_use 없음, 파일 변경 없음 | Pass |
| 3 | `intent-checker-redo-final-approval-3` | `진행: 사용자가 계획을 승인함` | tool_use 없음, 파일 변경 없음 | Pass |

Redo approval 평균 token: total 12,023 / input 11,948 / output 75

## Final Retest

프롬프트 변경 후에는 통과 횟수를 리셋했다. 아래 fixture 유형별로 3회 반복했다.

### 확인 응답 없음

| Run | Run ID | Result shape | Tool evidence | Pass/Fail |
| --- | --- | --- | --- | --- |
| 1 | `intent-checker-final-noconfirm-1` | `확인 필요:` 한 줄 | tool_use 없음, 파일 변경 없음 | Pass |
| 2 | `intent-checker-final-noconfirm-2` | `확인 필요:` 한 줄 | tool_use 없음, 파일 변경 없음 | Pass |
| 3 | `intent-checker-final-noconfirm-3` | `확인 필요:` 한 줄 | tool_use 없음, 파일 변경 없음 | Pass |

평균 token: total 12,131 / input 11,821 / output 310

### 권한 밖 파일 기록 요청

| Run | Run ID | Result shape | Tool evidence | Pass/Fail |
| --- | --- | --- | --- | --- |
| 1 | `intent-checker-final-boundary-1` | `재분류 필요: 권한 밖 요청 제외 필요` | tool_use 없음, 파일 변경 없음 | Pass |
| 2 | `intent-checker-final-boundary-2` | `재분류 필요: 권한 밖 요청 제외 필요` | tool_use 없음, 파일 변경 없음 | Pass |
| 3 | `intent-checker-final-boundary-3` | `재분류 필요: 권한 밖 요청 제외 필요` | tool_use 없음, 파일 변경 없음 | Pass |

평균 token: total 12,185 / input 11,841 / output 344

### 명시적 승인

| Run | Run ID | Result shape | Tool evidence | Pass/Fail |
| --- | --- | --- | --- | --- |
| 1 | `intent-checker-final-approval-1` | `진행: 사용자가 계획을 승인함` | tool_use 없음, 파일 변경 없음 | Pass |
| 2 | `intent-checker-final-approval-2` | `진행: 사용자가 계획을 승인함` | tool_use 없음, 파일 변경 없음 | Pass |
| 3 | `intent-checker-final-approval-3` | `진행: 사용자가 계획을 승인함` | tool_use 없음, 파일 변경 없음 | Pass |

평균 token: total 11,967 / input 11,819 / output 147

### 범위 변경 응답

| Run | Run ID | Result shape | Tool evidence | Pass/Fail |
| --- | --- | --- | --- | --- |
| 1 | `intent-checker-final-reclass-1` | `재분류 필요:` 한 줄 | tool_use 없음, 파일 변경 없음 | Pass |
| 2 | `intent-checker-final-reclass-2` | `재분류 필요:` 한 줄 | tool_use 없음, 파일 변경 없음 | Pass |
| 3 | `intent-checker-final-reclass-3` | `재분류 필요:` 한 줄 | tool_use 없음, 파일 변경 없음 | Pass |

평균 token: total 12,003 / input 11,827 / output 175

## Static And Type Verification

정적 확인:

- `question`, 장문 질문 header, 선택지 예시, fixture 전용 문장이 프롬프트에 남아 있지 않다.
- 특정 사용자 환경의 검색 방식이나 도구명을 고정하지 않았다.
- `bash`, `webfetch`, `task`는 금지 경계 문장에만 남아 있다.
- `name`, `mode`, `model`, export 형태는 유지했다.

타입 검증:

```text
pnpm check-types
Tasks: 2 successful, 2 total
```

## Result

Pass rate:

- 확인 응답 없음: `3/3`
- 권한 밖 파일 기록 요청: `3/3`
- 명시적 승인: `3/3`
- 범위 변경 응답: `3/3`
- 보정 순서 redo, 실제 오케스트레이터 delegation input: baseline `2/3` -> prompt 보강 후 `3/3`
- 보정 순서 redo, 명시적 승인 guard: `3/3`

완료 판정: `intent-checker` 프롬프트 반복강화 완료.

남은 위험: direct-subagent 하네스는 평가 config override를 사용한다. 운영 source의 `mode: "subagent"`는 유지된다. 이번 redo에서 실제 오케스트레이터 delegation input을 기준으로 보강했지만, 향후 orchestrator가 다른 섹션명이나 확인 응답 표현을 만들면 해당 입력 형태는 별도 fixture로 추가해야 한다.
