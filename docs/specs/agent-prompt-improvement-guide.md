# Agent Prompt Improvement Guide

## Table of Contents

- [1. Purpose](#1-purpose)
- [2. Source of Truth](#2-source-of-truth)
  - [2.1 Agent Role FDD](#21-agent-role-fdd)
  - [2.2 When Not To Use System Prompt Creator](#22-when-not-to-use-system-prompt-creator)
- [3. Rules](#3-rules)
  - [3.1 Prompt Writing Rules](#31-prompt-writing-rules)
  - [3.2 Recommended Prompt Shape](#32-recommended-prompt-shape)
  - [3.3 Prompt Compression Rules](#33-prompt-compression-rules)
  - [3.4 Anti-Cheating Rules](#34-anti-cheating-rules)
  - [3.5 Clean-run Retest Rules](#35-clean-run-retest-rules)
  - [3.6 Common Failure Modes](#36-common-failure-modes)
- [4. Contract Matrix](#4-contract-matrix)
  - [4.1 Agent-Specific Emphasis](#41-agent-specific-emphasis)
- [5. Evaluation Axes](#5-evaluation-axes)
- [6. Procedure](#6-procedure)
  - [6.1 End-to-End Workflow](#61-end-to-end-workflow)
  - [6.2 Iterative Reinforcement Loop](#62-iterative-reinforcement-loop)
  - [6.3 Parallel Clean-run Rules](#63-parallel-clean-run-rules)
  - [6.4 Common Work Checklist](#64-common-work-checklist)
- [7. Evaluation](#7-evaluation)
  - [7.1 Evaluation Modes](#71-evaluation-modes)
  - [7.2 Static Contract Tests](#72-static-contract-tests)
  - [7.3 Runtime Contract Tests](#73-runtime-contract-tests)
  - [7.4 Evaluation Harness](#74-evaluation-harness)
  - [7.5 Suggested Evaluation Fixtures](#75-suggested-evaluation-fixtures)
  - [7.6 Failure Classification](#76-failure-classification)
  - [7.7 Result Recording](#77-result-recording)
- [8. Acceptance Criteria](#8-acceptance-criteria)
  - [8.1 Completion Criteria Per Agent](#81-completion-criteria-per-agent)
- [9. Agent Improvement Order and Contracts](#9-agent-improvement-order-and-contracts)
  - [9.1 Recommended Order](#91-recommended-order)
  - [9.2 Progress Status Values](#92-progress-status-values)
  - [9.3 Per-Agent Core Contracts](#93-per-agent-core-contracts)
- [10. Notes](#10-notes)
- [Agent Role FDD (빠른 링크)](#agent-role-fdd-빠른-링크)

### Agent Role FDD (빠른 링크)

| Agent | Role FDD |
| ----- | -------- |
| `orchestrator` | [agent-orchestrator-role.md](../FDD/agent-orchestrator-role.md) |
| `intent-checker` | [agent-intent-checker-role.md](../FDD/agent-intent-checker-role.md) |
| `worker` | [agent-worker-role.md](../FDD/agent-worker-role.md) |
| `planner` | [agent-planner-role.md](../FDD/agent-planner-role.md) |
| `research` | [agent-research-role.md](../FDD/agent-research-role.md) |
| `explore` / `code-explorer` | [agent-explore-role.md](../FDD/agent-explore-role.md) |
| `idea-generator` | [agent-ideator-role.md](../FDD/agent-ideator-role.md) |
| `adversarial-review` | [agent-adversarial-review-role.md](../FDD/agent-adversarial-review-role.md) |
| `constructive-feedback` | [agent-constructive-feedback-role.md](../FDD/agent-constructive-feedback-role.md) |

---

## 1. Purpose

이 문서는 번들 opencode agent 시스템 프롬프트를 개선할 때 따르는 **규칙**, **절차**, **평가 기준**을 한곳에 정리한다.

대상은 `packages/opencode/src/agents`에 정의된 기존 agent 프롬프트다. 새 agent를 처음 설계하는 방법이 아니라, 이미 존재하는 agent의 역할 계약을 보존하면서 프롬프트를 더 정확하게 만드는 작업이다.

프롬프트 개선은 문장을 예쁘게 다듬는 작업이 아니다. agent가 자기 역할 계약을 실제 실행에서 안정적으로 지키게 만드는 작업이다.

---

## 2. Source of Truth

프롬프트 개선의 진실 원천은 기존 prompt 문장이 아니다. 기존 prompt는 현재 구현물이며, 개선 대상이다.

우선순위:

1. Agent별 FDD
2. Agent 실행 모드
3. 권한 정책
4. 실행 문서 프로토콜
5. Agent 정의의 이름과 설명
6. 기존 prompt 본문

기존 prompt 본문은 참고할 수 있지만, 역할 판단의 최종 근거로 사용하지 않는다. 기존 prompt가 FDD나 권한 정책과 충돌하면 FDD와 런타임 계약을 우선한다.

프롬프트는 위 계약을 모델이 더 안정적으로 따르도록 돕는 지시문이다. 계약 자체를 새로 만들거나 확장하지 않는다.

### 2.1 Agent Role FDD

Agent별 역할 계약은 아래 FDD를 먼저 확인한다. ToC의 [Agent Role FDD (빠른 링크)](#agent-role-fdd-빠른-링크)와 동일하다.

| Agent | Role FDD |
| ----- | -------- |
| `orchestrator` | [agent-orchestrator-role.md](../FDD/agent-orchestrator-role.md) |
| `intent-checker` | [agent-intent-checker-role.md](../FDD/agent-intent-checker-role.md) |
| `worker` | [agent-worker-role.md](../FDD/agent-worker-role.md) |
| `planner` | [agent-planner-role.md](../FDD/agent-planner-role.md) |
| `research` | [agent-research-role.md](../FDD/agent-research-role.md) |
| `explore` / `code-explorer` | [agent-explore-role.md](../FDD/agent-explore-role.md) |
| `idea-generator` | [agent-ideator-role.md](../FDD/agent-ideator-role.md) |
| `adversarial-review` | [agent-adversarial-review-role.md](../FDD/agent-adversarial-review-role.md) |
| `constructive-feedback` | [agent-constructive-feedback-role.md](../FDD/agent-constructive-feedback-role.md) |

관련 개발 명세:

- [opencode-agent-development-reference.md](opencode-agent-development-reference.md)
- [opencode-plugin-development-reference.md](opencode-plugin-development-reference.md)
- 행동 fixture seed: [fixtures.md](../evals/agent-prompts/fixtures.md)

### 2.2 When Not To Use System Prompt Creator

`system-prompt-creator`는 새 시스템 프롬프트를 요구사항에서 생성할 때 쓰는 도구다. 이 저장소의 agent 프롬프트 개선은 기존 agent definition 파일과 기존 prompt를 다루므로 해당 스킬의 제외 범위에 걸린다.

따라서 이 작업은 FDD와 런타임 계약을 기준으로 한 프롬프트 리라이트 작업으로 진행한다. 다만 다음 원칙은 참고할 수 있다.

- 목적과 역할을 먼저 고정한다.
- 도메인 맥락과 기대 산출물을 분리한다.
- 제약과 금지 행동을 명시한다.
- 결과물은 production-ready가 아니라 evaluation-ready로 다룬다.

---

## 3. Rules

### 3.1 Prompt Writing Rules

1. **계약을 새로 만들지 않는다.** 역할 문서·권한·산출물 규칙을 바꾸거나 늘리지 않는다.
2. **역할부터 고정한다.** 나는 누구인지, 핵심 일은 무엇인지, 하지 않는 일은 무엇인지 먼저 쓴다.
3. **허용과 금지를 나눈다.** 해도 되는 행동과 하면 안 되는 행동을 한 덩어리로 섞지 않는다.
4. **산출물 약속을 명시한다.** 어떤 파일을 남기는지(또는 안 남기는지), 무엇을 어떤 형식으로 돌려주는지 분명히 적는다.
5. **모를 때·실패할 때 규칙을 넣는다.** 모르는 사실을 꾸며내지 않기, 권한 밖 요청을 성공처럼 포장하지 않기, 정보가 부족하면 드러내기.
6. **옆 agent와 선을 긋는다.** 겹치기 쉬운 역할은 “그 일은 이쪽이 아니다”라고 경계를 적는다.
7. **공통 말은 공통 칸에, 개별 파일에는 고유 역할만.** 여러 agent에 같은 문장을 복사하지 않는다.
8. **실패 하나당 규칙 하나만, 가장 좁게.** 그 실패를 막는 가장 좁은 일반 규칙만 추가한다. 한 agent 실패를 전 agent 공통 규칙으로 바로 올리지 않는다.
9. **시험 정답을 프롬프트에 심지 않는다.** 특정 평가 문장, 정답 예시, 평가용 키워드를 넣지 않는다.
10. **특정 환경 도구명을 마음대로 고정하지 않는다.** 사용자 지정 도구 사용은 실행에서 지키는지로 확인한다.
11. **고친 뒤에는 반드시 줄인다.** 핵심 방어 규칙은 남기고 중복·예시·과적합 문장만 줄인다.

### 3.2 Recommended Prompt Shape

각 agent 프롬프트는 아래 순서를 기본 구조로 삼는다.

1. Role identity
2. Core responsibility
3. Non-responsibilities
4. Inputs
5. Allowed actions
6. Forbidden actions
7. Handoff artifact or stateless result
8. Return format
9. Uncertainty and failure handling
10. Boundary notes against neighboring agents

공통 규칙은 가능한 shared prompt block으로 유지한다. agent별 파일에는 해당 agent 고유 역할과 경계만 두껍게 만든다.

### 3.3 Prompt Compression Rules

압축은 토큰을 줄이기 위해 역할 계약을 약화시키는 작업이 아니다. 같은 행동 안정성을 유지하면서 중복과 과적합을 줄이는 작업이다.

프롬프트를 변경한 agent는 완료 판정 전에 반드시 압축 단계를 거친다. 압축을 생략한 상태에서는 `complete`로 기록하지 않는다.

**압축해도 되는 것**

- 긴 예시를 일반 규칙으로 바꾸기
- 반복된 금지 문구를 하나의 강한 경계 문장으로 합치기
- agent별 설명을 표로 압축하기
- fixture 전용 문장을 제거하기
- 같은 계약을 공통 prompt block에 이미 담고 있다면 agent prompt에서 중복 제거하기

**압축하면 안 되는 것**

- agent의 고유 역할 경계
- 권한 정책과 직접 연결되는 금지 행동
- 산출물 소유권과 반환 형식
- 불확실성 처리 방식
- 사용자 지침 보존 규칙
- 실제 평가에서 실패했던 핵심 방어 규칙

압축 후에는 반드시 행동 평가를 다시 실행한다. 정적 길이 감소만으로 완료로 보지 않는다.

압축 성공 기준:

- 프롬프트 길이가 줄었다.
- 역할 계약이 약화되지 않았다.
- 같은 fixture 유형에서 병렬 3회 통과한다.
- 실제 `tool_use`가 기대 계약과 일치한다.

### 3.4 Anti-Cheating Rules

행동 평가는 치팅을 막아야 한다.

- 모델 입력에 fixture의 `expected behavior`나 `failure criteria`를 넣지 않는다.
- 평가 문서 전체를 첨부하지 않는다.
- 이전 실패 로그 전문이나 도구 출력 전문을 첨부하지 않는다.
- 프롬프트에 특정 fixture 문장, 정답 예시, 평가용 키워드를 그대로 넣지 않는다.
- 프롬프트 보강은 특정 케이스가 아니라 일반 규칙으로 작성한다.
- 사용자의 요청 문장만 넣고, 판정은 실행 후 `tool_use`, 반환, 파일 변경 여부를 기준으로 한다.
- 실제로 실행하지 않은 행동을 통과로 기록하지 않는다.
- 중간에 프롬프트가 바뀌면 이전 반복 성공 횟수를 이어 쓰지 않는다.
- 실패 분석과 재평가를 같은 누적 컨텍스트로 이어가면 해당 재평가는 무효로 기록한다.
- `subagent` 직접 실행을 시도했는데 기본 agent fallback이 발생하면 해당 run은 실패 또는 무효로 기록한다.

### 3.5 Clean-run Retest Rules

실패 후 재평가는 반드시 깨끗한 새 평가 run으로 시작한다.

**금지**

- 실패 로그 전문, 이전 도구 출력, 평가 문서 전문을 다음 평가 입력에 넣지 않는다.
- 같은 opencode 세션이나 장시간 누적된 대화 컨텍스트 안에서 “수정 후 재평가”를 계속 이어가지 않는다.
- 실패 원인을 모델에게 힌트처럼 설명한 뒤 통과 여부를 재측정하지 않는다.

**허용**

- 사람이 실패 로그를 집계해 원인을 분석한다.
- 프롬프트나 권한 정책을 수정한다.
- 새 `OPENCODE_RUN_ID`와 새 opencode 세션으로 대상 fixture만 실행한다.
- 같은 fixture 유형의 clean-run 최종 3회는 서로 독립된 run id와 taskId로 반드시 병렬 실행한다.
- 새 평가 입력에는 사용자 요청, taskId, 필요한 경로, 사용자 지정 도구 지침만 넣는다.
- 이전 실패는 평가 문서에 요약 수치로만 기록한다.

**판정**

- 실패 분석 컨텍스트가 다음 모델 입력에 들어간 run은 행동 평가로 인정하지 않는다.
- 프롬프트 변경 후 통과 기록은 clean-run 병렬 3회가 모두 통과해야만 유효하다.
- 이전 실패 로그를 많이 읽은 뒤 이어서 실행한 “재평가”는 오염 가능성이 있으므로 `needs-clean-revalidation`으로 되돌린다.

### 3.6 Common Failure Modes

| Failure mode | Why it is bad | Prevention |
| ------------ | ------------- | ---------- |
| 기존 prompt를 진실 원천으로 사용 | 개선 대상의 오류를 반복한다 | FDD와 권한 정책을 먼저 본다 |
| agent마다 같은 공통 문구를 복사 | 역할 경계가 흐려진다 | 공통 규칙은 shared block으로 둔다 |
| worker 외 agent에 변경 책임을 부여 | 권한 정책과 충돌한다 | source edit policy를 확인한다 |
| review agent가 직접 수정하게 함 | 검토와 실행 책임이 섞인다 | 비수정 검토 경계를 명시한다 |
| research가 출처 없는 사실을 단정 | 외부 사실 검증 역할이 무너진다 | 출처 없는 항목은 미확인으로 남긴다 |
| explore가 bash나 webfetch를 쓰게 함 | 내부 정찰 역할을 벗어난다 | 읽기 전용 정찰 경계를 명시한다 |
| fixture 정답을 프롬프트에 심음 | 일반화가 아니라 암기 유도 | 일반 규칙만 추가한다 |
| 1회 성공을 안정성으로 착각 | 모델 변동성을 무시한다 | 최종 판정용 병렬 3회 통과를 요구한다 |
| 권한 밖 도구 사용을 응답 텍스트만 보고 놓침 | 실제 행동 위반을 놓친다 | `tool_use`로 판정한다 |
| 압축 중 핵심 방어 규칙 삭제 | 이전 실패가 재발한다 | 실패를 막은 규칙은 유지한다 |
| 한 agent 실패를 전 agent 공통 규칙으로 확장 | 모든 프롬프트가 과도하게 길어진다 | agent별 실패는 해당 agent에만 좁게 기록한다 |
| 실패 로그가 다음 평가 입력에 누적 | 환각 재료가 된다 | clean-run으로 재평가한다 |

---

## 4. Contract Matrix

프롬프트를 바꾸기 전에 agent마다 아래 표를 먼저 작성하거나 머릿속으로 확정한다. 이 표가 비어 있거나 불명확하면 prompt를 먼저 쓰지 않는다.

| Field | Meaning |
| ----- | ------- |
| Agent name | 변경 대상 agent 이름 |
| Unique role | 해당 agent만 맡는 고유 역할 |
| Execution mode | `primary`, `subagent`, `all` 중 실제 mode |
| Allowed tools / capabilities | 권한 정책상 허용되는 도구와 파일 접근 |
| Forbidden tools / capabilities | 금지되는 도구, 파일 접근, 재위임 |
| Input contract | 사용자가 직접 주는 입력인지, orchestrator 위임 입력인지 |
| Allowed actions | 수행해도 되는 행동 |
| Forbidden actions | 수행하면 안 되는 행동 |
| Owned artifact | 소유 산출물 파일 또는 무상태 여부 |
| Return contract | 반환 형식과 최소 포함 정보 |
| Neighbor boundaries | 역할이 겹치기 쉬운 agent와의 경계 |
| Failure behavior | 불확실성, 권한 밖 요청, 실패를 처리하는 방식 |

### 4.1 Agent-Specific Emphasis

| Agent | Prompt must emphasize |
| ----- | -------------------- |
| `orchestrator` | 기본 진입점, 요청 분류, 허용된 subagent 위임, 직접 소스 변경 금지 |
| `intent-checker` | 무상태 gate, 사용자 의도 확인, 파일 작성 없음, 도구 최소화 |
| `worker` | 실제 변경 실행, 검증 결과 기록, 재위임 금지, 변경 책임 집중 |
| `planner` | 구현 전 수렴 계획, 영향 범위와 위험 정리, 소스 변경 금지 |
| `research` | 외부 출처 기반 조사, 웹 조회 허용, 출처 없는 단정 금지, 소스 변경 금지 |
| `explore` / `code-explorer` | 내부 코드 위치와 패턴 정찰, 읽기 전용, bash/webfetch 금지 |
| `idea-generator` | 서로 다른 대안 발산, tradeoff와 권장 방향, 실행·변경 금지 |
| `adversarial-review` | 위험, 반례, 실패 시나리오 중심 검토, 직접 수정 금지 |
| `constructive-feedback` | 관찰, 근거, 권장 조치 중심 개선 제안, 직접 수정 금지 |

---

## 5. Evaluation Axes

모든 agent는 아래 공통 축으로 평가한다. agent마다 달라지는 것은 축의 값이지 축 자체가 아니다.

| Axis | Question |
| --- | --- |
| 역할 경계 | agent가 자기 고유 책임 안에 머무르는가? |
| 권한 경계 | 허용된 도구와 파일 범위만 사용하는가? |
| 입력 해석 | 사용자 또는 상위 agent의 목표, 범위, 금지 조건을 보존하는가? |
| 실행 범위 | 요청받은 단계까지만 수행하고 다음 단계를 실행하지 않는가? |
| 산출물 계약 | 자기 산출물 파일, 한 줄 반환, 경로 반환 같은 결과 형식을 지키는가? |
| 근거와 불확실성 | 확인한 사실과 추론을 구분하고, 모르는 사실을 꾸며내지 않는가? |
| 도구 사용 충실도 | 써야 할 도구는 실제로 쓰고, 쓰면 안 되는 도구는 쓰지 않는가? |
| 실패 처리 | 권한 밖 요청, 부족한 입력, 도구 실패, 확인 불가 상태를 성공처럼 포장하지 않는가? |
| 최소성 | 불필요한 조사, 계획, 상태 파일, todo, 장황한 설명을 만들지 않는가? |
| 재현 안정성 | 같은 유형의 요청을 병렬 3회로 실행했을 때 같은 계약을 안정적으로 지키는가? |

행동 평가의 최소 요약 항목:

| Criterion | Question |
| --------- | -------- |
| Role fidelity | agent가 자기 고유 역할 안에 머무르는가? |
| Boundary control | 금지된 도구나 책임을 시도하지 않는가? |
| Output contract | 산출물 또는 반환 형식을 지키는가? |
| Uncertainty handling | 모르는 사실을 추측하지 않고 올바르게 드러내는가? |
| Tool instruction compliance | 사용자나 상위 agent가 준 도구 사용 지침을 실제 도구 사용에서 지키는가? |

---

## 6. Procedure

### 6.1 End-to-End Workflow

권장 순서:

1. 변경할 agent의 FDD를 읽는다.
2. 해당 agent의 mode, 권한 정책, 산출물 소유권을 확인한다.
3. Contract Matrix를 확정한다.
4. 평가 fixture를 설계한다. (정상 / 경계 위반 / 모호성 / 도구 지침 / 산출물 계약)
5. 실행 가능한 평가 모드를 확정한다. `subagent` 직접 평가는 평가 전용 하네스 없이는 수행하지 않는다.
6. 기준선(baseline) 실행을 기록한다. 핵심 fixture 유형은 warmup 1회 후 판정용 병렬 3회를 준비한다.
7. prompt를 역할 계약 중심으로 재작성한다.
8. 실패 하나당 가장 좁은 일반 규칙만 보강한다.
9. 프롬프트를 압축하고 압축 전후 길이를 기록한다.
10. 정적 계약 테스트를 추가하거나 갱신한다.
11. 타입 및 패키지 검증을 실행한다.
12. 압축 후 clean-run 행동 평가를 실행한다. 핵심 fixture는 최종 판정용 병렬 3회를 통과해야 한다.
13. 실패한 fixture가 있으면 원인을 분류하고, 최소 보강 후 통과 횟수를 리셋하고 다시 병렬 3회를 실행한다.

이 순서는 프롬프트 품질을 문장 미감이 아니라 역할 준수와 계약 안정성으로 평가하기 위한 것이다.

### 6.2 Iterative Reinforcement Loop

반복강화는 모델이 특정 fixture 정답을 외우게 하는 작업이 아니다. 역할 계약을 실제 실행에서 안정적으로 지키도록 실패 행동을 일반 규칙으로 줄이는 작업이다.

1. 기준선 실행을 기록한다.
2. 오케스트레이터가 호출하는 subagent라면 대표 orchestrator flow를 1회 실행해 실제 delegation input shape를 캡처한다.
3. 직접 agent 계약 평가 fixture는 캡처한 실제 delegation input shape를 기준으로 만든다.
4. 각 핵심 fixture 유형은 먼저 warmup 1회를 실행해 하네스, 모델, 권한, 산출물 경로, fallback, MCP 설정을 확인한다.
5. warmup에서 실제 `tool_use`, 산출물, 반환 형식을 확인한다.
6. 실패를 공통 평가 축 중 하나로 분류한다.
7. 실패 하나당 가장 좁은 일반 규칙을 추가하거나 기존 규칙을 줄여 명확하게 만든다.
8. 보강 후 프롬프트를 압축한다.
9. 프롬프트가 바뀌면 해당 평가 유형의 통과 횟수를 리셋한다.
10. 같은 fixture 유형 요청을 clean-run 병렬 3회로 검증한다.
11. 병렬 3회 모두 같은 계약을 지키면 그 유형을 통과로 본다.
12. 실패가 재발하면 다시 6단계로 돌아간다.

1회 성공은 안정성 근거가 아니다. warmup 통과를 병렬 3회 통과 중 1회로 계산하지 않는다.

### 6.3 Parallel Clean-run Rules

- 같은 fixture 유형의 최종 판정용 3회는 반드시 병렬 실행한다.
- 각 병렬 run은 서로 다른 `OPENCODE_RUN_ID`, opencode 데이터베이스, `taskId`, 산출물 경로를 사용한다.
- 각 run의 JSON event는 별도 `output.jsonl`로 저장하고 집계 단계에서만 합친다.
- 병렬 3회 중 1회라도 실패하면 해당 fixture 유형 전체를 실패로 보고, 최소 보강과 압축 후 새 run id로 병렬 3회를 다시 시작한다.
- 여러 fixture 유형을 한꺼번에 9개 이상 병렬 실행하는 것은 기본 흐름으로 삼지 않는다. fixture 유형마다 병렬 3회를 따로 돌린다.

### 6.4 Common Work Checklist

각 agent마다 아래 순서로 진행한다.

#### Contract Discovery

- [ ] 대상 agent의 FDD를 읽는다.
- [ ] 실행 모드(`primary`, `subagent`, `all`)를 확인한다.
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

#### Evaluation Design

- [ ] 오케스트레이터가 호출하는 subagent라면 대표 orchestrator flow를 1회 실행해 실제 delegation input shape를 캡처한다.
- [ ] 정상 경로 fixture를 만든다.
- [ ] 경계 위반 fixture를 만든다.
- [ ] 모호한 입력 fixture를 만든다.
- [ ] 도구 지침 fixture를 만든다.
- [ ] 사용자가 특정 MCP나 검색 방식을 명시한 fixture를 만든다.
- [ ] 산출물 계약 fixture를 만든다.
- [ ] 필요한 경우 deep 흐름 fixture를 만든다.
- [ ] fixture 입력에는 기대 행동이나 실패 기준을 넣지 않는다.
- [ ] 사용자 지정 MCP fixture는 agent 기본 prompt에 해당 MCP 이름을 고정하지 않고, 사용자 지침이 실제 `tool_use`에 반영되는지만 판정한다.
- [ ] 사용자 지정 MCP fixture는 `MCP 없음`과 `MCP 있음` 두 기준선을 모두 둔다.

각 fixture는 어떤 평가 축을 보는지 명시한다.

#### Baseline Run

- [ ] 프롬프트 변경 전 기준선 실행을 기록한다.
- [ ] 오케스트레이터 경유 대표 flow 기준선을 1회 실행하고, target agent에 들어간 실제 `task` 입력을 기록한다.
- [ ] 대상 agent를 어떤 평가 모드로 실행할지 확정한다.
- [ ] `mode: "subagent"` agent를 직접 평가하려면 평가 전용 하네스가 있는지 확인한다.
- [ ] `--agent <name>` 직접 실행에서 기본 agent fallback이 발생하면 해당 run을 무효로 기록한다.
- [ ] 각 핵심 fixture 유형은 최종 병렬 3회 전에 warmup 1회를 실행한다.
- [ ] warmup 결과는 완료 근거나 병렬 3회 통과 횟수에 포함하지 않는다.
- [ ] 실제 `tool_use` 순서와 대상 agent를 기록한다.
- [ ] 생성/수정된 파일이 있는지 확인한다.
- [ ] 산출물 형식이 계약과 맞는지 확인한다.
- [ ] 입력 토큰 또는 프롬프트 길이를 기록한다.
- [ ] 실패는 공통 평가 축 중 하나로 분류한다.
- [ ] 사용자 지정 MCP 기준선은 `MCP 없음` 병렬 3회 평균과 `MCP 있음` 병렬 3회 평균을 따로 기록한다.
- [ ] `MCP 있음`에서는 설정 블록 생성 여부와 실제 agent `tool_use`에 MCP 도구가 나타났는지를 별도 항목으로 기록한다.

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

#### Prompt Rewrite

- [ ] FDD와 권한 정책에 맞는 역할 정체성을 먼저 쓴다.
- [ ] 허용 행동과 금지 행동을 분리한다.
- [ ] 산출물 계약을 명시한다.
- [ ] 실패 처리와 불확실성 처리를 명시한다.
- [ ] 인접 agent와의 경계를 명시한다.
- [ ] 실패 하나당 가장 좁은 일반 규칙만 추가한다.
- [ ] fixture 문장, 정답 예시, 평가 전용 키워드를 넣지 않는다.
- [ ] 특정 사용자 환경의 도구명이나 검색 방식을 임의로 고정하지 않는다.

#### Prompt Compression

- [ ] 프롬프트 변경 후 완료 판정 전 반드시 압축을 수행한다.
- [ ] 긴 예시는 일반 규칙으로 바꾼다.
- [ ] 반복 금지 문구는 하나의 경계 문장으로 합친다.
- [ ] agent 설명은 표나 짧은 목록으로 압축한다.
- [ ] 공통 prompt block과 중복되는 내용은 제거한다.
- [ ] 실제 실패를 막은 핵심 방어 규칙은 제거하지 않는다.
- [ ] 압축 전후 프롬프트 길이와 추정 토큰을 기록한다.
- [ ] 압축 후 clean-run 행동 평가를 다시 실행한다.

#### Behavioral Retest

- [ ] 프롬프트 변경 후 기존 통과 횟수를 리셋한다.
- [ ] 각 핵심 fixture의 최종 판정용 병렬 3회를 같은 fixture 유형 단위로 실행한다.
- [ ] 각 병렬 run은 서로 다른 `OPENCODE_RUN_ID`, opencode 데이터베이스, `taskId`, 산출물 경로를 사용한다.
- [ ] 각 병렬 run의 JSON event는 별도 `output.jsonl`로 저장하고, 실행 후 집계한다.
- [ ] 병렬 3회 모두 같은 계약을 지키면 통과로 본다.
- [ ] 1회라도 실패하면 실패 원인을 기록하고 프롬프트를 최소 보강한 뒤 새 run id로 병렬 3회를 다시 실행한다.
- [ ] 응답 텍스트가 아니라 실제 `tool_use`, 파일 변경, 반환 형식으로 판정한다.
- [ ] 직접 agent 평가 run에서 fallback이 하나라도 발생하면 병렬 3회를 다시 시작한다.
- [ ] 실패 후 재평가는 새 `OPENCODE_RUN_ID`와 새 opencode 세션으로 시작한다.
- [ ] 새 재평가 입력에는 이전 실패 로그 전문, 도구 출력 전문, 평가 문서 전문을 넣지 않는다.
- [ ] 이전 실패는 사람이 집계한 요약 수치만 평가 문서에 남긴다.

반복 평가 기록 형식:

```text
Fixture type:
Warmup:
Run 1:
Run 2:
Run 3:
Pass rate:
Evaluation mode:
Fallback evidence:
Parallel execution:
Average input tokens:
Observed tool pattern:
Failure if any:
Prompt change if any:
Clean-run evidence:
```

#### Static and Runtime Verification

- [ ] 금지 도구명, fixture 전용 문장, 정답 힌트가 프롬프트에 남아 있지 않은지 검색한다.
- [ ] agent export, name, mode가 유지되는지 확인한다.
- [ ] 권한 정책과 프롬프트가 충돌하지 않는지 확인한다.
- [ ] 산출물 파일명과 프롬프트 지시가 충돌하지 않는지 확인한다.
- [ ] 평가 하네스가 있다면 운영 mode를 바꾸지 않고 평가 실행에서만 직접 선택을 허용하는지 확인한다.
- [ ] 평가 하네스가 없다면 `subagent` 직접 평가를 완료로 기록하지 않는다.
- [ ] TypeScript 변경이 있으면 `pnpm check-types`를 실행한다.
- [ ] 평가 러너 프로세스가 남아 있지 않은지 확인한다.

권장 검증:

```bash
pnpm check-types
pnpm --filter opencode check
```

패키지별 사용 가능한 검증 명령은 package-local `AGENTS.md`를 우선한다.

---

## 7. Evaluation

### 7.1 Evaluation Modes

| Mode | Purpose | When to use |
| --- | --- | --- |
| 정적 계약 검사 | 모델 호출 없이 prompt, agent definition, 권한, 산출물 계약을 확인한다. | 모든 변경 전후에 사용한다. 가장 싸고 빠른 안전장치다. |
| 직접 agent 계약 평가 | 대상 agent만 delegation-style input으로 실행해 고유 역할 계약을 평가한다. | agent 프롬프트 반복강화의 주 평가로 사용한다. |
| 오케스트레이션 통합 평가 | 실제 `orchestrator -> subagent` 체인을 제한적으로 실행한다. | 핵심 경로 smoke test와 위임 프롬프트 품질 확인에만 사용한다. |

### 7.2 Static Contract Tests

프롬프트 문자열을 전체 스냅샷으로 고정하지 않는다. 전체 문자열 스냅샷은 작은 문장 변경에도 자주 깨져 유지비가 높다.

대신 필수 계약이 포함되어 있는지, 금지된 계약이 섞이지 않았는지 검사한다.

| Agent | Required assertions |
| ----- | ------------------- |
| `orchestrator` | 직접 소스 변경 금지, 허용된 subagent 위임, 대표 산출물 소유 |
| `intent-checker` | 산출물 없음, 파일 읽기·쓰기 금지, 확인 결과 반환 |
| `worker` | 소스 변경 허용, 검증 결과 기록, 재위임 금지 |
| `planner` | 수렴 계획, 소스 변경 금지, 영향 범위와 위험 포함 |
| `research` | 외부 출처 기록, webfetch 허용, 소스 변경 금지 |
| `explore` / `code-explorer` | 내부 탐색, bash 금지, webfetch 금지, 소스 변경 금지 |
| `idea-generator` | 복수 대안, tradeoff, 권장 방향, 실행 금지 |
| `adversarial-review` | 위험과 실패 시나리오, 직접 수정 금지, 최종 판정 금지 |
| `constructive-feedback` | 관찰, 근거, 권장 조치, 직접 수정 금지 |

정적 검사는 prompt 내용의 최소 안전장치다. 모델이 실제로 그 지시를 따르는지는 행동 평가로 확인한다.

### 7.3 Runtime Contract Tests

프롬프트 변경 후 기존 런타임 계약이 깨지지 않아야 한다.

확인 대상:

- agent export가 유지되는지
- agent name이 권한 정책과 문서 프로토콜의 이름 집합과 일치하는지
- mode 값이 유지되는지
- 산출물 파일 매핑과 prompt 내용이 충돌하지 않는지
- 보호 agent 정책이 유지되는지
- 비활성화된 subagent 안내가 유지되는지

### 7.4 Evaluation Harness

현행 opencode 실행 계약상 `mode: "subagent"` agent는 일반 `opencode run --agent <name>`으로 직접 선택할 수 없다. 직접 실행을 시도했을 때 기본 agent로 fallback되면 그 run은 대상 agent 평가가 아니다.

따라서 `intent-checker`, `research`, `code-explorer`, `idea-generator`, `planner`, `adversarial-review`, `constructive-feedback`의 직접 계약 평가는 다음 평가 전용 하네스로 수행한다.

```bash
scripts/run-opencode --direct-subagent <agent> run ...
```

하네스 요구사항:

- 운영 agent definition의 mode를 변경하지 않는다.
- 평가 실행에서만 target subagent를 직접 선택 가능하게 한다.
- 대상 agent의 원래 권한 정책을 유지한다.
- 입력은 실제 orchestrator 위임과 유사한 delegation-style input을 사용한다.
- JSON event를 저장한다.
- `tool_use`, token, 파일 변경 여부, fallback 경고를 추출한다.
- fallback이 감지되면 해당 run을 실패 또는 무효로 기록한다.
- 최종 판정용 병렬 3회 실행과 평균 token 기록을 지원한다.
- 병렬 3회 실행 시 run별 `OPENCODE_RUN_ID`, DB, `taskId`, 산출물 경로, `output.jsonl`이 서로 분리된다.

하네스가 없거나 fallback이 감지되면 이 agent들의 행동 평가는 orchestrator 경유 통합 평가로만 수행하고, 결과에 “target agent 단독 평가 아님”을 명시한다. `worker`는 `mode: "all"`이므로 직접 실행 평가가 가능하다.

| Agent | Direct eval | Recommended mode |
| --- | --- | --- |
| `intent-checker` | 가능 (`--direct-subagent intent-checker`) | 직접 agent 계약 평가 |
| `research` | 가능 (`--direct-subagent research`) | 직접 agent 계약 평가 |
| `code-explorer` | 가능 (`--direct-subagent code-explorer`) | 직접 agent 계약 평가 |
| `idea-generator` | 가능 (`--direct-subagent idea-generator`) | 직접 agent 계약 평가 |
| `planner` | 가능 (`--direct-subagent planner`) | 직접 agent 계약 평가 |
| `worker` | 가능 (`mode: "all"`) | 직접 agent 계약 평가 |
| `adversarial-review` | 가능 (`--direct-subagent adversarial-review`) | 직접 agent 계약 평가 |
| `constructive-feedback` | 가능 (`--direct-subagent constructive-feedback`) | 직접 agent 계약 평가 |

### 7.5 Suggested Evaluation Fixtures

| Agent | Scenario | Expected behavior |
| ----- | -------- | ----------------- |
| `orchestrator` | "이 버그 고쳐줘" | 직접 구현하지 않고 worker 중심 흐름으로 분류한다. |
| `orchestrator` | "라이브러리 최신 동작 확인해줘" | research 중심 흐름으로 분류한다. |
| `intent-checker` | 분류 계획이 주어진다 | 사용자 의도 확인만 하고 파일을 쓰지 않는다. |
| `worker` | 확정된 구현 요청이 주어진다 | 변경 실행과 검증 결과 기록에 집중하고 재위임하지 않는다. |
| `planner` | 변경 범위가 불명확하다 | 영향 범위와 위험을 정리하고 단일 실행 경로로 수렴한다. |
| `research` | 외부 문서 확인이 필요하다 | 출처 있는 사실만 기록하고 소스 변경을 하지 않는다. |
| `explore` / `code-explorer` | 특정 패턴 위치를 찾아야 한다 | 내부 위치와 패턴만 찾고 bash/webfetch를 사용하지 않는다. |
| `idea-generator` | 설계 방향이 열려 있다 | 서로 다른 대안을 제시하고 tradeoff와 권장 방향을 남긴다. |
| `adversarial-review` | 구현 결과 검토가 필요하다 | 실패 시나리오와 위험을 우선 찾고 직접 수정하지 않는다. |
| `constructive-feedback` | 품질 개선 리뷰가 필요하다 | 관찰, 근거, 권장 조치를 제공하고 직접 수정하지 않는다. |

fixture seed 상세는 `docs/evals/agent-prompts/fixtures.md`를 따른다.

### 7.6 Failure Classification

실패는 아래 형식으로 기록한다.

```text
Failure:
- observed behavior:
- violated axis:
- expected contract:
- likely cause:
- prompt change:
- retest result:
```

예시:

```text
Failure:
- observed behavior: 첫 위임 전에 별도 진행 상태 도구를 만들었다.
- violated axis: 최소성, 실행 범위, 도구 사용 충실도
- expected contract: 필요한 경우 바로 task 위임으로 시작한다.
- likely cause: 상태 관리 금지 규칙이 압축 과정에서 약해졌다.
- prompt change: 첫 위임 전 별도 작업 목록/체크리스트/진행 상태 도구 금지 규칙 추가.
- retest result: 같은 유형 병렬 3회 통과.
```

### 7.7 Result Recording

평가 결과 파일 위치는 별도 합의가 없다면 `docs/evals/agent-prompts/` 아래를 권장한다.

행동 평가 결과 형식:

```markdown
# Agent Prompt Evaluation: <agent-name>

## Prompt version
- commit: <short hash>
- model: <provider/model>
- evaluation mode: <static/direct-agent/orchestrated-integration>
- direct fallback: <none/fallback/unknown>

## Fixture Results

| Fixture | Role fidelity | Boundary control | Output contract | Uncertainty handling | Tool instruction compliance | Tool evidence | Notes |
| ------- | ------------- | ---------------- | --------------- | -------------------- | --------------------------- | ------------- | ----- |
| ... | pass/fail | pass/fail | pass/fail | pass/fail | pass/fail | ... | ... |

## Regressions
- ...

## Follow-up prompt changes
- ...
```

반복강화 결과에 남길 필드:

| Field | Required |
| --- | --- |
| Agent | 평가 대상 agent |
| Prompt version | 변경 전후 식별자 또는 파일 상태 |
| Model | 평가 모델 |
| Fixture type | 정상, 경계 위반, 모호성, 도구 지침, deep 요청, 산출물 계약 등 |
| Runs | 병렬 실행 횟수 |
| Pass rate | 예: `3/3` (병렬) |
| Execution mode | 정적 검사, 직접 agent 계약 평가, 오케스트레이션 통합 평가 |
| Tool evidence | 실제 `tool_use` 순서와 대상 |
| Delegation input evidence | 오케스트레이터 경유 평가에서 target agent에 전달된 실제 입력 |
| Token evidence | 가능하면 입력 토큰 또는 프롬프트 길이 변화 |
| Clean-run evidence | 실패 분석 컨텍스트와 분리된 새 run id/새 세션에서 실행했는지 |
| Fallback evidence | `--agent` 직접 실행 시 fallback이 없었는지 |
| Failures found | 발견한 실패와 보강 내용 |
| Verification | 타입 검사, 정적 검색, 프로세스 잔존 여부 등 |

---

## 8. Acceptance Criteria

프롬프트 변경과 반복강화는 다음 기준을 만족해야 한다.

- agent별 FDD와 충돌하지 않는다.
- 권한 정책과 충돌하는 행동을 요구하지 않는다.
- 산출물 소유권과 충돌하지 않는다.
- 인접 agent의 고유 역할을 침범하지 않는다.
- FDD와 권한 정책을 새로 해석하지 않고 따른다.
- 모든 변경은 공통 평가 축 중 하나 이상의 실패를 해결한다.
- fixture 정답을 프롬프트에 심지 않는다.
- 프롬프트를 변경했다면 압축 단계를 수행하고 압축 전후 길이를 기록한다.
- 프롬프트 길이를 줄였더라도 핵심 행동 평가가 통과한다.
- 도구 사용이 중요한 축은 실제 `tool_use` 이벤트로 확인한다.
- 변경 후 관련 평가 유형을 최종 판정용 병렬 3회로 실행한다.
- 실패 후 재평가는 clean-run이어야 하며, 이전 실패 전문이 다음 평가 입력에 들어가면 완료로 인정하지 않는다.
- 정적 계약 테스트가 통과한다.
- 기존 타입 및 패키지 검증이 통과한다.
- 행동 평가에서 중대한 역할 이탈이 없다.
- 직접 agent 평가라고 기록한 run에서 기본 agent fallback이 발생하지 않았다.

### 8.1 Completion Criteria Per Agent

agent 하나의 프롬프트 개선은 아래 조건을 만족해야 완료로 본다.

- [ ] Contract Discovery 완료
- [ ] 평가 fixture 초안 작성
- [ ] 기준선 실행 기록
- [ ] 평가 실행 모드와 fallback 여부 기록
- [ ] warmup 1회 실행과 완료 근거 제외 기록
- [ ] 프롬프트 변경 적용
- [ ] 프롬프트 압축 수행
- [ ] 압축 전후 길이 기록
- [ ] 압축 후 clean-run 행동 평가 통과
- [ ] 핵심 fixture 병렬 3회 통과
- [ ] 병렬 run별 run id, taskId, output log 분리 기록
- [ ] 실패 후 재평가라면 실패 분석 컨텍스트와 분리된 clean-run 병렬 3회 통과
- [ ] 새 평가 입력에 이전 실패 로그 전문·도구 출력 전문·평가 문서 전문이 들어가지 않았음을 기록
- [ ] 실패가 있었다면 실패 분류와 보강 내용 기록
- [ ] 정적 검색 통과
- [ ] 필요한 타입 검증 통과
- [ ] 최종 변경 범위와 남은 위험 보고

---

## 9. Agent Improvement Order and Contracts

### 9.1 Recommended Order

`orchestrator`를 먼저 고정한 뒤, 나머지 agent는 앞 agent 산출물이 뒤 agent 입력 품질에 영향을 주는 정도를 기준으로 아래 순서를 권장한다. 이 순서는 런타임 호출 순서를 그대로 복사한 것이 아니다.

| Order | Agent | Why this order |
| --- | --- | --- |
| 1 | `intent-checker` | 무상태 gate 계약을 먼저 고정한다. |
| 2 | `research` | 외부 사실과 출처 품질을 먼저 고정한다. |
| 3 | `code-explorer` | 내부 코드 위치와 패턴 정찰 계약을 고정한다. 산출물은 `explore.md`. |
| 4 | `idea-generator` | 대안 발산 역할을 고정한다. 실행 계획·구현으로 넘어가지 않게 한다. |
| 5 | `planner` | evidence와 alternatives를 단일 실행 경로로 수렴한다. |
| 6 | `worker` | 실제 구현과 검증 실행 역할을 고정한다. |
| 7 | `adversarial-review` | 결함·반례·회귀 위험 검토를 고정한다. |
| 8 | `constructive-feedback` | 품질 개선 피드백 역할을 고정한다. |

### 9.2 Progress Status Values

| Status | Meaning |
| --- | --- |
| `pending` | 아직 시작하지 않음 |
| `in-progress` | 현재 작업 중 |
| `needs-clean-revalidation` | 실패 분석 컨텍스트가 평가에 섞였을 가능성이 있어 새 세션 병렬 3회 재검증 필요 |
| `blocked` | 평가 하네스, 권한, 사용자 결정 등으로 진행 불가 |
| `complete` | 완료 기준을 모두 만족함 |

진행 상태를 갱신할 때:

- 완료한 항목은 `[x]`로 바꾼다.
- 완료하지 못한 항목은 `[ ]`로 남기고 이유를 Notes나 평가 결과에 기록한다.
- `blocked`는 병렬 3회 평가가 불가능하거나, direct-subagent 하네스 같은 선결 조건이 없을 때만 사용한다.
- `complete`는 Completion Criteria의 모든 항목이 충족된 경우에만 사용한다.
- 완료 이후 프롬프트가 다시 변경되면 `needs-clean-revalidation`으로 되돌린다.
- 재검증은 새 `OPENCODE_RUN_ID`, 새 opencode 세션, 이전 실패 전문 없는 입력으로 직접 agent 계약 평가 병렬 3회부터 다시 시작한다.

### 9.3 Per-Agent Core Contracts

#### `intent-checker`

- 무상태 gate로 동작한다.
- 파일을 읽거나 쓰지 않는다.
- taskId와 산출물 경로를 요구하지 않는다.
- 사용자 의도와 제안 계획의 정렬 여부만 확인한다.
- 계획을 새로 만들거나 실행 agent를 선택하지 않는다.
- 사용자 확인이 없으면 진행을 확정하지 않는다.

평가 유형: 정상 확인 / 파일 기록·계획 작성 요구 / 동의 문구만 있고 계획 없음 / 한 줄 진행·재분류·확인 필요 신호

#### `research`

- 외부 문서, 공식 참조, 최신 웹 사실 확인을 맡는다.
- 출처 있는 사실과 미확인 추론을 구분한다.
- 소스 변경을 하지 않는다.
- 최종 구현 계획을 확정하지 않는다.
- 외부 조사 결과를 자기 산출물에 남긴다.
- 한 줄 반환이나 파일 작성 금지 같은 위임 제약이 있으면 산출물 생성을 생략한다.
- 내부 코드 위치, 변경 범위, 구현 지시는 `planner` 또는 `worker` 경계로 남긴다.

평가 유형: 정상 외부 조사 / 조사 범위 확인만 / 내부 코드 변경 요구 / 출처 불확실성 / 내부 경로 혼입 방지

#### `code-explorer`

- 내부 코드 위치, 파일, 심볼, 반복 패턴을 읽기 전용으로 찾는다.
- bash를 실행하지 않는다.
- webfetch를 사용하지 않는다.
- 파일을 수정하지 않는다.
- 구현 계획을 확정하지 않는다.
- 발견/미발견과 탐색 범위를 구분해 기록한다.
- 실행 식별자는 `code-explorer`, 산출물 파일은 `explore.md`다.

평가 유형: 정상 탐색 / bash·수정 요구 / 미발견 항목 꾸며내기 금지 / 읽기 전용 도구 일치 / 사용자 지정 MCP 있음·없음

#### `idea-generator`

- 서로 다른 대안과 트레이드오프를 발산한다.
- 실행 계획을 확정하지 않는다.
- 파일을 수정하지 않는다.
- 명령 실행을 하지 않는다.
- 근거가 부족한 전제는 조건부로 표시한다.
- 권장 방향은 제시할 수 있지만 적용 결정은 하지 않는다.
- 실행 식별자는 `idea-generator`, 산출물 파일은 `ideas.md`다.

평가 유형: 정상 대안 생성 / 구현·문서 수정 요구 / 미확인 전제 단정 금지 / 아이디어 산출물만 기록

#### `planner`

- 구현 전 영향 범위, 위험, 순서를 수렴한다.
- 단일 실행 경로로 계획을 정리한다.
- 필요한 경우 taskId를 생성한다.
- 소스 변경을 하지 않는다.
- 웹 조사를 직접 수행하지 않는다.
- 미확인 외부 사실은 `research` 필요 항목으로 남긴다.
- taskId가 주어진 입력에서는 날짜 명령을 실행하지 않는다.
- 산출물 경로 확인·디렉터리 생성을 위해 `ls`/`mkdir`를 사용하지 않는다.
- 사용자 지정 MCP 지침이 있으면 특정 도구명을 프롬프트에 고정하지 않고 실제 `tool_use`에서 준수 여부를 확인한다.

평가 유형: 정상 계획 / 계획 중 파일 수정 요구 / 외부 사실 부족 / `plan.md` 산출물 계약 / 도구 지침

#### `worker`

- 확정된 변경을 직접 수행한다.
- 필요한 소스 읽기, 파일 수정, 명령 실행, 검증을 수행한다.
- 다른 agent로 재위임하지 않는다.
- 변경 내용과 검증 결과를 기록한다.
- 검증 실패나 미실행을 숨기지 않는다.
- 목표가 불충분하면 확인한 사실과 필요한 입력을 남긴다.

평가 유형: 정상 구현 / 재위임 요구 / 불분명 목표로 광범위 수정 금지 / 검증 기록 일치 / 사용자 지정 MCP 있음·없음

#### `adversarial-review`

- 결함, 반례, 회귀, 보안, 호환성 위험을 우선 찾는다.
- 직접 수정하지 않는다.
- 최종 승인/불승인 결정을 대신하지 않는다.
- 근거와 심각도를 분리해 기록한다.
- 발견 없음과 검토 불충분을 구분한다.

평가 유형: 정상 검토 / 직접 수정 요구 / 대상 없이 안전 단정 금지 / 발견 사항 중심 출력 / 사용자 지정 MCP 있음·없음

#### `constructive-feedback`

- 품질 개선 관찰, 근거, 권장 조치를 제시한다.
- 직접 수정하지 않는다.
- 결함 발굴만 하는 adversarial-review 역할로 흐르지 않는다.
- 최종 적용 결정을 대신하지 않는다.
- 근거가 약한 제안은 확인 필요로 표시한다.

평가 유형: 정상 피드백 / 직접 정리·코드 수정 요구 / 막연한 선호를 확정 개선처럼 말하지 않음 / 관찰·근거·권장 조치 중심 / 사용자 지정 MCP 있음·없음

---

## 10. Notes

- 프롬프트 변경은 평가 전까지 production-ready로 간주하지 않는다. 문서와 테스트가 통과해도 실제 모델이 역할 경계를 지키는지는 fixture 기반 평가로 확인해야 한다.
- 공통 기준을 쉽게 늘리면 모든 agent 프롬프트가 과도하게 길어진다. 공통 기준은 보수적으로 유지하고, agent별 실패는 해당 agent 문서나 평가 결과에 좁게 기록한다.
- 실제 개선 중 새 실패가 나오면 공통 기준이 아니라 해당 agent 섹션이나 평가 결과에만 좁게 추가한다.
- 상세 평가 결과와 완료 증거는 `docs/evals/agent-prompts/` 아래 agent별 평가 파일에 남긴다.
