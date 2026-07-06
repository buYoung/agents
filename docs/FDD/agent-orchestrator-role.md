---
doc-type: Feature Design Doc
profile: full
feature-name: agent-orchestrator-role
status: active
created: 2026-07-06
last-verified: 2026-07-06
verified-against: bac12fa
tags: [agents, orchestrator, delegation, primary-agent]
related:
  - docs/FDD/agent-intent-checker-role.md
  - docs/FDD/agent-worker-role.md
purpose: Source of design decisions, not implementation actions
agent-readable: true
not:
  - task list
  - PR checklist
  - file-level change guide
---

# Orchestrator Agent Role Feature Design Doc

## 1. Document Intent

이 문서는 `orchestrator` agent의 고유 역할과 경계를 정의한다. 기준은 agent 이름, 실행 모드, 권한 정책, 산출물 소유권, 기본 agent 정책이다.

---

## 2. Background / Problem

사용자 요청은 구현, 조사, 계획, 검토가 섞여 들어온다. 기본 진입점이 바로 소스 변경을 수행하면 작업 분류와 의도 확인이 생략될 수 있다. `orchestrator`는 사용자의 요청을 먼저 해석하고, 가장 적합한 전문 agent 흐름으로 넘기는 조정자 역할이 필요해서 존재한다.

---

## 3. Feature Definition

```text
Orchestrator Agent Role is the primary coordination role that classifies user requests and delegates work to allowed subagents without directly modifying source code.
```

### This feature is

- 사용자 요청의 기본 진입 역할이다.
- 여러 agent 역할 중 무엇을 사용할지 결정하는 조정 역할이다.
- 작업별 대표 산출물 인덱스를 소유하는 역할이다.

### This feature is not

- 실제 소스 변경을 수행하는 구현 역할이 아니다.
- 외부 웹 조사를 직접 수행하는 연구 역할이 아니다.
- 사용자 의도 확인 그 자체만 담당하는 무상태 gate가 아니다.

---

## 4. Goals & Non-Goals

### Goals

- 사용자 요청을 적절한 역할 레인으로 분류한다.
- 허용된 subagent에게만 작업을 위임한다.
- subagent 산출물을 기준으로 작업 진행의 대표 인덱스를 유지한다.
- 소스 변경 권한 없이 전체 흐름을 조정한다.

### Non-Goals

- 소스 파일을 직접 읽고 수정하지 않는다.
- worker의 구현 책임을 대신하지 않는다.
- review agent의 평가 책임을 대신하지 않는다.

---

## 5. User Model & Core Concepts

### User Model

사용자는 `orchestrator`를 "일을 직접 다 하는 agent"가 아니라 "어떤 전문 agent에게 맡길지 정하는 기본 조정자"로 이해해야 한다.

Users should not need to understand:

- 세션별 agent 식별 방식.
- 권한 집행 내부 절차.

### Core Concepts

| Concept | Meaning |
| ------- | ------- |
| Primary agent | 사용자가 기본으로 대화하는 agent |
| Delegation | 요청을 전문 subagent에게 넘기는 행위 |
| Master index | 작업 진행을 대표하는 조정자 소유 산출물 |
| Protected agent | 비활성화 오버라이드로 제거되지 않는 핵심 agent |

---

## 6. Relationship to Existing Features

| Existing Feature | Relationship |
| ---------------- | ------------ |
| Subagent role set | `orchestrator`가 선택하고 위임할 대상이다. |
| Permission enforcement | `orchestrator`의 소스 변경 금지와 위임 가능 범위를 강제한다. |
| Run document protocol | `orchestrator`가 대표 산출물을 소유하게 한다. |
| Configuration override | 기본 agent와 보호 agent 성격을 유지하게 한다. |

---

## 7. Primary User Flows

### 7.1 Main Flow

```text
사용자가 작업을 요청한다.
  -> orchestrator가 요청 성격을 분류한다.
  -> 필요한 전문 subagent 흐름을 선택한다.
  -> subagent 결과를 대표 산출물로 정리한다.
  -> 사용자는 조정된 결과를 받는다.
```

### 7.2 Secondary Flow

```text
일부 subagent가 비활성화되어 있다.
  -> orchestrator는 사용할 수 없는 역할을 피한다.
  -> 가능한 역할만으로 흐름을 구성하거나 사용자에게 한계를 드러낸다.
```

