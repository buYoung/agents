---
doc-type: Feature Design Doc
profile: full
feature-name: agent-explore-role
status: active
created: 2026-07-06
last-verified: 2026-07-06
verified-against: bac12fa
tags: [agents, explore, codebase-discovery, read-only]
related:
  - docs/FDD/agent-planner-role.md
  - docs/FDD/agent-research-role.md
purpose: Source of design decisions, not implementation actions
agent-readable: true
not:
  - task list
  - PR checklist
  - file-level change guide
---

# Explore Agent Role Feature Design Doc

## 1. Document Intent

이 문서는 `explore` agent의 고유 역할과 경계를 정의한다. `explore`는 코드베이스 내부의 관련 위치와 패턴을 빠르게 찾는 읽기 전용 정찰 역할이다.

---

## 2. Background / Problem

넓은 코드베이스에서 바로 계획이나 구현을 시작하면 관련 파일과 패턴을 놓칠 수 있다. 하지만 탐색 단계가 명령 실행이나 외부 조사까지 확장되면 역할이 커진다. `explore`는 내부 위치 발견에 집중하는 좁은 역할이 필요해서 존재한다.

---

## 3. Feature Definition

```text
Explore Agent Role is the read-only codebase reconnaissance role that discovers relevant files, symbols, and patterns without running commands, fetching the web, or editing source.
```

### This feature is

- 내부 코드베이스 정찰 agent 역할이다.
- 관련 위치와 패턴을 찾는 읽기 전용 역할이다.
- 계획이나 구현 전에 범위를 좁히는 입력을 제공한다.

### This feature is not

- 외부 웹 문서를 조사하는 research 역할이 아니다.
- 실행 계획을 확정하는 planner 역할이 아니다.
- 소스를 변경하는 worker 역할이 아니다.

---

## 4. Goals & Non-Goals

### Goals

- 관련 파일, 심볼, 패턴의 위치를 빠르게 찾는다.
- 내부 탐색 결과를 후속 agent가 사용할 수 있게 남긴다.
- 명령 실행과 웹 조회 없이 탐색 범위를 제한한다.

### Non-Goals

- 소스 변경을 하지 않는다.
- 외부 문서나 최신 웹 정보를 확인하지 않는다.
- 구현 방향을 최종 결정하지 않는다.

---

## 5. User Model & Core Concepts

### User Model

사용자는 `explore`를 "코드베이스 어디를 봐야 하는지 찾아주는 agent"로 이해한다.

Users should not need to understand:

- 내부 검색 도구 선택 기준.
- 후속 agent가 결과 파일을 읽는 방식.

### Core Concepts

| Concept | Meaning |
| ------- | ------- |
| Reconnaissance | 변경 전 관련 지점을 찾는 정찰 |
| Internal Pattern | 코드베이스 안에서 반복되는 구조나 사용 방식 |
| Location Map | 후속 작업을 위한 위치 중심 결과 |
| Explore Artifact | 탐색 결과 산출물 |

---

## 6. Relationship to Existing Features

| Existing Feature | Relationship |
| ---------------- | ------------ |
| Planner role | 탐색 결과를 계획의 근거로 사용할 수 있다. |
| Worker role | 변경 전 관련 위치 파악에 도움을 준다. |
| Research role | 외부 정보가 아닌 내부 코드 탐색과 역할을 나눈다. |
| Permission enforcement | 읽기 전용 탐색으로 제한한다. |

---

## 7. Primary User Flows

### 7.1 Main Flow

```text
작업 범위가 넓거나 불명확하다.
  -> explore가 내부 코드베이스를 검색한다.
  -> 관련 위치와 패턴을 정리한다.
  -> planner 또는 worker가 이 결과를 읽고 다음 판단을 한다.
```

### 7.2 Secondary Flow

```text
특정 이름이나 패턴의 존재 여부가 궁금하다.
  -> explore가 읽기 전용 탐색으로 발견 여부를 확인한다.
  -> 발견 위치 또는 미발견 사실을 산출물에 남긴다.
```

### 7.3 Failure / Partial Success Flow

```text
검색 범위 안에서 관련 항목을 찾지 못한다.
  -> explore는 미발견 사실과 검색 범위를 남긴다.
  -> 후속 agent는 범위 확장 여부를 판단한다.
```

---

## 8. Design

### 8.1 Behavior

`explore`는 `subagent` 실행 모드다. 소스 읽기는 허용되지만 명령 실행, 웹 조회, 소스 변경, 재위임은 허용되지 않는다. 산출물은 내부 코드 위치와 패턴을 중심으로 한다.

### 8.2 Conceptual Data Model

| Entity | Meaning |
| ------ | ------- |
| Exploration Question | 찾고자 하는 내부 코드 질문 |
| Code Location | 관련 파일, 심볼, 패턴의 위치 |
| Finding Summary | 발견 결과의 요약 |
| Explore Artifact | 탐색 결과 산출물 |

| Field | Meaning |
| ----- | ------- |
| Mode | `subagent` |
| Source Read Policy | 허용 |
| Bash Policy | 허용하지 않음 |
| Web Fetch Policy | 허용하지 않음 |
| Source Edit Policy | 허용하지 않음 |

### 8.3 Failure Handling

- 발견하지 못한 사실도 결과로 남긴다.
- 명령 실행이나 웹 조회가 필요한 경우 다른 역할로 분리되어야 한다.
- 소스 변경 시도는 거부된다.

---

## 9. Policy Decisions

### 9.1 읽기 전용 정찰 정책

Decision:

- `explore`는 내부 코드 읽기와 검색에만 집중한다.

Rationale:

- 탐색 역할이 실행이나 변경까지 수행하면 계획·구현 역할과 충돌한다.

### 9.2 외부 조회 금지 정책

Decision:

- `explore`는 웹 조회를 하지 않는다.

Rationale:

- 외부 정보 확인은 research 역할의 고유 책임이다.

---

## 10. Alternatives Considered

기록된 대안은 없다. 현재 문서는 구현된 역할 계약을 사실 기준으로 정리하며, 기록되지 않은 대안을 임의로 만들지 않는다.

---

## 11. Cross-cutting Concerns

### 11.1 Security

- 읽기 전용 권한으로 제한되어 변경 위험을 낮춘다.

### 11.2 Privacy

- Not applicable: 이 역할은 외부 전송이나 개인 데이터 저장 정책을 새로 정의하지 않는다.

### 11.3 Permissions

- 소스 읽기는 허용한다.
- 명령 실행, 웹 조회, 소스 변경, 재위임은 허용하지 않는다.

### 11.4 Observability

- 탐색 산출물은 어떤 위치와 패턴이 발견됐는지 추적하는 기준이다.

### 11.5 Accessibility

- Not applicable: 이 역할은 사용자 화면을 정의하지 않는다.

### 11.6 Internationalization

- 탐색 설명은 사용자 언어로 작성하되, 코드 식별자는 원문을 유지한다.

---

## 12. Scope

### In Scope for as implemented (2026-07-06)

- 내부 코드 위치 탐색.
- 패턴과 심볼 발견.
- 읽기 전용 산출물 작성.

### Out of Scope for as implemented (2026-07-06)

- 명령 실행.
- 웹 조회.
- 소스 변경.
- 최종 구현 계획 확정.

---

## 13. Risks & Open Questions

### Risks

- 탐색 범위가 좁으면 관련 위치를 놓칠 수 있다.
- 탐색 결과가 계획이나 구현에서 최신 상태로 재확인되지 않으면 오래된 근거가 될 수 있다.

### Open Questions

- 탐색 결과의 충분성 기준은 작업 유형별로 더 구체화될 수 있다.

