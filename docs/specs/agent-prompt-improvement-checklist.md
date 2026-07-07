# Agent Prompt Improvement Checklist

## 1. Purpose

이 문서는 `orchestrator`를 제외한 나머지 8개 agent의 시스템 프롬프트를 순서대로 개선할 때 사용하는 실행 체크리스트 초안이다.

기준은 `agent-prompt-iteration-and-compression-guidelines.md`의 공통 평가 축이다. 이 문서는 그 기준을 실제 작업 순서와 agent별 확인 항목으로 바꾼다.

## 2. Remaining Agent Improvement Order

`orchestrator`는 완료된 것으로 보고, 남은 8개 agent는 아래 순서로 진행한다.

| Order | Agent | Why this order |
| --- | --- | --- |
| 1 | `intent-checker` | 무상태 gate 계약을 먼저 고정한다. 파일 작성 없음, 도구 최소화, 진행/재분류 신호가 흔들리면 이후 계획 확인 흐름이 불안정해진다. |
| 2 | `research` | 외부 사실과 출처 품질을 먼저 고정한다. 최신 문서, 공식 API, 스키마 같은 외부 전제가 뒤 계획과 구현의 입력이 된다. |
| 3 | `explore` | 내부 코드 위치와 패턴 정찰 계약을 고정한다. 내부 사실 수집이 안정돼야 planner가 변경 범위를 올바르게 수렴한다. |
| 4 | `ideator` | 대안 발산 역할을 고정한다. 조사/탐색 결과를 바탕으로 대안을 만들되 실행 계획이나 구현으로 넘어가지 않게 경계를 잡는다. |
| 5 | `planner` | 앞단 evidence와 alternatives를 단일 실행 경로로 수렴하는 역할을 고정한다. worker가 따를 입력 품질을 결정한다. |
| 6 | `worker` | 실제 구현과 검증 실행 역할을 고정한다. 앞단 계약이 안정된 뒤 변경 책임과 검증 기록을 다룬다. |
| 7 | `adversarial-review` | 구현 결과에 대한 결함, 반례, 회귀 위험 검토를 고정한다. 실행 책임과 검토 책임이 섞이지 않게 한다. |
| 8 | `constructive-feedback` | 결함 판정 이후 품질 개선 피드백 역할을 고정한다. 수정 실행이나 최종 승인 판정으로 넘어가지 않게 한다. |

이 순서는 런타임 호출 순서를 그대로 복사한 것이 아니다. 프롬프트 개선 작업에서 앞 agent의 산출물이 뒤 agent의 입력 품질에 영향을 주는 정도를 기준으로 한다.

## 3. Progress Tracking

진행 상태는 이 문서에서 직접 갱신한다. 완료된 agent는 `Status`를 `complete`로 바꾸고, `Done` 체크박스를 `[x]`로 표시한다.

상태 값:

| Status | Meaning |
| --- | --- |
| `pending` | 아직 시작하지 않음 |
| `in-progress` | 현재 작업 중 |
| `blocked` | 평가 하네스, 권한, 사용자 결정 등으로 진행 불가 |
| `complete` | 완료 기준을 모두 만족함 |

전체 진행표:

| Done | Order | Agent | Status | Required completion evidence |
| --- | --- | --- | --- | --- |
| [x] | 1 | `intent-checker` | `complete` | `docs/evals/agent-prompts/intent-checker-iteration-20260707.md` |
| [ ] | 2 | `research` | `pending` | 계약 발견, fixture, 기준선, 프롬프트 변경, 3회 반복, 정적 검증 |
| [ ] | 3 | `explore` | `pending` | 계약 발견, fixture, 기준선, 프롬프트 변경, 3회 반복, 정적 검증 |
| [ ] | 4 | `ideator` | `pending` | 계약 발견, fixture, 기준선, 프롬프트 변경, 3회 반복, 정적 검증 |
| [ ] | 5 | `planner` | `pending` | 계약 발견, fixture, 기준선, 프롬프트 변경, 3회 반복, 정적 검증 |
| [ ] | 6 | `worker` | `pending` | 계약 발견, fixture, 기준선, 프롬프트 변경, 3회 반복, 정적 검증 |
| [ ] | 7 | `adversarial-review` | `pending` | 계약 발견, fixture, 기준선, 프롬프트 변경, 3회 반복, 정적 검증 |
| [ ] | 8 | `constructive-feedback` | `pending` | 계약 발견, fixture, 기준선, 프롬프트 변경, 3회 반복, 정적 검증 |

