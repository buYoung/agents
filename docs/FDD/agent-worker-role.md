---
doc-type: Feature Design Doc
profile: full
feature-name: agent-worker-role
status: active
created: 2026-07-06
last-verified: 2026-07-06
verified-against: bac12fa
tags: [agents, worker, implementation, source-edit]
related:
  - docs/FDD/agent-orchestrator-role.md
  - docs/FDD/agent-planner-role.md
purpose: Source of design decisions, not implementation actions
agent-readable: true
not:
  - task list
  - PR checklist
  - file-level change guide
---

# Worker Agent Role Feature Design Doc

## 1. Document Intent

이 문서는 `worker` agent의 고유 역할과 경계를 정의한다. `worker`는 실제 변경을 수행하는 실행자이며, 다른 조사·계획·검토 역할과 구분된다.

---

## 2. Background / Problem

여러 agent가 동시에 소스를 변경할 수 있으면 책임 추적이 어려워진다. 구현 실행은 단일 역할로 모아야 변경 결과와 검토 결과를 분리할 수 있다. `worker`는 이 변경 실행 책임을 담당한다.

---

## 3. Feature Definition

```text
Worker Agent Role is the execution role that reads, modifies, and verifies source changes while avoiding further delegation.
```

### This feature is

- 실제 소스 변경을 수행하는 agent 역할이다.
- 명령 실행과 검증을 수행할 수 있는 실행 역할이다.
- 작업 결과 산출물을 소유하는 문서형 agent다.

### This feature is not

- 작업을 다른 agent에게 다시 넘기는 조정자 역할이 아니다.
- 외부 조사 전용 역할이 아니다.
- 변경 없는 검토 전용 역할이 아니다.

---

## 4. Goals & Non-Goals

### Goals

- 확정된 작업을 가장 좁고 완전한 변경으로 해결한다.
- 변경 결과와 검증 결과를 작업 산출물로 남긴다.
- 재위임 없이 실행 책임을 완결한다.

### Non-Goals

- 사용자 의도 확인을 담당하지 않는다.
- 여러 설계 대안을 발산하지 않는다.
- 비판적 검토나 개선 제안만을 목적으로 실행되지 않는다.

---

## 5. User Model & Core Concepts

### User Model

사용자는 `worker`를 "실제로 고치는 agent"로 이해한다.

Users should not need to understand:

- 권한 정책 내부 구현.
- 산출물 경로 생성 방식.

### Core Concepts

| Concept | Meaning |
| ------- | ------- |
| Execution Role | 실제 변경을 수행하는 역할 |
| Verification | 변경 후 동작 확인을 위한 실행 |
| Work Artifact | 변경 내용과 검증 결과를 남기는 산출물 |
| No Redelegation | 다른 agent에게 다시 작업을 넘기지 않는 경계 |

---

## 6. Relationship to Existing Features

| Existing Feature | Relationship |
| ---------------- | ------------ |
| Orchestrator role | `worker`에게 구현 실행을 위임한다. |
| Planner role | 계획 산출물이 있을 경우 실행 입력으로 삼는다. |
| Permission enforcement | 소스 변경 권한과 재위임 금지를 강제한다. |
| Run document protocol | 작업 결과 산출물 소유권을 제공한다. |

---

## 7. Primary User Flows

### 7.1 Main Flow

```text
구현이 필요한 작업이 확정된다.
  -> worker가 관련 컨텍스트를 확인한다.
  -> worker가 필요한 소스 변경을 수행한다.
  -> worker가 가능한 검증을 수행한다.
  -> worker가 변경 요약과 검증 결과를 남긴다.
```

### 7.2 Secondary Flow

```text
사전 계획 산출물이 있다.
  -> worker가 계획과 탐색 결과를 읽는다.
  -> 실제 코드 상태에 맞춰 좁은 변경을 수행한다.
```

### 7.3 Failure / Partial Success Flow

```text
검증이 실패한다.
  -> worker는 실패 상태와 핵심 원인을 산출물에 남긴다.
  -> 사용자는 변경 완료 여부와 남은 위험을 확인한다.
```

