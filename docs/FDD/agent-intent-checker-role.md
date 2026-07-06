---
doc-type: Feature Design Doc
profile: full
feature-name: agent-intent-checker-role
status: active
created: 2026-07-06
last-verified: 2026-07-06
verified-against: bac12fa
tags: [agents, intent-checker, confirmation, gate]
related:
  - docs/FDD/agent-orchestrator-role.md
purpose: Source of design decisions, not implementation actions
agent-readable: true
not:
  - task list
  - PR checklist
  - file-level change guide
---

# Intent Checker Agent Role Feature Design Doc

## 1. Document Intent

이 문서는 `intent-checker` agent의 고유 역할과 경계를 정의한다. 이 agent는 문서 산출물을 만들지 않는 의도 확인용 gate로 다룬다.

---

## 2. Background / Problem

요청을 분류하는 과정에서 사용자의 실제 의도와 시스템의 작업 계획이 어긋날 수 있다. 구현이나 조사가 시작된 뒤 오해가 드러나면 비용이 커진다. `intent-checker`는 실행 전 확인 지점을 제공해 이 위험을 줄인다.

---

## 3. Feature Definition

```text
Intent Checker Agent Role is a stateless confirmation gate that checks whether the planned agent workflow matches the user's intent before execution proceeds.
```

### This feature is

- 사용자 의도와 작업 분류의 정렬을 확인하는 gate다.
- 산출물 파일을 만들지 않는 무상태 agent 역할이다.
- 오케스트레이터 흐름의 전처리 확인 단계다.

### This feature is not

- 계획을 작성하는 agent가 아니다.
- 구현을 수행하는 agent가 아니다.
- 조사 결과를 문서화하는 agent가 아니다.

---

## 4. Goals & Non-Goals

### Goals

- 사용자 의도와 작업 흐름의 불일치를 실행 전에 발견한다.
- 파일 작성 없이 확인 결과만 반환한다.
- taskId나 산출물 소유권이 필요한 역할과 분리된다.

### Non-Goals

- 작업 계획을 스스로 생성하지 않는다.
- 소스나 문서를 읽어 사실 확인을 하지 않는다.
- 다른 agent에게 재위임하지 않는다.

---

## 5. User Model & Core Concepts

### User Model

사용자는 `intent-checker`를 "잠깐 멈춰서 이 방향이 맞는지 묻는 확인자"로 이해한다.

Users should not need to understand:

- 산출물 디렉터리 구조.
- taskId 생성 규칙.

### Core Concepts

| Concept | Meaning |
| ------- | ------- |
| Stateless Gate | 파일을 남기지 않고 판단 결과만 반환하는 확인 단계 |
| Intent Alignment | 사용자 원의도와 시스템 계획이 같은지 보는 기준 |
| Confirmation Result | 진행 또는 재분류 필요를 나타내는 결과 |

---

## 6. Relationship to Existing Features

| Existing Feature | Relationship |
| ---------------- | ------------ |
| Orchestrator role | 이 역할을 호출해 계획이 사용자 의도와 맞는지 확인한다. |
| Run document protocol | 이 역할은 예외적으로 산출물 소유권이 없다. |
| Permission enforcement | 파일 읽기·쓰기와 재위임을 금지해 gate 성격을 강제한다. |

---

## 7. Primary User Flows

### 7.1 Main Flow

```text
orchestrator가 작업 분류와 위임 계획을 세운다.
  -> intent-checker가 사용자에게 의도 일치 여부를 확인한다.
  -> 사용자가 동의하면 진행 신호를 반환한다.
  -> 사용자가 다르다고 하면 재분류 필요 신호를 반환한다.
```

### 7.2 Secondary Flow

```text
사용자 응답이 모호하다.
  -> 확인자는 추가 명확화가 필요한 상태를 드러낸다.
  -> orchestrator는 계획을 재분류하거나 사용자 결정을 기다린다.
```

### 7.3 Failure / Partial Success Flow

```text
intent-checker가 파일 또는 변경 도구를 사용하려 한다.
  -> 권한 집행이 거부한다.
  -> gate는 산출물 없는 확인 역할로 유지된다.
```

---

## 8. Design

### 8.1 Behavior

`intent-checker`는 `subagent` 실행 모드지만 문서형 subagent가 아니다. 이 역할은 파일을 소유하지 않고, 읽기·쓰기·명령 실행·웹 조회·재위임을 수행하지 않는다. 결과는 오케스트레이터가 다음 흐름을 결정하는 데 쓰는 확인 신호다.

### 8.2 Conceptual Data Model

| Entity | Meaning |
| ------ | ------- |
| Original Intent | 사용자가 요청한 실제 목표 |
| Proposed Workflow | 오케스트레이터가 제안한 처리 방향 |
| Confirmation Signal | 진행 또는 재분류 필요 상태 |

| Field | Meaning |
| ----- | ------- |
| Mode | `subagent` |
| Owned Artifact | 없음 |
| Source Read Policy | 허용하지 않음 |
| Task Policy | 허용하지 않음 |

### 8.3 Failure Handling

- 확인 결과가 재분류 필요이면 실행 흐름은 계속 진행하지 않는다.
- 도구 권한을 벗어난 호출은 거부된다.
- 산출물이 없으므로 문서 작성 실패는 이 역할의 실패 상태가 아니다.

---

## 9. Policy Decisions

### 9.1 무상태 gate 정책

Decision:

- `intent-checker`는 산출물 파일을 소유하지 않는다.

Rationale:

- 의도 확인은 작업 결과물이 아니라 실행 전 결정 지점이다.

### 9.2 도구 최소화 정책

Decision:

- 파일 읽기·쓰기, 명령 실행, 웹 조회, 재위임을 허용하지 않는다.

Rationale:

- 이 역할이 사실 조사나 실행을 시작하면 gate 경계가 흐려진다.

---

## 10. Alternatives Considered

기록된 대안은 없다. 현재 문서는 구현된 역할 계약을 사실 기준으로 정리하며, 기록되지 않은 대안을 임의로 만들지 않는다.

---

## 11. Cross-cutting Concerns

### 11.1 Security

- 도구 권한을 거의 갖지 않으므로 실행 전 확인 역할이 권한 상승 경로가 되지 않는다.

### 11.2 Privacy

- Not applicable: 확인 과정 자체가 별도 개인 데이터 저장 정책을 만들지 않는다.

### 11.3 Permissions

- 읽기, 쓰기, 명령 실행, 웹 조회, 재위임을 허용하지 않는다.

### 11.4 Observability

- 결과는 진행 또는 재분류 필요 같은 짧은 신호로 관측된다.

### 11.5 Accessibility

- Not applicable: 이 문서는 화면 설계를 정의하지 않는다.

### 11.6 Internationalization

- 사용자 확인 문구는 사용자의 언어 흐름을 따라야 하며, agent 이름은 식별자로 유지한다.

---

## 12. Scope

### In Scope for as implemented (2026-07-06)

- 의도 확인 gate.
- 산출물 없는 subagent.
- 재분류 필요 신호.
- 도구 권한 최소화.

### Out of Scope for as implemented (2026-07-06)

- 계획 작성.
- 코드 탐색.
- 구현 실행.
- 검토 문서 작성.

---

## 13. Risks & Open Questions

### Risks

- 너무 자주 확인하면 사용자 흐름이 느려질 수 있다.
- 너무 적게 확인하면 오케스트레이터의 오분류가 실행 단계로 넘어갈 수 있다.

### Open Questions

- 어떤 요청을 충분히 단순한 요청으로 보고 확인을 생략할지는 운영 경험에 따라 조정될 수 있다.