Agent별 세부 체크리스트는 완료 시 아래 원칙으로 갱신한다.

- 완료한 항목은 `[x]`로 바꾼다.
- 완료하지 못한 항목은 `[ ]`로 남기고 이유를 `Notes`나 평가 결과에 기록한다.
- `blocked`는 3회 반복 평가가 불가능하거나, direct-subagent 하네스 같은 선결 조건이 없을 때만 사용한다.
- `complete`는 `Completion Criteria Per Agent`의 모든 항목이 충족된 경우에만 사용한다.

## 4. Why This Checklist Exists

프롬프트 개선은 문장을 예쁘게 다듬는 작업이 아니다. agent가 자기 역할 계약을 실제 실행에서 안정적으로 지키게 만드는 작업이다.

이 체크리스트는 다음 문제를 막기 위해 만든다.

- 기존 프롬프트 문장을 진실 원천으로 삼는 문제
- fixture 정답을 프롬프트에 심는 문제
- 1회 실행 성공을 안정성으로 착각하는 문제
- 권한 밖 도구 사용을 응답 텍스트만 보고 놓치는 문제
- 프롬프트 압축 중 핵심 방어 규칙이 사라지는 문제
- 한 agent의 역할이 인접 agent 역할을 침범하는 문제
- agent 하나에서 발견한 실패를 모든 agent 공통 규칙으로 과도하게 확장하는 문제

따라서 모든 변경은 FDD, 권한 정책, 실행 문서 프로토콜을 먼저 확인하고, 실제 `tool_use` 이벤트와 산출물 계약으로 검증한다.

## 5. Common Checklist

각 agent마다 아래 순서로 진행한다.

### 5.1 Contract Discovery

- [ ] 대상 agent의 FDD를 읽는다.
- [ ] 대상 agent의 실행 모드(`primary`, `subagent`, `all`)를 확인한다.
- [ ] 권한 정책에서 허용/금지 도구를 확인한다.
- [ ] 실행 문서 프로토콜에서 소유 산출물 파일과 반환 규칙을 확인한다.
- [ ] 인접 agent와 겹치는 역할 경계를 정리한다.
- [ ] 기존 프롬프트는 마지막에 참고하되, 역할 판단의 최종 근거로 사용하지 않는다.

산출:

```text
Agent:
Unique role:
Allowed tools:
Forbidden tools:
Owned artifact:
Return contract:
Neighbor boundaries:
High-risk failure modes:
```

### 5.2 Evaluation Design

- [ ] 오케스트레이터가 호출하는 subagent라면 대표 orchestrator flow를 1회 실행해 실제 delegation input shape를 캡처한다.
- [ ] 정상 경로 fixture를 만든다.
- [ ] 경계 위반 fixture를 만든다.
- [ ] 모호한 입력 fixture를 만든다.
- [ ] 도구 지침 fixture를 만든다.
- [ ] 산출물 계약 fixture를 만든다.
- [ ] 필요한 경우 deep 흐름 fixture를 만든다.
- [ ] fixture 입력에는 기대 행동이나 실패 기준을 넣지 않는다.

각 fixture는 아래 공통 축 중 어떤 축을 보는지 명시한다.

- 역할 경계
- 권한 경계
- 입력 해석
- 실행 범위
- 산출물 계약
- 근거와 불확실성
- 도구 사용 충실도
- 실패 처리
- 최소성
- 재현 안정성

### 5.3 Baseline Run

- [ ] 프롬프트 변경 전 기준선 실행을 기록한다.
- [ ] 오케스트레이터 경유 대표 flow 기준선을 1회 실행하고, target agent에 들어간 실제 `task` 입력을 기록한다.
- [ ] 대상 agent를 어떤 평가 모드로 실행할지 확정한다.
- [ ] `mode: "subagent"` agent를 직접 평가하려면 평가 전용 하네스가 있는지 확인한다.
- [ ] `--agent <name>` 직접 실행에서 기본 agent fallback이 발생하면 해당 run을 무효로 기록한다.
- [ ] 실제 `tool_use` 순서와 대상 agent를 기록한다.
- [ ] 생성/수정된 파일이 있는지 확인한다.
- [ ] 산출물 형식이 계약과 맞는지 확인한다.
- [ ] 입력 토큰 또는 프롬프트 길이를 기록한다.
- [ ] 실패는 공통 평가 축 중 하나로 분류한다.

기준선 기록 형식:

```text
Fixture:
Run:
Evaluation mode:
Orchestrator delegation input:
Fallback:
Tool events:
Files changed:
Return format:
Pass/Fail:
Violated axis:
Notes:
```

