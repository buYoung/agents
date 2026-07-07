---
doc-type: Feature Design Doc
profile: full
feature-name: agent-ideator-role
status: active
created: 2026-07-06
last-verified: 2026-07-07
verified-against: bac12fa
tags: [agents, ideator, idea-generator, alternatives, divergent]
related:
  - docs/FDD/agent-planner-role.md
purpose: Source of design decisions, not implementation actions
agent-readable: true
not:
  - task list
  - PR checklist
  - file-level change guide
---

# Ideator Agent Role Feature Design Doc

## 1. Document Intent

이 문서는 `ideator` 개념 역할의 고유 역할과 경계를 정의한다. 현재 opencode 런타임 식별자는 `idea-generator`이며, 하나의 실행 경로로 바로 수렴하기 전에 여러 접근법을 발산하는 역할이다.

---

## 2. Background / Problem

복잡한 설계 문제를 바로 계획으로 수렴하면 더 나은 접근법을 놓칠 수 있다. 반대로 대안 발산 역할이 구현까지 수행하면 책임이 섞인다. `idea-generator`는 대안을 만들고 선택 근거를 제공하는 역할로 분리된다.

---

## 3. Feature Definition

```text
Ideator Agent Role is the divergent design role that explores multiple distinct approaches and records tradeoffs without editing source code or finalizing implementation.
```

### This feature is

- 여러 접근법을 발산하는 agent 역할이다.
- 대안별 장단점과 선택 근거를 제공하는 역할이다.
- planner가 수렴 판단을 할 수 있도록 입력을 만드는 역할이다.

### This feature is not

- 단일 실행 계획을 확정하는 planner 역할이 아니다.
- 소스 변경을 수행하는 worker 역할이 아니다.
- 외부 문서 조사 역할이 아니다.

---

## 4. Goals & Non-Goals

### Goals

- 실제로 다른 접근법을 둘 이상 제시한다.
- 각 접근법의 장단점과 위험을 드러낸다.
- 하나의 권장 방향을 제시하되 구현은 수행하지 않는다.

### Non-Goals

- 소스를 변경하지 않는다.
- 명령 실행이나 웹 조회를 하지 않는다.
- 최종 구현 계획을 작성하지 않는다.

---

## 5. User Model & Core Concepts

### User Model

사용자는 `idea-generator`를 "다른 방법들을 생각해 보는 agent"로 이해한다.

Users should not need to understand:

- 대안을 찾기 위해 어떤 내부 검색을 했는지.
- planner가 대안을 어떻게 수렴하는지의 내부 절차.

### Core Concepts

| Concept | Meaning |
| ------- | ------- |
| Divergent Alternatives | 서로 다른 방향의 접근법 |
| Tradeoff | 접근법별 장단점과 위험 |
| Recommendation | 대안 중 우선 고려할 방향 |
| Ideas Artifact | 대안과 판단 근거 산출물 |

---

## 6. Relationship to Existing Features

| Existing Feature | Relationship |
| ---------------- | ------------ |
| Planner role | ideator의 대안을 읽고 실행 경로로 수렴할 수 있다. |
| Explore role | 내부 패턴 파악이 대안 발산의 근거가 될 수 있다. |
| Worker role | 선택된 방향이 이후 구현 입력이 될 수 있다. |
| Permission enforcement | 읽기 전용 대안 탐색으로 제한한다. |

---

## 7. Primary User Flows

### 7.1 Main Flow

```text
설계 방향이 아직 확정되지 않았다.
  -> ideator가 여러 접근법을 제시한다.
  -> 각 접근법의 장단점과 위험을 정리한다.
  -> 권장 방향을 제시한다.
  -> planner가 실행 경로를 선택할 수 있다.
```

### 7.2 Secondary Flow

```text
현재 코드 패턴을 고려해야 한다.
  -> ideator가 내부 코드를 읽어 제약을 파악한다.
  -> 현실적인 대안만 산출물에 남긴다.
```

