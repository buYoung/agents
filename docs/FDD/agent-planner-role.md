---
doc-type: Feature Design Doc
profile: full
feature-name: agent-planner-role
status: active
created: 2026-07-06
last-verified: 2026-07-06
verified-against: bac12fa
tags: [agents, planner, planning, convergent]
related:
  - docs/FDD/agent-worker-role.md
  - docs/FDD/agent-ideator-role.md
purpose: Source of design decisions, not implementation actions
agent-readable: true
not:
  - task list
  - PR checklist
  - file-level change guide
---

# Planner Agent Role Feature Design Doc

## 1. Document Intent

이 문서는 `planner` agent의 고유 역할과 경계를 정의한다. `planner`는 구현 전 실행 경로를 수렴적으로 정리하는 계획 역할이다.

---

## 2. Background / Problem

복잡한 변경은 바로 구현하면 영향 범위와 위험이 빠질 수 있다. 반대로 여러 대안을 계속 나열하기만 하면 실행으로 넘어가기 어렵다. `planner`는 확인된 정보에 기반해 하나의 실행 가능한 경로로 수렴시키기 위해 필요하다.

---

## 3. Feature Definition

```text
Planner Agent Role is the convergent planning role that turns a request and available context into a single executable implementation direction without editing source code.
```

### This feature is

- 구현 전 계획을 세우는 agent 역할이다.
- 소스 읽기와 제한적 검증을 통해 사실 기반 계획을 만든다.
- 필요 시 taskId 생성이 가능한 bash-capable 계획 역할이다.

### This feature is not

- 여러 대안을 발산하는 ideator 역할이 아니다.
- 실제 소스 변경을 수행하는 worker 역할이 아니다.
- 외부 웹 조사 중심의 research 역할이 아니다.

---

## 4. Goals & Non-Goals

### Goals

- 실행 가능한 단일 계획으로 수렴한다.
- 영향 범위와 위험을 구현 전에 드러낸다.
- worker가 실행할 수 있는 계획 산출물을 만든다.

### Non-Goals

- 소스 파일을 변경하지 않는다.
- 여러 대안을 장기적으로 탐색하지 않는다.
- 사용자 의도 확인 gate 역할을 대신하지 않는다.

---

## 5. User Model & Core Concepts

### User Model

사용자는 `planner`를 "어떻게 고칠지 결정하는 agent"로 이해한다.

Users should not need to understand:

- 내부 검색 방법.
- taskId를 만드는 세부 명령.

### Core Concepts

| Concept | Meaning |
| ------- | ------- |
| Convergent Planning | 여러 가능성 중 실행 경로 하나로 좁히는 계획 |
| Impact Scope | 변경이 영향을 줄 수 있는 범위 |
| Risk | 구현 전 식별해야 하는 회귀 또는 호환성 우려 |
| Plan Artifact | 구현 전에 남기는 계획 산출물 |

---

## 6. Relationship to Existing Features

| Existing Feature | Relationship |
| ---------------- | ------------ |
| Worker role | planner 산출물을 실행 입력으로 사용할 수 있다. |
| Ideator role | ideator가 제공한 대안이 있으면 수렴 판단의 입력이 된다. |
| Explore role | 내부 위치 탐색 결과가 계획 근거가 될 수 있다. |
| Permission enforcement | 소스 변경 없이 읽기와 검증 중심으로 제한한다. |

---

## 7. Primary User Flows

### 7.1 Main Flow

```text
구현 전에 범위 판단이 필요하다.
  -> planner가 관련 컨텍스트를 확인한다.
  -> 영향 범위와 위험을 정리한다.
  -> 하나의 실행 방향으로 수렴한다.
  -> worker가 읽을 수 있는 계획 산출물을 남긴다.
```

### 7.2 Secondary Flow

```text
여러 대안이 이미 제시되어 있다.
  -> planner가 대안의 현실성을 비교한다.
  -> 현재 제약에 맞는 하나의 실행 경로를 선택한다.
```

### 7.3 Failure / Partial Success Flow

```text
계획에 필요한 사실이 확인되지 않는다.
  -> planner는 미확인 사항을 산출물에 남긴다.
  -> 구현은 보류되거나 제한된 범위로 진행된다.
```

---

## 8. Design

### 8.1 Behavior

`planner`는 `subagent` 실행 모드다. 소스 읽기와 명령 실행은 가능하지만 소스 변경과 웹 조회는 허용되지 않는다. 산출물은 실행 계획과 영향 범위를 담는 계획 문서다.

### 8.2 Conceptual Data Model

| Entity | Meaning |
| ------ | ------- |
| Planning Request | 계획이 필요한 작업 목표 |
| Verified Context | 읽기와 검증으로 확인한 사실 |
| Execution Direction | 선택된 단일 실행 경로 |
| Plan Artifact | 계획 결과 산출물 |

| Field | Meaning |
| ----- | ------- |
| Mode | `subagent` |
| Source Read Policy | 허용 |
| Bash Policy | 허용 |
| Source Edit Policy | 허용하지 않음 |
| Web Fetch Policy | 허용하지 않음 |

### 8.3 Failure Handling

- 사실 확인이 부족하면 추측하지 않고 미확인 사항으로 남긴다.
- 소스 변경 시도는 거부된다.
- 웹 조회가 필요한 문제는 research 역할로 분리되어야 한다.

---

## 9. Policy Decisions

### 9.1 수렴 역할 정책

Decision:

- `planner`는 대안을 늘리는 역할이 아니라 실행 경로 하나로 수렴하는 역할이다.

Rationale:

- 구현 전 단계에서 결정이 내려져야 worker가 실행할 수 있다.

### 9.2 변경 금지 정책

Decision:

- `planner`는 소스 변경을 하지 않는다.

Rationale:

- 계획과 실행이 섞이면 변경 책임이 불명확해진다.

---

## 10. Alternatives Considered

기록된 대안은 없다. 현재 문서는 구현된 역할 계약을 사실 기준으로 정리하며, 기록되지 않은 대안을 임의로 만들지 않는다.

---

## 11. Cross-cutting Concerns

### 11.1 Security

- 명령 실행이 가능하므로 검증 목적 범위로 제한되어야 한다.

### 11.2 Privacy

- Not applicable: 이 역할은 개인 데이터 처리 정책을 새로 정의하지 않는다.

### 11.3 Permissions

- 소스 읽기와 명령 실행은 허용한다.
- 소스 변경, 웹 조회, 재위임은 허용하지 않는다.

### 11.4 Observability

- 계획 산출물은 영향 범위, 위험, 미확인 사항을 추적하는 관측 지점이다.

### 11.5 Accessibility

- Not applicable: 이 역할은 별도 사용자 화면을 정의하지 않는다.

### 11.6 Internationalization

- 계획 설명은 사용자의 언어 흐름을 따라야 하며, agent 이름은 식별자로 유지한다.

---

## 12. Scope

### In Scope for as implemented (2026-07-06)

- 구현 전 계획.
- 영향 범위와 위험 정리.
- 단일 실행 경로 수렴.
- taskId 생성 가능성.

### Out of Scope for as implemented (2026-07-06)

- 소스 변경.
- 웹 기반 외부 조사.
- 여러 대안의 장기 발산.

---

## 13. Risks & Open Questions

### Risks

- 계획이 과도하게 상세해지면 실행 계획과 경계가 흐려질 수 있다.
- 미확인 사실이 누락되면 worker가 잘못된 가정으로 구현할 수 있다.

### Open Questions

- 계획 산출물의 상세도 기준은 작업 규모에 따라 더 구체화될 수 있다.