### 5.4 Prompt Rewrite

- [ ] FDD와 권한 정책에 맞는 역할 정체성을 먼저 쓴다.
- [ ] 허용 행동과 금지 행동을 분리한다.
- [ ] 산출물 계약을 명시한다.
- [ ] 실패 처리와 불확실성 처리를 명시한다.
- [ ] 인접 agent와의 경계를 명시한다.
- [ ] 실패 하나당 가장 좁은 일반 규칙만 추가한다.
- [ ] fixture 문장, 정답 예시, 평가 전용 키워드를 넣지 않는다.
- [ ] 특정 사용자 환경의 도구명이나 검색 방식을 임의로 고정하지 않는다.

### 5.5 Prompt Compression

- [ ] 긴 예시는 일반 규칙으로 바꾼다.
- [ ] 반복 금지 문구는 하나의 경계 문장으로 합친다.
- [ ] agent 설명은 표나 짧은 목록으로 압축한다.
- [ ] 공통 prompt block과 중복되는 내용은 제거한다.
- [ ] 실제 실패를 막은 핵심 방어 규칙은 제거하지 않는다.
- [ ] 압축 전후 프롬프트 길이와 추정 토큰을 기록한다.

압축 성공 기준:

- 프롬프트 길이가 줄었다.
- 역할 계약이 약화되지 않았다.
- 같은 fixture 유형에서 3회 반복 통과한다.
- 실제 `tool_use`가 기대 계약과 일치한다.

### 5.6 Behavioral Retest

- [ ] 프롬프트 변경 후 기존 통과 횟수를 리셋한다.
- [ ] 각 핵심 fixture를 최소 3회 반복 실행한다.
- [ ] 3회 모두 같은 계약을 지키면 통과로 본다.
- [ ] 1회라도 실패하면 실패 원인을 기록하고 프롬프트를 최소 보강한 뒤 다시 3회 실행한다.
- [ ] 응답 텍스트가 아니라 실제 `tool_use`, 파일 변경, 반환 형식으로 판정한다.
- [ ] 직접 agent 평가 run에서 fallback이 하나라도 발생하면 3회 반복을 다시 시작한다.

반복 평가 기록 형식:

```text
Fixture type:
Run 1:
Run 2:
Run 3:
Pass rate:
Evaluation mode:
Fallback evidence:
Average input tokens:
Observed tool pattern:
Failure if any:
Prompt change if any:
```

### 5.7 Static and Runtime Verification

- [ ] 금지 도구명, fixture 전용 문장, 정답 힌트가 프롬프트에 남아 있지 않은지 검색한다.
- [ ] agent export, name, mode가 유지되는지 확인한다.
- [ ] 권한 정책과 프롬프트가 충돌하지 않는지 확인한다.
- [ ] 산출물 파일명과 프롬프트 지시가 충돌하지 않는지 확인한다.
- [ ] 평가 하네스가 있다면 운영 mode를 바꾸지 않고 평가 실행에서만 직접 선택을 허용하는지 확인한다.
- [ ] 평가 하네스가 없다면 `subagent` 직접 평가를 완료로 기록하지 않는다.
- [ ] TypeScript 변경이 있으면 `pnpm check-types`를 실행한다.
- [ ] 평가 러너 프로세스가 남아 있지 않은지 확인한다.

## 6. Evaluation Harness Requirement

현행 실행 계약에서 `mode: "subagent"` agent는 일반 `opencode run --agent <name>`으로 직접 실행할 수 없다. 직접 실행을 시도해 기본 agent로 fallback되면 그 run은 target agent 평가가 아니다.

반복강화에는 `scripts/run-opencode --direct-subagent <agent> run ...` 평가 전용 하네스를 사용한다. 이 하네스는 per-run config override로 대상 agent만 평가 실행에서 primary처럼 선택하고, 운영 source의 `mode` 값은 바꾸지 않는다.

하네스 요구사항:

- [ ] 운영 agent definition의 mode를 변경하지 않는다.
- [ ] 평가 실행에서만 target subagent를 직접 선택 가능하게 한다.
- [ ] 대상 agent의 원래 권한 정책을 유지한다.
- [ ] 입력은 실제 orchestrator 위임과 유사한 delegation-style input을 사용한다.
- [ ] JSON event를 저장한다.
- [ ] `tool_use`, token, 파일 변경 여부, fallback 경고를 추출한다.
- [ ] fallback이 감지되면 해당 run을 실패 또는 무효로 기록한다.
- [ ] 3회 반복 실행과 평균 token 기록을 지원한다.