### 7.3 Failure / Partial Success Flow

```text
허용되지 않은 대상에게 위임하려 한다.
  -> 권한 집행이 위임을 거부한다.
  -> 작업은 올바른 대상 선택이 필요하다는 상태로 남는다.
```

---

## 8. Design

### 8.1 Behavior

`orchestrator`는 `primary` 실행 모드의 agent다. 사용자가 별도 기본 agent를 지정하지 않으면 이 역할이 기본 진입점이 된다. 이 역할은 소스 변경, 명령 실행, 웹 조회를 직접 수행하지 않고, 허용된 subagent 위임을 통해 작업을 진행한다.

### 8.2 Conceptual Data Model

| Entity | Meaning |
| ------ | ------- |
| Request Classification | 사용자 요청을 역할 레인으로 나눈 결과 |
| Delegation Target | 위임 가능한 subagent |
| Master Artifact | 조정자가 소유하는 작업 대표 산출물 |

| Field | Meaning |
| ----- | ------- |
| Mode | `primary` |
| Source Read Policy | 문서 영역 중심의 제한 읽기 |
| Source Edit Policy | 허용하지 않음 |
| Task Policy | 허용된 subagent로만 위임 |

### 8.3 Failure Handling

- 허용되지 않은 agent로 위임하면 거부된다.
- 소스 변경 도구를 호출하면 거부된다.
- 대상 subagent가 비활성화된 경우 그 역할을 사용할 수 없는 상태로 취급한다.

---

## 9. Policy Decisions

### 9.1 기본 진입 정책

Decision:

- 기본 agent가 지정되지 않은 경우 `orchestrator`를 진입점으로 사용한다.

Rationale:

- 요청 분류 없이 구현 agent로 바로 들어가면 역할 경계가 흐려진다.

### 9.2 직접 변경 금지 정책

Decision:

- `orchestrator`는 소스 변경과 명령 실행을 직접 수행하지 않는다.

Rationale:

- 조정자 역할과 실행자 역할을 분리해야 변경 책임을 추적할 수 있다.

### 9.3 보호 agent 정책

Decision:

- `orchestrator`는 보호 agent로 유지된다.

Rationale:

- 이 역할이 제거되면 기본 작업 조정 흐름이 사라진다.

---

## 10. Alternatives Considered

기록된 대안은 없다. 현재 문서는 구현된 역할 계약을 사실 기준으로 정리하며, 기록되지 않은 대안을 임의로 만들지 않는다.

---

## 11. Cross-cutting Concerns

### 11.1 Security

- 직접 변경 권한 없이 위임 권한만 갖도록 제한해 권한 범위를 줄인다.

### 11.2 Privacy

- Not applicable: 이 역할은 개인 데이터 수집이나 저장 정책을 새로 정의하지 않는다.

### 11.3 Permissions

- source edit, bash, webfetch는 허용하지 않는다.
- task 위임은 허용된 subagent에 한정한다.

### 11.4 Observability

- 대표 산출물은 어떤 subagent 결과를 기준으로 작업이 진행됐는지 추적하는 기준이 된다.

### 11.5 Accessibility

- Not applicable: 이 역할은 별도 화면이나 상호작용 컴포넌트를 정의하지 않는다.

### 11.6 Internationalization

- 사용자에게 노출되는 설명은 한국어 흐름을 지원할 수 있어야 하며, agent 이름은 식별자로 유지한다.

---

## 12. Scope

### In Scope for as implemented (2026-07-06)

- `orchestrator`의 기본 진입 역할.
- 허용된 subagent 위임.
- 소스 변경 금지.
- 대표 산출물 소유.
- 보호 agent 성격.

### Out of Scope for as implemented (2026-07-06)

- 직접 구현 수행.
- 외부 웹 조사 수행.
- 개별 subagent 산출물 작성.

---

## 13. Risks & Open Questions

### Risks

- 조정자 역할이 너무 넓게 해석되면 worker나 review agent의 책임을 침범할 수 있다.
- subagent 비활성화 상태가 사용자에게 충분히 드러나지 않으면 위임 실패가 혼란스럽게 보일 수 있다.

### Open Questions

- 사용자가 기본 agent를 직접 바꾼 경우 이 역할의 발견성을 어떻게 유지할지는 별도 결정이 필요하다.

