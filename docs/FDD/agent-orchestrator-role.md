---
doc-type: Feature Design Doc
profile: full
feature-name: agent-orchestrator-role
status: active
created: 2026-07-06
last-verified: 2026-07-10
verified-against: a482dd3
tags: [agents, orchestrator, delegation, primary-agent]
related:
  - docs/FDD/agent-intent-checker-role.md
  - docs/FDD/agent-worker-role.md
  - docs/FDD/agent-planner-role.md
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
- 필요한 경우 산출물 존재, 줄 수, git 상태 같은 제한된 사실만 읽기 전용 bash로 확인한다.

### Non-Goals

- 소스 파일을 직접 읽고 수정하지 않는다.
- 빌드, 테스트, 설치, 네트워크 명령, 구현 검증 명령을 직접 실행하지 않는다.
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
| 활성 출력 | child 세션이 현재 읽고 쓸 수 있는 정확히 하나의 역할 산출물 |
| 이력 출력 | 같은 세션의 이전 활성 출력으로서, 같은 taskId·역할의 명시적 재할당으로 다시 활성화되기 전에는 읽기만 가능한 산출물 |
| 명시적 입력 | 위임 메시지의 `Input:`으로 등록된 읽기 전용 산출물 |
| 작업 원장 | taskId 전체에서 workItemId 중복과 소유 충돌을 막는 예약 기록 |

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

`orchestrator`는 `primary` 실행 모드의 agent다. 사용자가 별도 기본 agent를 지정하지 않으면 이 역할이 기본 진입점이 된다. 이 역할은 소스 변경, 웹 조회, 구현 검증을 직접 수행하지 않고, 허용된 subagent 위임을 통해 작업을 진행한다. bash는 산출물 존재, 줄 수, git 상태 같은 읽기 전용 사실 확인에만 제한된다.

산출물 위임에는 정확히 하나의 `Output:`과 필요한 만큼의 `Input:`을 구분해 전달한다. 같은 child 세션은 같은 taskId와 같은 역할 안에서 활성 work item을 유지하거나 새 work item으로 전환할 수 있다. 새 work item이 활성화되면 이전 출력은 읽기 전용 이력이 되고, 쓰기는 새 활성 출력에만 허용된다. 같은 taskId·역할의 명시적 후속 실행이 이력 Output을 현재 Output으로 다시 할당하면 그 이력은 활성·쓰기 가능 상태로 돌아가고 직전 활성 출력은 이력이 된다. fresh child는 부모 호출과 실제 child를 연결하는 신뢰된 lifecycle 정보가 확인된 뒤에만 최초 할당을 얻는다. workItemId는 역할별이 아니라 taskId 전체에서 고유하다. root 세션의 후속 의견은 기존 대표 산출물을 계속 사용하며, 새 root task identity는 새 대화에서 시작한다.

### 8.2 Conceptual Data Model

| Entity | Meaning |
| ------ | ------- |
| Request Classification | 사용자 요청을 역할 레인으로 나눈 결과 |
| Delegation Target | 위임 가능한 subagent |
| Master Artifact | 조정자가 소유하는 작업 대표 산출물 |
| Active Assignment | child 세션의 현재 읽기·쓰기 대상인 하나의 출력 |
| Historical Assignment | 같은 taskId·역할에서 이전에 활성 상태였던 읽기 전용 출력 |
| Readable Input | 부모가 명시적으로 등록한 읽기 전용 산출물 |
| Task Ledger | taskId 전체의 workItemId와 소유 세션을 예약하는 기록 |

| Field | Meaning |
| ----- | ------- |
| Mode | `primary` |
| Source Read Policy | 문서 영역 중심의 제한 읽기 |
| Source Edit Policy | 허용하지 않음 |
| Bash Policy | 읽기 전용 사실 확인만 허용 |
| Task Policy | 허용된 subagent로만 위임 |

### 8.3 Failure Handling

- 허용되지 않은 agent로 위임하면 거부된다.
- 소스 변경 도구를 호출하면 거부된다.
- 대상 subagent가 비활성화된 경우 그 역할을 사용할 수 없는 상태로 취급한다.
- `Output:`이 없거나 둘 이상이거나 `Input:`과 혼동되면 산출물 위임을 거부한다.
- 같은 세션에서 taskId 또는 역할을 바꾸려 하면 거부한다.
- 같은 taskId 안에서 이미 예약된 workItemId를 다른 역할이나 세션이 사용하려 하면 거부한다.
- 정리된 MCP 서버 키가 충돌하거나 도구 접두사가 모호하면 구성을 적용하지 않는다.
- 구성 MCP 접두사가 예약 runtime 도구 ID와 충돌할 수 있으면 구성을 적용하지 않는다.
- fresh child의 부모 호출과 실제 child가 lifecycle 정보로 연결되기 전에는 prompt만으로 할당하지 않는다.

---

## 9. Policy Decisions

### 9.1 기본 진입 정책

Decision:

- 기본 agent가 지정되지 않은 경우 `orchestrator`를 진입점으로 사용한다.

