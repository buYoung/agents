---
doc-type: Feature Design Doc
profile: full
feature-name: agent-planner-role
status: active
created: 2026-07-06
last-verified: 2026-07-10
verified-against: 44d8317
tags: [agents, planner, planning, convergent]
related:
  - docs/FDD/agent-orchestrator-role.md
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
- 오케스트레이터가 할당한 taskId, workItemId, 정확한 산출물 경로로 구성된 실행 식별 정보를 검증하고 그대로 사용하는 계획 역할이다.

### This feature is not

- 여러 대안을 발산하는 idea-generator 역할이 아니다.
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
- 실행 식별 정보가 할당되는 내부 절차.

### Core Concepts

| Concept | Meaning |
| ------- | ------- |
| Convergent Planning | 여러 가능성 중 실행 경로 하나로 좁히는 계획 |
| Impact Scope | 변경이 영향을 줄 수 있는 범위 |
| Risk | 구현 전 식별해야 하는 회귀 또는 호환성 우려 |
| 실행 식별 정보 | 오케스트레이터가 미리 할당한 taskId, workItemId, 정확한 활성 Output 경로 |
| Explicit Input | 부모가 `Input:`으로 등록한 읽기 전용 산출물 |
| Historical Output | 같은 planner 세션의 이전 활성 출력으로서 읽기만 가능한 산출물 |
| Plan Artifact | 구현 전에 남기는 계획 산출물 |

---

## 6. Relationship to Existing Features

| Existing Feature | Relationship |
| ---------------- | ------------ |
| Worker role | planner 산출물을 실행 입력으로 사용할 수 있다. |
| Idea-generator role | idea-generator가 제공한 대안이 있으면 수렴 판단의 입력이 된다. |
| Explore role | 내부 위치 탐색 결과가 계획 근거가 될 수 있다. |
| Permission enforcement | 소스 변경 없이 읽기와 검증 중심으로 제한한다. |

---

## 7. Primary User Flows

### 7.1 Main Flow

