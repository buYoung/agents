---
doc-type: Feature Design Doc
profile: full
feature-name: agent-research-role
status: active
created: 2026-07-06
last-verified: 2026-07-06
verified-against: bac12fa
tags: [agents, research, webfetch, external-docs]
related:
  - docs/FDD/agent-orchestrator-role.md
  - docs/FDD/agent-explore-role.md
purpose: Source of design decisions, not implementation actions
agent-readable: true
not:
  - task list
  - PR checklist
  - file-level change guide
---

# Research Agent Role Feature Design Doc

## 1. Document Intent

이 문서는 `research` agent의 고유 역할과 경계를 정의한다. `research`는 외부 문서나 웹 출처가 필요한 사실을 조사하는 역할이다.

---

## 2. Background / Problem

라이브러리 동작, 공식 문서, 최신 외부 정보가 필요한 작업을 내부 코드 탐색만으로 해결하면 근거가 약해진다. `research`는 외부 출처 확인이 필요한 문제를 별도 역할로 분리한다.

---

## 3. Feature Definition

```text
Research Agent Role is the external-information role that investigates official documents, library behavior, and web references while avoiding source edits.
```

### This feature is

- 외부 출처가 필요한 사실 조사 agent 역할이다.
- 웹 조회 권한이 있는 조사 전용 역할이다.
- 내부 코드 사용 패턴도 읽어 맥락을 보완할 수 있는 역할이다.

### This feature is not

- 내부 코드 위치만 빠르게 찾는 explore 역할이 아니다.
- 소스 변경을 수행하는 worker 역할이 아니다.
- 계획을 단일 실행 경로로 확정하는 planner 역할이 아니다.

---

## 4. Goals & Non-Goals

### Goals

- 공식 문서와 웹 출처를 기준으로 외부 사실을 확인한다.
- 내부 코드 맥락과 외부 정보를 연결한다.
- 조사 결과를 별도 산출물로 남긴다.

### Non-Goals

- 소스를 변경하지 않는다.
- 출처 없는 일반 지식만으로 결론을 내리지 않는다.
- 작업 조정이나 재위임을 하지 않는다.

---

## 5. User Model & Core Concepts

### User Model

사용자는 `research`를 "외부 근거를 찾아오는 agent"로 이해한다.

Users should not need to understand:

- 웹 조회 도구의 내부 방식.
- 조사 산출물 저장 경로 생성 방식.

### Core Concepts

| Concept | Meaning |
| ------- | ------- |
| External Source | 공식 문서, 라이브러리 문서, 웹 레퍼런스 |
| Source-backed Finding | 출처가 있는 조사 항목 |
| Codebase Context | 현재 프로젝트가 해당 외부 기술을 사용하는 방식 |
| Research Artifact | 조사 결과 산출물 |

---

## 6. Relationship to Existing Features

| Existing Feature | Relationship |
| ---------------- | ------------ |
| Explore role | 내부 위치 탐색과 달리 외부 출처 확인을 담당한다. |
| Planner role | 조사 결과가 계획 판단의 근거가 될 수 있다. |
| Worker role | 구현 중 외부 사실 확인이 필요할 때 입력을 제공한다. |
| Permission enforcement | 웹 조회는 허용하되 소스 변경은 금지한다. |

---

## 7. Primary User Flows

### 7.1 Main Flow

```text
작업에 외부 문서 확인이 필요하다.
  -> research가 외부 출처를 조회한다.
  -> 현재 코드 맥락과 관련성을 확인한다.
  -> 출처가 있는 조사 결과를 남긴다.
```

### 7.2 Secondary Flow

```text
라이브러리 버전이나 환경 사실 확인이 필요하다.
  -> research가 명령 실행으로 로컬 사실을 확인한다.
  -> 웹 출처와 로컬 상태의 관계를 정리한다.
```

### 7.3 Failure / Partial Success Flow

```text
신뢰 가능한 출처를 찾지 못한다.
  -> research는 미확인 상태를 남긴다.
  -> 후속 계획이나 구현은 해당 불확실성을 고려한다.
```

---

## 8. Design

### 8.1 Behavior

`research`는 `subagent` 실행 모드다. 소스 읽기, 명령 실행, 웹 조회가 가능하지만 소스 변경과 재위임은 허용되지 않는다. 산출물은 외부 사실과 출처를 중심으로 구성된다.

### 8.2 Conceptual Data Model

| Entity | Meaning |
| ------ | ------- |
| Research Question | 확인해야 할 외부 정보 질문 |
| External Finding | 출처가 있는 조사 결과 |
| Local Context | 프로젝트 안의 관련 사용 맥락 |
| Research Artifact | 조사 결과 산출물 |

| Field | Meaning |
| ----- | ------- |
| Mode | `subagent` |
| Source Read Policy | 허용 |
| Bash Policy | 허용 |
| Web Fetch Policy | 허용 |
| Source Edit Policy | 허용하지 않음 |

### 8.3 Failure Handling

- 출처가 없으면 확정 사실로 기록하지 않는다.
- 웹 조회가 실패하면 미확인 사항으로 남긴다.
- 소스 변경 시도는 거부된다.

---

## 9. Policy Decisions

### 9.1 출처 기반 조사 정책

Decision:

- `research`는 외부 사실을 출처와 함께 기록하는 역할이다.

Rationale:

- 외부 기술 판단은 캐시된 일반 지식보다 확인 가능한 출처가 필요하다.

### 9.2 편집 금지 정책

Decision:

- `research`는 소스 변경을 하지 않는다.

Rationale:

- 조사 결과와 구현 실행을 분리해야 근거와 변경 책임을 추적할 수 있다.

---

## 10. Alternatives Considered

기록된 대안은 없다. 현재 문서는 구현된 역할 계약을 사실 기준으로 정리하며, 기록되지 않은 대안을 임의로 만들지 않는다.

---

## 11. Cross-cutting Concerns

### 11.1 Security

- 웹 조회 권한이 있으므로 외부 정보는 출처 중심으로 다루어야 한다.

### 11.2 Privacy

- 외부 조회 시 프로젝트 민감 정보가 불필요하게 포함되지 않아야 한다.

### 11.3 Permissions

- 소스 읽기, 명령 실행, 웹 조회를 허용한다.
- 소스 변경과 재위임은 허용하지 않는다.

### 11.4 Observability

- 조사 산출물은 어떤 출처가 어떤 결론을 뒷받침하는지 추적 가능해야 한다.

### 11.5 Accessibility

- Not applicable: 이 역할은 사용자 화면을 정의하지 않는다.

### 11.6 Internationalization

- 조사 요약은 사용자 언어로 작성하되, 외부 문서 제목과 식별자는 원문을 유지할 수 있다.

---

## 12. Scope

### In Scope for as implemented (2026-07-06)

- 외부 공식 문서와 웹 레퍼런스 조사.
- 로컬 버전 또는 패키지 사실 확인.
- 코드베이스 내 관련 사용 맥락 확인.
- 출처 기반 조사 산출물 작성.

### Out of Scope for as implemented (2026-07-06)

- 소스 변경.
- 단순 내부 위치 탐색만 수행하는 작업.
- 최종 구현 계획 확정.

---

## 13. Risks & Open Questions

### Risks

- 출처가 약한 정보를 확정 사실처럼 기록하면 후속 구현이 잘못될 수 있다.
- 외부 조회에 민감한 프로젝트 맥락을 과도하게 포함할 위험이 있다.

### Open Questions

- 어떤 외부 출처를 우선순위 높은 출처로 볼지에 대한 세부 정책은 별도 정리될 수 있다.