Rationale:

- 요청 분류 없이 구현 agent로 바로 들어가면 역할 경계가 흐려진다.

### 9.2 직접 실행 제한 정책

Decision:

- `orchestrator`는 소스 변경, 웹 조회, 구현 검증을 직접 수행하지 않는다.
- bash는 산출물 존재, 줄 수, git 상태 같은 읽기 전용 사실 확인으로만 제한한다.

Rationale:

- 조정자 역할과 실행자 역할을 분리해야 변경 책임을 추적할 수 있다.
- 산출물 존재 확인은 조정자 책임을 닫는 데 필요하지만, 구현·검증 명령까지 허용하면 worker 역할과 충돌한다.

### 9.3 보호 agent 정책

Decision:

- `orchestrator`는 보호 agent로 유지된다.

Rationale:

- 이 역할이 제거되면 기본 작업 조정 흐름이 사라진다.

### 9.4 출력과 입력 분리 정책

Decision:

- artifact-writing 위임은 정확히 하나의 `Output:`과 0개 이상의 `Input:`을 구분한다.
- 활성 Output만 쓸 수 있고, Input과 이력 Output은 읽기만 가능하다.
- marker가 없는 기존 위임은 출력이 하나로 명확한 경우에만 호환 해석한다.

Rationale:

- 이전 같은 역할 산출물을 새 출력으로 오인하면 세션 소유권과 쓰기 경계가 바뀔 수 있으므로 출력과 입력을 구조적으로 분리해야 한다.

### 9.5 같은 세션 work item 전이 정책

Decision:

- 같은 child 세션은 같은 taskId와 같은 역할에서만 새 work item을 활성화할 수 있다.
- 명시적 부모 연속 실행이 전이를 승인하며, 이전 활성 출력은 읽기 전용 이력으로 이동한다.
- 같은 taskId·역할의 명시적 후속 실행은 이력 Output을 다시 활성화할 수 있으며, 재활성화된 Output만 쓰기 가능해진다.
- fresh child의 최초 활성화는 부모 호출과 실제 child를 식별하는 lifecycle 정보가 확인된 뒤에만 허용한다.
- workItemId는 taskId 전체에서 고유하며, 역할이나 세션이 달라도 재사용하지 않는다.
- root 후속 의견은 같은 대표 산출물을 사용하고 같은 대화에서 root task identity를 회전하지 않는다.

Rationale:

- 대화 문맥은 재사용하되 역할·task 경계와 활성 쓰기 대상의 정확성을 유지해야 한다.

### 9.6 구성 MCP 감쇠 정책

Decision:

- native 설정에서 활성화한 MCP 서버는 사용자가 신뢰한 capability로 취급한다.
- `orchestrator`는 구성 MCP 서버 도구를 기본 거부하며 `disabled_mcp`는 다른 역할의 허용 범위를 추가로 줄인다.
- 이 정책은 서버 도구 호출에 적용하고 generic MCP resource API의 완전 격리를 보장하지 않는다.
- builtin/core와 generic MCP resource의 정확한 예약 ID를 서버 도구보다 먼저 분류하며, 이 ID와 충돌 가능한 서버 접두사는 구성 오류로 거부한다.
- generic MCP resource API는 구성 서버 도구 권한으로 승격하지 않는다.

Rationale:

- 실행 전 경계에는 최종 도구 ID만 있어 서버의 실제 효과나 provenance를 증명할 수 없으므로, 사용자 신뢰와 역할 감쇠를 명확히 분리해야 한다.

---

## 10. Alternatives Considered

기록된 대안은 없다. 현재 문서는 구현된 역할 계약을 사실 기준으로 정리하며, 기록되지 않은 대안을 임의로 만들지 않는다. [superseded 2026-07-10 — see Revision History]

### Alternative: namespace 또는 suffix 기반 MCP 신뢰

Description:

- 도구 ID의 namespace나 읽기형 suffix만 보고 구성 MCP 도구로 허용한다.

Why not chosen:

- 최종 ID는 provenance가 아니며 이름 형태만으로 서버 효과와 등록 주체를 증명할 수 없다.

### Alternative: 새 work item마다 새 child 사용

Description:

- 같은 역할의 새 work item도 항상 새 child 세션에 할당한다.

Why not chosen:

- 같은 taskId·역할과 정확한 활성 Output 전이를 집행하면 대화 문맥을 유지하면서 쓰기 경계를 보존할 수 있다.

### Alternative: generic MCP resource 필터 추가

Description:

- 서버 도구 정책과 함께 generic resource API를 서버별로 완전 필터링한다.

Why not chosen:

- 이번 정책은 서버 도구 호출 감쇠에 한정하며 별도 resource 격리 subsystem은 범위 밖이다.

---

## 11. Cross-cutting Concerns

### 11.1 Security

- 직접 변경 권한 없이 위임 권한만 갖도록 제한해 권한 범위를 줄인다.
- 활성 출력만 쓰게 하고 workItemId를 task-wide로 예약해 같은 산출물의 중복 소유를 막는다.
- 구성 MCP의 효과와 provenance를 추론하지 않으며 충돌·모호성은 거부한다.
- read-only bash로 찾은 산출물도 직접 파일 읽기와 같은 활성·이력·명시 Input 범위를 적용한다.