```text
구현 전에 범위 판단이 필요하다.
  -> planner가 전달받은 실행 식별 정보를 검증한다.
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

`planner`는 `subagent` 실행 모드다. 오케스트레이터에게 받은 taskId, workItemId, 정확히 하나의 활성 `Output:` 경로가 모두 유효할 때만 계획을 진행한다. 0개 이상의 `Input:`과 같은 세션의 이전 Output 이력은 읽을 수 있지만 쓸 수 없다. 같은 세션에서 새 work item을 받으면 taskId와 역할이 같은 경우에만 새 Output이 활성화되고 이전 Output은 읽기 전용 이력이 된다. 소스 읽기와 제한적 명령 실행은 가능하지만 소스 변경, 웹 조회, 재위임은 허용되지 않는다. 산출물은 실행 계획과 영향 범위를 담는 `plan.md`다.

### 8.2 Conceptual Data Model

| Entity | Meaning |
| ------ | ------- |
| Planning Request | 계획이 필요한 작업 목표 |
| Verified Context | 읽기와 검증으로 확인한 사실 |
| 실행 식별 정보 | 오케스트레이터가 할당하고 planner가 검증하는 활성 Output 실행 식별 정보 |
| Readable Input Set | 명시적 Input과 같은 세션의 이전 Output 이력 |
| Execution Direction | 선택된 단일 실행 경로 |
| Plan Artifact | 계획 결과 산출물 |

| Field | Meaning |
| ----- | ------- |
| Mode | `subagent` |
| Source Read Policy | 허용 |
| Bash Policy | 제한적 허용 |
| Source Edit Policy | 허용하지 않음 |
| Web Fetch Policy | 허용하지 않음 |
| Task Policy | 허용하지 않음 |
| Owned Artifact | `.agents/<taskId>/<workItemId>/plan.md` |

### 8.3 Failure Handling

- 사실 확인이 부족하면 추측하지 않고 미확인 사항으로 남긴다.
- 소스 변경 시도는 거부된다.
- 웹 조회가 필요한 문제는 research 역할로 분리되어야 한다.
- taskId, workItemId, 정확한 산출물 경로가 누락되거나 유효하지 않으면 쓰기 전에 중단한다.
- 받은 실행 식별 정보를 재생성, 대체, 정규화하지 않는다.
- `Output:`이 없거나 둘 이상이거나 이전 같은 역할 경로와 구분되지 않으면 쓰기 전에 중단한다.
- Input이나 비활성 이력에 쓰려는 시도는 거부된다.
- 같은 세션에서 taskId 또는 역할이 달라지는 전이는 거부된다.
- 산출물 경로 확인이나 디렉터리 생성을 위해 명령을 실행하지 않고, 자기 산출물은 write로 직접 기록한다.

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
- 자기 산출물도 `edit`로 고치지 않고, 최종 내용을 `write`로 기록한다.

Rationale:

- 계획과 실행이 섞이면 변경 책임이 불명확해진다.

### 9.3 제한적 명령 실행 정책 [superseded 2026-07-10 — see Revision History]

Decision:

- `planner`의 명령 실행은 taskId 미제공 시 날짜 기반 taskId 생성과 읽기 검증으로 제한한다.
- `ls`, `mkdir`, `touch`, `rm`, `mv`, `cp`, shell redirection은 planner 권한 밖이다.

Rationale:

- 계획 agent가 경로 확인이나 디렉터리 생성을 명령으로 처리하면 산출물 소유권과 실행 책임이 흐려진다.

### 9.4 수신 실행 식별 정보 정책

Decision:

- taskId와 workItemId의 생성 책임은 오케스트레이터에 있다.
- `planner`는 받은 taskId, workItemId, 정확한 산출물 경로를 검증하고 그대로 사용한다.
- 실행 식별 정보가 누락되거나 유효하지 않으면 `planner`는 쓰기 전에 중단하며 대체 값을 만들지 않는다.
- `planner`의 명령 실행은 읽기 검증으로 제한하며 실행 식별 정보 생성에는 사용하지 않는다.

Rationale:

- 실행마다 산출물 소유권을 고유하게 유지하고 계획 역할과 조정 역할의 책임을 분리해야 한다.

### 9.5 활성 Output과 읽기 전용 문맥 정책

Decision:

- `planner`는 정확히 하나의 `Output:`을 현재 읽기·쓰기 대상으로 사용한다.
- `Input:`과 같은 세션의 이전 Output 이력은 읽기만 가능하다.
- 같은 taskId와 같은 planner 역할의 명시적 연속 실행만 새 work item을 활성화하거나 이전 이력을 재활성화할 수 있다.
- 새 workItemId는 taskId 전체에서 고유하며 다른 역할이나 세션과 공유하지 않는다.

Rationale:

- 계획 문맥을 같은 세션에서 이어가면서도 어떤 산출물이 현재 쓰기 대상인지 모호하지 않게 유지해야 한다.

---

## 10. Alternatives Considered

기록된 대안은 없다. 현재 문서는 구현된 역할 계약을 사실 기준으로 정리하며, 기록되지 않은 대안을 임의로 만들지 않는다. [superseded 2026-07-10 — see Revision History]

### Alternative: 새 work item마다 새 child 사용

Description:

- 같은 역할의 새 계획 work item도 항상 새 child 세션에서 시작한다.

Why not chosen:

- taskId와 역할을 고정하고 활성 Output을 정확히 전환하면 기존 대화 문맥을 안전하게 재사용할 수 있으므로 불필요한 세션 분리를 강제하지 않는다.

---

## 11. Cross-cutting Concerns

### 11.1 Security

- 명령 실행이 가능하므로 검증 목적 범위로 제한되어야 한다.
- 경로 나열·디렉터리 생성·파일 이동/삭제·redirection은 허용하지 않는다.
- Input과 이력 Output은 읽기 전용이고 활성 Output만 쓸 수 있다.

### 11.2 Privacy

- Not applicable: 이 역할은 개인 데이터 처리 정책을 새로 정의하지 않는다.

### 11.3 Permissions

- 소스 읽기와 명령 실행은 허용한다.
- 소스 변경, 웹 조회, 재위임은 허용하지 않는다.
- 명령 실행은 제한적 허용이며 산출물 경로 확인·생성에는 사용하지 않는다.
- 같은 세션의 읽기 범위는 활성 Output, 이력 Output, 명시적 Input으로 제한한다.

### 11.4 Observability

- 계획 산출물은 영향 범위, 위험, 미확인 사항을 추적하는 관측 지점이다.

### 11.5 Accessibility

- Not applicable: 이 역할은 별도 사용자 화면을 정의하지 않는다.

### 11.6 Internationalization

- 계획 설명은 사용자의 언어 흐름을 따라야 하며, agent 이름은 식별자로 유지한다.

---

## 12. Scope

### In Scope for as implemented (2026-07-10)

- 구현 전 계획.
- 영향 범위와 위험 정리.
- 단일 실행 경로 수렴.
- 오케스트레이터가 할당한 taskId, workItemId, 정확한 산출물 경로 검증.
- 정확히 하나의 Output과 0개 이상의 Input 구분.
- 같은 taskId·역할의 same-session work item 전이와 읽기 전용 이력.
- task-wide workItemId 고유성.
- 검증된 실행 식별 정보를 그대로 사용하는 입력 잠금.
- 산출물 `plan.md` write.

### Out of Scope for as implemented (2026-07-10)

- 소스 변경.
- 웹 기반 외부 조사.
- 여러 대안의 장기 발산.
- 산출물 경로 확인 또는 디렉터리 생성.
- 다른 agent 재위임.
- taskId 또는 workItemId 생성·대체.
- 같은 세션의 역할 또는 taskId 변경.
- Input이나 비활성 이력 산출물 쓰기.

---

## 13. Risks & Open Questions

### Risks

- 계획이 과도하게 상세해지면 실행 계획과 경계가 흐려질 수 있다.
- 미확인 사실이 누락되면 worker가 잘못된 가정으로 구현할 수 있다.
- 오케스트레이터가 유효한 실행 식별 정보를 전달하지 않으면 계획 산출물을 만들 수 없다.
- lifecycle 상관관계가 확인되지 않으면 안전한 전이도 거부될 수 있다.

### Open Questions

- 계획 산출물의 상세도 기준은 작업 규모에 따라 더 구체화될 수 있다.

---

## 14. Platform Design

### 14.1 Common Design

- OpenCode와 Codex의 planner는 정확히 하나의 활성 Output과 0개 이상의 명시적 Input을 받는다.
- 같은 taskId·역할의 후속 실행만 같은 세션 또는 leaf 문맥을 재사용하며, 쓰기는 활성 Output에 한정한다.

### 14.2 OpenCode

- 부모 task 연속 실행과 lifecycle metadata가 활성 work item 전이를 runtime에서 승인한다.
- Input과 이력 Output의 읽기 및 활성 Output 쓰기를 실행 전 권한 경계가 확인한다.

### 14.3 Codex

- planner leaf의 후속 메시지는 같은 의미 계약을 따르지만 OpenCode 전용 task 필드를 사용하지 않는다.
- exact assignment 전이는 Codex runtime 보장이 아니라 오케스트레이터와 leaf의 조정 계약으로 표현한다.

---

## Revision History

| Date | Type | Summary |
| ---- | ---- | ------- |
| 2026-07-10 | superseded | planner의 taskId 생성 책임을 폐기하고, 오케스트레이터가 할당한 taskId·workItemId·정확한 산출물 경로를 planner가 검증하고 소비하는 정책으로 교체했다. |
| 2026-07-10 | updated | 활성 Output과 명시적 Input을 분리하고 same-session 이력·전이·task-wide workItemId 고유성 정책을 추가했다. |
