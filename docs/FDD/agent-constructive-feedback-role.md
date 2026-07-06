---
doc-type: Feature Design Doc
profile: full
feature-name: agent-constructive-feedback-role
status: active
created: 2026-07-06
last-verified: 2026-07-06
verified-against: bac12fa
tags: [agents, review, constructive-feedback, improvement]
related:
  - docs/FDD/agent-adversarial-review-role.md
  - docs/FDD/agent-worker-role.md
purpose: Source of design decisions, not implementation actions
agent-readable: true
not:
  - task list
  - PR checklist
  - file-level change guide
---

# Constructive Feedback Agent Role Feature Design Doc

## 1. Document Intent

이 문서는 `constructive-feedback` agent의 고유 역할과 경계를 정의한다. 이 역할은 직접 수정하지 않고 실행 가능한 개선 제안을 제공하는 검토자다.

---

## 2. Background / Problem

구현이나 설계 결과에는 치명적 결함이 아니더라도 가독성, 유지보수성, 일관성 개선 여지가 남을 수 있다. 위험 중심 리뷰와 별개로 개선 방향을 구체적으로 제안하는 역할이 필요하다.

---

## 3. Feature Definition

```text
Constructive Feedback Agent Role is the non-editing review role that provides actionable improvement suggestions with rationale.
```

### This feature is

- 개선 제안 중심의 검토 agent 역할이다.
- 관찰, 근거, 권장 조치를 제공하는 역할이다.
- 직접 수정하지 않고 후속 판단을 돕는 역할이다.

### This feature is not

- 결함과 반례를 공격적으로 찾는 adversarial review 역할이 아니다.
- 직접 변경을 수행하는 worker 역할이 아니다.
- 최종 승인 또는 거절 판정자 역할이 아니다.

---

## 4. Goals & Non-Goals

### Goals

- 실행 가능한 개선 제안을 제공한다.
- 개선 필요성의 근거를 설명한다.
- 유지보수성, 가독성, 일관성 관점의 판단을 돕는다.

### Non-Goals

- 소스 변경을 하지 않는다.
- 실패 시나리오 발굴에만 집중하지 않는다.
- 작업을 다른 agent에게 재위임하지 않는다.

---

## 5. User Model & Core Concepts

### User Model

사용자는 `constructive-feedback`을 "더 낫게 만들 방법을 제안하는 검토자"로 이해한다.

Users should not need to understand:

- 리뷰 산출물을 저장하는 내부 방식.
- 위험 중심 리뷰와의 구현상 차이.

### Core Concepts

| Concept | Meaning |
| ------- | ------- |
| Observation | 현재 상태에 대한 사실 기반 관찰 |
| Rationale | 왜 개선이 필요한지에 대한 근거 |
| Recommended Action | 사용자가 실행 여부를 판단할 수 있는 조치 제안 |
| Feedback Artifact | 개선 제안 산출물 |

---

## 6. Relationship to Existing Features

| Existing Feature | Relationship |
| ---------------- | ------------ |
| Worker role | 구현 결과에 대한 개선 제안을 제공할 수 있다. |
| Adversarial review role | 위험 중심 검토와 다른 관점의 리뷰를 제공한다. |
| Permission enforcement | 읽기와 검증은 허용하되 변경은 금지한다. |
| Run document protocol | 피드백 산출물 소유권을 제공한다. |

---

## 7. Primary User Flows

### 7.1 Main Flow

```text
사용자가 결과물의 품질 개선 관점을 원한다.
  -> constructive-feedback이 관련 내용을 읽는다.
  -> 개선 가능한 지점을 관찰한다.
  -> 근거와 권장 조치를 함께 남긴다.
```

### 7.2 Secondary Flow

```text
개선 제안의 근거 확인이 필요하다.
  -> constructive-feedback이 명령 실행으로 사실을 확인할 수 있다.
  -> 확인 결과를 제안 근거에 반영한다.
```

### 7.3 Failure / Partial Success Flow

```text
뚜렷한 개선 제안이 없다.
  -> 발견 없음 또는 낮은 우선순위 관찰을 남긴다.
  -> 최종 적용 여부는 사용자가 판단한다.
```

---

## 8. Design

### 8.1 Behavior

`constructive-feedback`은 `subagent` 실행 모드다. 소스 읽기와 명령 실행은 가능하지만 소스 변경, 웹 조회, 재위임은 허용되지 않는다. 산출물은 관찰, 근거, 권장 조치를 중심으로 한다.

### 8.2 Conceptual Data Model

| Entity | Meaning |
| ------ | ------- |
| Feedback Target | 검토 대상 코드, 설계, 문서 또는 산출물 |
| Observation | 현재 상태에 대한 구체적 관찰 |
| Rationale | 개선 필요성의 이유 |
| Recommended Action | 실행 가능한 개선 제안 |

| Field | Meaning |
| ----- | ------- |
| Mode | `subagent` |
| Source Read Policy | 허용 |
| Bash Policy | 허용 |
| Source Edit Policy | 허용하지 않음 |
| Task Policy | 허용하지 않음 |

### 8.3 Failure Handling

- 개선 제안이 확실하지 않으면 단정하지 않고 확인 필요로 남긴다.
- 소스 변경 시도는 거부된다.
- 최종 적용 여부는 사용자가 결정한다.

---

## 9. Policy Decisions

### 9.1 비수정 피드백 정책

Decision:

- `constructive-feedback`은 개선 제안을 제공하지만 직접 수정하지 않는다.

Rationale:

- 피드백과 실행을 분리해야 사용자가 제안 적용 여부를 판단할 수 있다.

### 9.2 개선 중심 정책

Decision:

- 이 역할은 위험 발굴보다 실행 가능한 개선 제안에 집중한다.

Rationale:

- 위험 중심 검토는 별도 역할이 담당하므로 리뷰 관점을 분리한다.

---

## 10. Alternatives Considered

기록된 대안은 없다. 현재 문서는 구현된 역할 계약을 사실 기준으로 정리하며, 기록되지 않은 대안을 임의로 만들지 않는다.

---

## 11. Cross-cutting Concerns

### 11.1 Security

- 읽기와 검증 권한은 있지만 변경 권한은 없어 개선 제안과 실행이 분리된다.

### 11.2 Privacy

- Not applicable: 이 역할은 새 데이터 처리 정책을 만들지 않는다.

### 11.3 Permissions

- 소스 읽기와 명령 실행은 허용한다.
- 소스 변경, 웹 조회, 재위임은 허용하지 않는다.

### 11.4 Observability

- 피드백 산출물은 관찰, 근거, 권장 조치를 추적하는 기준이다.

### 11.5 Accessibility

- Not applicable: 이 역할은 사용자 화면을 정의하지 않는다.

### 11.6 Internationalization

- 피드백 설명은 사용자 언어로 작성하되, 코드 식별자는 원문을 유지한다.

---

## 12. Scope

### In Scope for as implemented (2026-07-06)

- 개선 제안 중심 검토.
- 관찰, 근거, 권장 조치 작성.
- 읽기와 검증 중심 리뷰.

### Out of Scope for as implemented (2026-07-06)

- 직접 수정.
- 위험 중심 적대적 검토.
- 최종 승인 판정.
- 외부 웹 조사.

---

## 13. Risks & Open Questions

### Risks

- 제안이 너무 일반적이면 실행 가능성이 낮아진다.
- 위험 검토가 필요한 상황에서 이 역할만 사용하면 결함 발굴이 부족할 수 있다.

### Open Questions

- 개선 제안의 우선순위 표현 방식은 별도 운영 기준으로 구체화될 수 있다.

