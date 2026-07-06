---
doc-type: Feature Design Doc
profile: full
feature-name: agent-adversarial-review-role
status: active
created: 2026-07-06
last-verified: 2026-07-06
verified-against: bac12fa
tags: [agents, review, adversarial-review, risk]
related:
  - docs/FDD/agent-worker-role.md
  - docs/FDD/agent-constructive-feedback-role.md
purpose: Source of design decisions, not implementation actions
agent-readable: true
not:
  - task list
  - PR checklist
  - file-level change guide
---

# Adversarial Review Agent Role Feature Design Doc

## 1. Document Intent

이 문서는 `adversarial-review` agent의 고유 역할과 경계를 정의한다. 이 역할은 변경하지 않고 위험, 반례, 실패 가능성을 찾는 검토자다.

---

## 2. Background / Problem

구현 결과가 겉보기에는 작동해도 경계 조건, 보안 위험, 회귀 가능성이 남을 수 있다. 일반 개선 피드백과 달리 강한 의심의 관점으로 실패 시나리오를 찾는 역할이 필요하다.

---

## 3. Feature Definition

```text
Adversarial Review Agent Role is the non-editing review role that looks for risks, edge cases, counterexamples, and failure scenarios.
```

### This feature is

- 위험과 실패 가능성 중심의 검토 agent 역할이다.
- 소스를 변경하지 않고 읽기와 검증으로 문제를 찾는 역할이다.
- 항목별 우선순위를 드러내는 리뷰 역할이다.

### This feature is not

- 직접 수정하는 worker 역할이 아니다.
- 건설적 개선 제안을 중심으로 하는 feedback 역할이 아니다.
- 최종 합격 또는 불합격을 판정하는 승인자 역할이 아니다.

---

## 4. Goals & Non-Goals

### Goals

- 놓친 위험, 반례, 파손 가능성을 발견한다.
- 각 지적이 왜 문제가 되는지 구체적으로 설명한다.
- 최종 판단은 사용자에게 남긴다.

### Non-Goals

- 소스 변경을 하지 않는다.
- 일반적 칭찬이나 포괄적 개선 제안에 집중하지 않는다.
- 작업을 다른 agent에게 넘기지 않는다.

---

## 5. User Model & Core Concepts

### User Model

사용자는 `adversarial-review`를 "깨질 지점을 찾는 검토자"로 이해한다.

Users should not need to understand:

- 검토 도구의 내부 실행 방식.
- 다른 리뷰 agent와의 구현상 차이.

### Core Concepts

| Concept | Meaning |
| ------- | ------- |
| Risk Finding | 실제 문제가 될 수 있는 위험 항목 |
| Failure Scenario | 문제가 드러나는 입력, 상태, 순서 |
| Severity | 조치 우선순위를 나타내는 분류 |
| Review Artifact | 검토 결과 산출물 |

---

## 6. Relationship to Existing Features

| Existing Feature | Relationship |
| ---------------- | ------------ |
| Worker role | 구현 결과를 검토할 수 있다. |
| Constructive feedback role | 개선 제안 중심 검토와 구분된다. |
| Permission enforcement | 읽기와 검증은 허용하되 변경은 금지한다. |
| Run document protocol | 검토 결과 산출물 소유권을 제공한다. |

---

## 7. Primary User Flows

### 7.1 Main Flow

```text
구현 또는 설계 결과에 위험 검토가 필요하다.
  -> adversarial-review가 관련 내용을 읽는다.
  -> 실패 가능성과 반례를 찾는다.
  -> 심각도와 재현 가능성을 포함해 결과를 남긴다.
```

### 7.2 Secondary Flow

```text
의심되는 지점이 검증 가능하다.
  -> adversarial-review가 명령 실행으로 사실을 확인한다.
  -> 확인 결과를 위험 판단 근거로 남긴다.
```

### 7.3 Failure / Partial Success Flow

```text
명확한 결함을 찾지 못한다.
  -> 발견 없음 또는 낮은 신뢰의 관찰을 남긴다.
  -> 최종 수락 여부는 사용자가 판단한다.
```

---

## 8. Design

### 8.1 Behavior

`adversarial-review`는 `subagent` 실행 모드다. 소스 읽기와 명령 실행은 가능하지만 소스 변경, 웹 조회, 재위임은 허용되지 않는다. 산출물은 위험 항목, 실패 시나리오, 근거를 중심으로 한다.

### 8.2 Conceptual Data Model

| Entity | Meaning |
| ------ | ------- |
| Review Target | 검토 대상 코드, 설계, 산출물 |
| Risk Finding | 발견된 위험 또는 결함 후보 |
| Failure Scenario | 위험이 현실화되는 조건 |
| Review Artifact | 검토 결과 산출물 |

| Field | Meaning |
| ----- | ------- |
| Mode | `subagent` |
| Source Read Policy | 허용 |
| Bash Policy | 허용 |
| Source Edit Policy | 허용하지 않음 |
| Task Policy | 허용하지 않음 |

### 8.3 Failure Handling

- 검증 실패 자체도 검토 근거로 남길 수 있다.
- 소스 변경 시도는 거부된다.
- 최종 합격·불합격 판정은 하지 않는다.

---

## 9. Policy Decisions

### 9.1 비수정 검토 정책

Decision:

- `adversarial-review`는 문제를 찾지만 직접 수정하지 않는다.

Rationale:

- 검토와 수정이 섞이면 독립적인 위험 평가가 약해진다.

### 9.2 위험 중심 정책

Decision:

- 이 역할은 건설적 개선보다 실패 가능성과 반례 발굴에 집중한다.

Rationale:

- 개선 제안 중심 검토는 별도 역할이 담당하므로 관점을 분리한다.

---

## 10. Alternatives Considered

기록된 대안은 없다. 현재 문서는 구현된 역할 계약을 사실 기준으로 정리하며, 기록되지 않은 대안을 임의로 만들지 않는다.

---

## 11. Cross-cutting Concerns

### 11.1 Security

- 보안 위험을 찾는 역할이지만 변경 권한은 없다.

### 11.2 Privacy

- Not applicable: 이 역할은 새 데이터 처리 정책을 만들지 않는다.

### 11.3 Permissions

- 소스 읽기와 명령 실행은 허용한다.
- 소스 변경, 웹 조회, 재위임은 허용하지 않는다.

### 11.4 Observability

- 검토 산출물은 위험 항목과 근거를 추적하는 관측 지점이다.

### 11.5 Accessibility

- Not applicable: 이 역할은 사용자 화면을 정의하지 않는다.

### 11.6 Internationalization

- 리뷰 설명은 사용자 언어로 작성하되, 심각도와 식별자는 일관되게 유지한다.

---

## 12. Scope

### In Scope for as implemented (2026-07-06)

- 위험, 반례, 실패 시나리오 발굴.
- 읽기와 검증 중심 검토.
- 검토 결과 산출물 작성.

### Out of Scope for as implemented (2026-07-06)

- 직접 수정.
- 건설적 개선 제안 중심 리뷰.
- 최종 승인 판정.
- 외부 웹 조사.

---

## 13. Risks & Open Questions

### Risks

- 위험 중심 검토가 과도하면 실제 우선순위보다 많은 문제처럼 보일 수 있다.
- 검증 가능한 사실과 추정이 분리되지 않으면 사용자가 조치 우선순위를 잘못 판단할 수 있다.

### Open Questions

- 심각도 기준의 세부 운영 정책은 별도 문서로 더 정교화될 수 있다.