---

## 8. Design

### 8.1 Behavior

`worker`는 `all` 실행 모드의 agent다. 소스 읽기, 소스 변경, 명령 실행, 웹 조회 권한을 가진다. 대신 재위임은 허용되지 않는다. 이 역할은 구현 결과와 검증 결과를 자기 산출물에 남긴다.

### 8.2 Conceptual Data Model

| Entity | Meaning |
| ------ | ------- |
| Work Request | 실행할 변경 목표 |
| Source Change | worker가 수행한 실제 변경 |
| Verification Result | 변경 후 확인 결과 |
| Work Artifact | 변경과 검증의 기록 |

| Field | Meaning |
| ----- | ------- |
| Mode | `all` |
| Source Edit Policy | 허용 |
| Bash Policy | 허용 |
| Web Fetch Policy | 허용 |
| Task Policy | 허용하지 않음 |

### 8.3 Failure Handling

- 검증 실패는 숨기지 않고 작업 산출물에 남긴다.
- 재위임 시도는 거부된다.
- 요청 범위를 넘는 큰 변경은 실행하지 않고 후속 사항으로 남기는 것이 역할 경계에 맞다.

---

## 9. Policy Decisions

### 9.1 변경 권한 집중 정책

Decision:

- 소스 변경 실행은 `worker` 역할에 집중한다.

Rationale:

- 변경 권한을 분산하면 책임 추적과 검토 분리가 어려워진다.

### 9.2 재위임 금지 정책

Decision:

- `worker`는 다른 agent에게 다시 작업을 위임하지 않는다.

Rationale:

- 실행 역할은 주어진 범위 안에서 결과를 완결해야 하며 조정자 역할과 분리되어야 한다.

### 9.3 보호 agent 정책

Decision:

- `worker`는 보호 agent로 유지된다.

Rationale:

- 이 역할이 없으면 구현 요청을 완료할 변경 실행자가 사라진다.

---

## 10. Alternatives Considered

기록된 대안은 없다. 현재 문서는 구현된 역할 계약을 사실 기준으로 정리하며, 기록되지 않은 대안을 임의로 만들지 않는다.

---

## 11. Cross-cutting Concerns

### 11.1 Security

- 변경과 명령 실행 권한이 있으므로 가장 강한 권한 경계를 가진다.
- 재위임 금지는 권한 있는 agent가 임의로 다른 흐름을 생성하는 것을 막는다.

### 11.2 Privacy

- Not applicable: 이 역할 정의는 별도 개인 데이터 처리 정책을 만들지 않는다.

### 11.3 Permissions

- 소스 읽기, 소스 변경, 명령 실행, 웹 조회를 허용한다.
- task 재위임은 허용하지 않는다.

### 11.4 Observability

- 변경 파일 수, 핵심 변경, 검증 결과가 작업 산출물로 관측되어야 한다.

### 11.5 Accessibility

- Not applicable: 이 역할은 별도 화면 상호작용을 정의하지 않는다.

### 11.6 Internationalization

- 사용자 설명은 한국어 흐름을 지원하되, agent 이름과 도구 이름은 식별자로 유지한다.

---

## 12. Scope

### In Scope for as implemented (2026-07-06)

- 소스 변경 실행.
- 명령 기반 검증.
- 작업 결과 산출물 작성.
- 재위임 금지.
- 보호 agent 유지.

### Out of Scope for as implemented (2026-07-06)

- 작업 분류 조정.
- 사용자 의도 확인.
- 순수 검토만 수행하는 역할.

---

## 13. Risks & Open Questions

### Risks

- 권한이 강하므로 잘못된 분류로 worker가 호출되면 불필요한 변경이 발생할 수 있다.
- 검증 실패가 최종 응답에 충분히 반영되지 않으면 사용자가 완료 상태를 오해할 수 있다.

### Open Questions

- 웹 조회 권한이 구현 실행 역할에 항상 필요한지에 대한 운영 기준은 별도 정교화 여지가 있다.