### 7.3 Failure / Partial Success Flow

```text
대안들이 실제로 다르지 않다.
  -> 결과는 발산 역할을 충족하지 못한다.
  -> planner는 추가 대안 탐색이나 직접 계획 수립을 선택해야 한다.
```

---

## 8. Design

### 8.1 Behavior

`idea-generator`는 `subagent` 실행 모드다. 소스 읽기는 허용되지만 명령 실행, 웹 조회, 소스 변경, 재위임은 허용되지 않는다. 산출물은 대안, 트레이드오프, 권장 방향을 중심으로 한다.

### 8.2 Conceptual Data Model

| Entity | Meaning |
| ------ | ------- |
| Design Question | 대안이 필요한 문제 |
| Alternative | 서로 다른 접근 방식 |
| Tradeoff | 각 접근의 장점, 단점, 위험 |
| Ideas Artifact | 대안 산출물 |

| Field | Meaning |
| ----- | ------- |
| Mode | `subagent` |
| Source Read Policy | 허용 |
| Bash Policy | 허용하지 않음 |
| Web Fetch Policy | 허용하지 않음 |
| Source Edit Policy | 허용하지 않음 |

### 8.3 Failure Handling

- 대안이 충분히 구분되지 않으면 산출물의 품질 위험으로 남는다.
- 실행 검증이나 외부 조사가 필요하면 다른 역할로 분리되어야 한다.
- 소스 변경 시도는 거부된다.

---

## 9. Policy Decisions

### 9.1 발산 역할 정책

Decision:

- `idea-generator`는 하나의 정답으로 바로 수렴하지 않고 복수 접근법을 제시한다.

Rationale:

- 설계 문제는 구현 전 대안 비교가 필요할 수 있다.

### 9.2 실행 금지 정책

Decision:

- `idea-generator`는 명령 실행, 웹 조회, 소스 변경을 수행하지 않는다.

Rationale:

- 대안 발산과 사실 조사·구현 실행을 분리해야 역할 책임이 명확하다.

---

## 10. Alternatives Considered

기록된 대안은 없다. 현재 문서는 구현된 역할 계약을 사실 기준으로 정리하며, 기록되지 않은 대안을 임의로 만들지 않는다.

---

## 11. Cross-cutting Concerns

### 11.1 Security

- 읽기 전용 역할로 제한되어 변경 위험이 낮다.

### 11.2 Privacy

- Not applicable: 이 역할은 별도 데이터 수집이나 외부 전송을 정의하지 않는다.

### 11.3 Permissions

- 소스 읽기는 허용한다.
- 명령 실행, 웹 조회, 소스 변경, 재위임은 허용하지 않는다.

### 11.4 Observability

- 대안 산출물은 어떤 선택지가 고려됐고 왜 권장됐는지 추적하는 근거가 된다.

### 11.5 Accessibility

- Not applicable: 이 역할은 사용자 화면을 정의하지 않는다.

### 11.6 Internationalization

- 대안 설명은 사용자 언어로 작성하되, 코드 식별자는 원문을 유지한다.

---

## 12. Scope

### In Scope for as implemented (2026-07-06)

- 복수 대안 발산.
- 트레이드오프 정리.
- 권장 방향 제시.
- 읽기 전용 현실성 확인.

### Out of Scope for as implemented (2026-07-06)

- 최종 구현 계획 확정.
- 소스 변경.
- 외부 웹 조사.
- 명령 기반 검증.

---

## 13. Risks & Open Questions

### Risks

- 대안이 표면적으로만 다르면 planner가 의미 있는 선택 근거를 얻지 못한다.
- 권장 방향이 실행 가능성 검증 없이 과신될 수 있다.

### Open Questions

- 대안 수와 깊이의 최소 기준은 작업 규모별로 더 구체화될 수 있다.