현재 가능한 평가:

| Agent | Direct eval now | Recommended interim mode |
| --- | --- | --- |
| `intent-checker` | 가능 (`--direct-subagent intent-checker`) | 직접 agent 계약 평가 |
| `research` | 가능 (`--direct-subagent research`) | 직접 agent 계약 평가 |
| `explore` | 가능 (`--direct-subagent explore`) | 직접 agent 계약 평가 |
| `ideator` | 가능 (`--direct-subagent ideator`) | 직접 agent 계약 평가 |
| `planner` | 가능 (`--direct-subagent planner`) | 직접 agent 계약 평가 |
| `worker` | 가능 (`mode: "all"`) | 직접 agent 계약 평가 |
| `adversarial-review` | 가능 (`--direct-subagent adversarial-review`) | 직접 agent 계약 평가 |
| `constructive-feedback` | 가능 (`--direct-subagent constructive-feedback`) | 직접 agent 계약 평가 |

## 7. Per-Agent Checklist Drafts

아래 항목은 각 agent 개선 시 우선 확인할 초안이다. 실제 평가 중 새 실패가 발견되면 해당 agent 항목에만 좁게 추가한다.

### 7.1 `intent-checker`

핵심 계약:

- [x] 무상태 gate로 동작한다.
- [x] 파일을 읽거나 쓰지 않는다.
- [x] taskId와 산출물 경로를 요구하지 않는다.
- [x] 사용자 의도와 제안 계획의 정렬 여부만 확인한다.
- [x] 계획을 새로 만들거나 실행 agent를 선택하지 않는다.
- [x] 사용자 확인이 없으면 진행을 확정하지 않는다.

평가 유형:

- 정상: 구체 계획과 사용자 확인 응답이 주어진다.
- 경계 위반: 파일 기록 또는 계획 작성을 요구한다.
- 모호성: 사용자 동의 문구는 있으나 확인 대상 계획이 없다.
- 출력 계약: 한 줄 진행/재분류/확인 필요 신호만 반환해야 한다.

### 7.2 `research`

핵심 계약:

- [ ] 외부 문서, 공식 참조, 최신 웹 사실 확인을 맡는다.
- [ ] 출처 있는 사실과 미확인 추론을 구분한다.
- [ ] 소스 변경을 하지 않는다.
- [ ] 최종 구현 계획을 확정하지 않는다.
- [ ] 외부 조사 결과를 자기 산출물에 남긴다.
- [ ] 한 줄 반환이나 파일 작성 금지 같은 위임 제약이 있으면 산출물 생성을 생략한다.
- [ ] 내부 코드 위치, 변경 범위, 구현 지시는 `planner` 또는 `worker` 경계로 남긴다.

평가 유형:

- 정상 외부 조사: webfetch 허용, 출처 기록, 자기 산출물 작성.
- 조사 범위 확인만: 외부 접속 없음, 파일 작성 없음, 한 줄 반환.
- 내부 코드 변경 요구: 조사와 구현을 분리, 수정하지 않음.
- 출처 불확실성: 공식 출처가 없으면 미확인으로 기록.
- 내부 경로 혼입 방지: 사용자 미지정 내부 경로를 임의로 넣지 않음.

### 7.3 `explore`

핵심 계약:

- [ ] 내부 코드 위치, 파일, 심볼, 반복 패턴을 읽기 전용으로 찾는다.
- [ ] bash를 실행하지 않는다.
- [ ] webfetch를 사용하지 않는다.
- [ ] 파일을 수정하지 않는다.
- [ ] 구현 계획을 확정하지 않는다.
- [ ] 발견/미발견과 탐색 범위를 구분해 기록한다.

평가 유형:

- 정상 탐색: 내부 위치와 패턴을 찾아 자기 산출물에 기록.
- 경계 위반: bash 실행이나 파일 수정을 요구.
- 모호성: 찾지 못한 항목을 꾸며내지 않아야 함.
- 도구 지침: 읽기 전용 제약과 실제 도구 사용 일치.

### 7.4 `ideator`

핵심 계약:

- [ ] 서로 다른 대안과 트레이드오프를 발산한다.
- [ ] 실행 계획을 확정하지 않는다.
- [ ] 파일을 수정하지 않는다.
- [ ] 명령 실행을 하지 않는다.
- [ ] 근거가 부족한 전제는 조건부로 표시한다.
- [ ] 권장 방향은 제시할 수 있지만 적용 결정은 하지 않는다.

평가 유형:

- 정상 대안 생성: 실질적으로 다른 복수 대안과 장단점 제시.
- 경계 위반: 선택한 대안을 바로 구현하거나 문서 수정 요구.
- 모호성: 코드 구조를 확인하지 않은 전제를 단정하지 않음.
- 산출물 계약: 아이디어 산출물에만 기록.

### 7.5 `planner`

핵심 계약:

- [ ] 구현 전 영향 범위, 위험, 순서를 수렴한다.
- [ ] 단일 실행 경로로 계획을 정리한다.
- [ ] 필요한 경우 taskId를 생성한다.
- [ ] 소스 변경을 하지 않는다.
- [ ] 웹 조사를 직접 수행하지 않는다.
- [ ] 미확인 외부 사실은 `research` 필요 항목으로 남긴다.

평가 유형:

- 정상 계획: 내부 영향 범위와 실행 순서를 수렴.
- 경계 위반: 계획 중 파일 수정 요구.
- 외부 사실 부족: 최신 정책을 출처 없이 단정하지 않음.
- 산출물 계약: `plan.md`에 계획과 taskId 기록.

### 7.6 `worker`

핵심 계약:

- [ ] 확정된 변경을 직접 수행한다.
- [ ] 필요한 소스 읽기, 파일 수정, 명령 실행, 검증을 수행한다.
- [ ] 다른 agent로 재위임하지 않는다.
- [ ] 변경 내용과 검증 결과를 기록한다.
- [ ] 검증 실패나 미실행을 숨기지 않는다.
- [ ] 목표가 불충분하면 확인한 사실과 필요한 입력을 남긴다.

평가 유형:

- 정상 구현: 좁은 변경과 가능한 검증 수행.
- 경계 위반: planner/research에게 다시 맡기라는 요구.
- 모호성: 불분명한 목표로 광범위 수정하지 않음.
- 검증 계약: 실제 명령 결과와 산출물 기록 일치.

### 7.7 `adversarial-review`

핵심 계약:

- [ ] 결함, 반례, 회귀, 보안, 호환성 위험을 우선 찾는다.
- [ ] 직접 수정하지 않는다.
- [ ] 최종 승인/불승인 결정을 대신하지 않는다.
- [ ] 근거와 심각도를 분리해 기록한다.
- [ ] 발견 없음과 검토 불충분을 구분한다.

평가 유형:

- 정상 검토: 위험과 실패 시나리오를 근거와 함께 제시.
- 경계 위반: 문제를 직접 고치라는 요구.
- 모호성: 검토 대상이 없는데 안전하다고 단정하지 않음.
- 출력 계약: 발견 사항 중심, 수정 실행 없음.

### 7.8 `constructive-feedback`

핵심 계약:

- [ ] 품질 개선 관찰, 근거, 권장 조치를 제시한다.
- [ ] 직접 수정하지 않는다.
- [ ] 결함 발굴만 하는 adversarial-review 역할로 흐르지 않는다.
- [ ] 최종 적용 결정을 대신하지 않는다.
- [ ] 근거가 약한 제안은 확인 필요로 표시한다.

평가 유형:

- 정상 피드백: 유지보수성, 가독성, 컨벤션 개선 제안.
- 경계 위반: 직접 문서나 코드 정리를 요구.
- 모호성: 막연한 선호를 확정 개선사항처럼 말하지 않음.
- 출력 계약: 관찰, 근거, 권장 조치 중심.

## 8. Completion Criteria Per Agent

agent 하나의 프롬프트 개선은 아래 조건을 만족해야 완료로 본다.

- [ ] Contract Discovery 완료
- [ ] 평가 fixture 초안 작성
- [ ] 기준선 실행 기록
- [ ] 평가 실행 모드와 fallback 여부 기록
- [ ] 프롬프트 변경 적용
- [ ] 압축 전후 길이 기록
- [ ] 핵심 fixture 3회 반복 통과
- [ ] 실패가 있었다면 실패 분류와 보강 내용 기록
- [ ] 정적 검색 통과
- [ ] 필요한 타입 검증 통과
- [ ] 최종 변경 범위와 남은 위험 보고

## 9. Notes

이 문서는 초안이다. 실제 8개 agent를 순서대로 개선하면서 실패 유형이 더 나오면 공통 기준이 아니라 해당 agent 섹션이나 평가 결과에만 좁게 추가한다.

공통 기준을 쉽게 늘리면 모든 agent 프롬프트가 과도하게 길어진다. 공통 기준은 보수적으로 유지하고, agent별 실패는 해당 agent 문서나 평가 결과에 좁게 기록한다.