### 11.2 Privacy

- Not applicable: 이 역할은 개인 데이터 수집이나 저장 정책을 새로 정의하지 않는다.

### 11.3 Permissions

- source edit, webfetch는 허용하지 않는다.
- bash는 읽기 전용 사실 확인만 허용한다.
- task 위임은 허용된 subagent에 한정한다.
- 구성 MCP 서버 도구는 `orchestrator`에서 거부한다.

### 11.4 Observability

- 대표 산출물은 어떤 subagent 결과를 기준으로 작업이 진행됐는지 추적하는 기준이 된다.

### 11.5 Accessibility

- Not applicable: 이 역할은 별도 화면이나 상호작용 컴포넌트를 정의하지 않는다.

### 11.6 Internationalization

- 사용자에게 노출되는 설명은 한국어 흐름을 지원할 수 있어야 하며, agent 이름은 식별자로 유지한다.

---

## 12. Scope

### In Scope for as implemented (2026-07-10)

- `orchestrator`의 기본 진입 역할.
- 허용된 subagent 위임.
- 소스 변경 금지.
- 대표 산출물 소유.
- 보호 agent 성격.
- Output과 Input을 분리한 위임.
- 같은 taskId·역할의 same-session 활성 work item 전이와 읽기 전용 이력.
- task-wide workItemId 예약과 root task identity 고정.
- 구성 MCP 서버 도구의 역할별 감쇠.
- 예약 runtime 도구 ID의 구성 MCP 승격 차단.

### Out of Scope for as implemented (2026-07-10)

- 직접 구현 수행.
- 외부 웹 조사 수행.
- 개별 subagent 산출물 작성.
- MCP 서버 도구의 세부 읽기·쓰기·네트워크 효과 추론.
- generic MCP resource API의 서버별 완전 격리.
- 같은 root 대화 안의 새 task identity 회전.

---

## 13. Risks & Open Questions

### Risks

- 조정자 역할이 너무 넓게 해석되면 worker나 review agent의 책임을 침범할 수 있다.
- subagent 비활성화 상태가 사용자에게 충분히 드러나지 않으면 위임 실패가 혼란스럽게 보일 수 있다.
- MCP 최종 도구 ID는 provenance 증명이 아니므로 custom/plugin ID 충돌 환경은 지원 경계 밖이다.
- lifecycle event가 누락된 연속 실행은 안전하게 거부되어 재시도가 필요할 수 있다.
- 신뢰된 child lifecycle 정보보다 먼저 도착한 fresh-child prompt는 안전하게 거부되어 event 뒤 재시도가 필요할 수 있다.

### Open Questions

- 사용자가 기본 agent를 직접 바꾼 경우 이 역할의 발견성을 어떻게 유지할지는 별도 결정이 필요하다.

---

## 14. Platform Design

### 14.1 Common Design

- OpenCode와 Codex 모두 같은 taskId·역할 안에서 활성 Output, 읽기 전용 이력, 명시적 Input 의미를 공유한다.
- 두 플랫폼 모두 같은 taskId·역할의 명시적 후속 실행으로 이력 Output을 현재 Output에 다시 할당하면 재활성화된 Output이 쓰기 가능해지고 직전 활성 Output은 이력이 된다는 의미를 공유한다.
- 두 플랫폼 모두 새 work item의 task-wide 고유 workItemId와 안정된 root task identity를 요구한다.

### 14.2 OpenCode

- 기존 child 연속 실행과 lifecycle metadata를 이용해 활성 할당 전이를 runtime에서 확인하며, fresh child는 부모 호출과 실제 child가 확인된 event 뒤에만 최초 활성화한다.
- native MCP 구성과 agent permission을 결합하고 실행 전 경계에서 같은 서버 도구 정책을 다시 확인한다.
- 직접 파일 읽기와 read-only bash 산출물 읽기에 같은 세션 readable set을 적용한다.

### 14.3 Codex

- 기존 leaf 후속 실행과 새 leaf spawn의 의미를 프롬프트 계약으로 구분한다.
- 같은 taskId·역할의 명시적 leaf 후속 실행이 historical Output을 현재 Output으로 재할당하는 의미를 프롬프트 계약으로 표현한다.
- OpenCode 전용 task 필드를 복제하거나 Codex에 같은 runtime 할당 집행이 있다고 주장하지 않는다.

---

## Revision History

| Date | Type | Summary |
| ---- | ---- | ------- |
| 2026-07-10 | updated | Output/Input 분리, same-session 활성·이력 work item 전이, task-wide 고유성, root identity 고정과 구성 MCP 감쇠 경계를 반영했다. |
| 2026-07-10 | updated | 예약 runtime 도구 ID 우선 분류, bash 산출물 readable set, fresh-child lifecycle 상관관계와 양 플랫폼의 historical Output 재활성화 의미를 반영했다. |
