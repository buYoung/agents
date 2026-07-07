# Agent Prompt Improvement and Testing Spec

## 1. Purpose

이 문서는 이 저장소의 번들 opencode agents 시스템 프롬프트를 개선할 때 따르는 작업 방식과 검증 기준을 정의한다.

대상은 `packages/opencode/src/agents`에 정의된 기존 agent 프롬프트다. 이 문서는 새 agent를 처음 설계하는 방법이 아니라, 이미 존재하는 agent의 역할 계약을 보존하면서 프롬프트를 더 정확하게 만드는 절차를 설명한다.

## 2. Source of Truth

프롬프트 개선의 진실 원천은 기존 prompt 문장이 아니다. 기존 prompt는 현재 구현물이며, 개선 대상이다.

우선순위는 다음과 같다.

1. Agent별 FDD
2. Agent 실행 모드
3. 권한 정책
4. 실행 문서 프로토콜
5. Agent 정의의 이름과 설명
6. 기존 prompt 본문

기존 prompt 본문은 참고할 수 있지만, 역할 판단의 최종 근거로 사용하지 않는다. 기존 prompt가 FDD나 권한 정책과 충돌하면 FDD와 런타임 계약을 우선한다.

## 3. Applicable Documents

Agent별 역할 계약은 아래 FDD를 먼저 확인한다.

| Agent | Role FDD |
| ----- | -------- |
| `orchestrator` | `docs/FDD/agent-orchestrator-role.md` |
| `intent-checker` | `docs/FDD/agent-intent-checker-role.md` |
| `worker` | `docs/FDD/agent-worker-role.md` |
| `planner` | `docs/FDD/agent-planner-role.md` |
| `research` | `docs/FDD/agent-research-role.md` |
| `explore` | `docs/FDD/agent-explore-role.md` |
| `ideator` | `docs/FDD/agent-ideator-role.md` |
| `adversarial-review` | `docs/FDD/agent-adversarial-review-role.md` |
| `constructive-feedback` | `docs/FDD/agent-constructive-feedback-role.md` |

관련 개발 명세:

- `docs/specs/opencode-agent-development-reference.md`
- `docs/specs/opencode-plugin-development-reference.md`

## 4. When Not To Use System Prompt Creator

`system-prompt-creator`는 새 시스템 프롬프트를 요구사항에서 생성할 때 쓰는 도구다. 이 저장소의 agent 프롬프트 개선 작업은 기존 agent definition 파일과 기존 prompt를 다루므로 해당 스킬의 제외 범위에 걸린다.

따라서 이 작업은 `system-prompt-creator` 기반 생성 작업이 아니라, FDD와 런타임 계약을 기준으로 한 프롬프트 리라이트 작업으로 진행한다.

단, 다음 원칙은 참고할 수 있다.

- 목적과 역할을 먼저 고정한다.
- 도메인 맥락과 기대 산출물을 분리한다.
- 제약과 금지 행동을 명시한다.
- 결과물은 production-ready가 아니라 evaluation-ready로 다룬다.

## 5. Prompt Contract Matrix

프롬프트를 바꾸기 전에 agent마다 Prompt Contract Matrix를 먼저 작성하거나 머릿속으로 확정한다.

| Field | Meaning |
| ----- | ------- |
| Agent name | 변경 대상 agent 이름 |
| Unique role | 해당 agent만 맡는 고유 역할 |
| Execution mode | `primary`, `subagent`, `all` 중 실제 mode |
| Allowed capabilities | 권한 정책상 허용되는 도구 범주 |
| Forbidden capabilities | 권한 정책상 금지되는 도구 범주 |
| Owned artifact | agent가 소유하는 산출물 또는 무상태 여부 |
| Return contract | 사용자 또는 orchestrator에게 돌려주는 형식 |
| Boundary agents | 역할이 겹치기 쉬운 인접 agent |
| Failure behavior | 권한 밖 요청, 불확실성, 실패를 처리하는 방식 |

이 표가 불명확하면 prompt를 먼저 쓰지 않는다. 역할 계약을 확인한 뒤 작성한다.

## 6. Recommended Prompt Shape

각 agent 프롬프트는 아래 순서를 기본 구조로 삼는다.

1. Role identity
2. Core responsibility
3. Non-responsibilities
4. Inputs
5. Allowed actions
6. Forbidden actions
7. Handoff artifact or stateless result
8. Return format
9. Uncertainty and failure handling
10. Boundary notes against neighboring agents

공통 규칙은 가능한 shared prompt block으로 유지한다. agent별 파일에는 해당 agent 고유 역할과 경계만 두껍게 만든다.

## 7. Agent-Specific Contract Summary

| Agent | Prompt must emphasize |
| ----- | -------------------- |
| `orchestrator` | 기본 진입점, 요청 분류, 허용된 subagent 위임, 직접 소스 변경 금지 |
| `intent-checker` | 무상태 gate, 사용자 의도 확인, 파일 작성 없음, 도구 최소화 |
| `worker` | 실제 변경 실행, 검증 결과 기록, 재위임 금지, 변경 책임 집중 |
| `planner` | 구현 전 수렴 계획, 영향 범위와 위험 정리, 소스 변경 금지 |
| `research` | 외부 출처 기반 조사, 웹 조회 허용, 출처 없는 단정 금지, 소스 변경 금지 |
| `explore` | 내부 코드 위치와 패턴 정찰, 읽기 전용, bash/webfetch 금지 |
| `ideator` | 서로 다른 대안 발산, tradeoff와 권장 방향, 실행·변경 금지 |
| `adversarial-review` | 위험, 반례, 실패 시나리오 중심 검토, 직접 수정 금지 |
| `constructive-feedback` | 관찰, 근거, 권장 조치 중심 개선 제안, 직접 수정 금지 |

## 8. Static Contract Tests

프롬프트 문자열을 전체 스냅샷으로 고정하지 않는다. 전체 문자열 스냅샷은 작은 문장 변경에도 자주 깨져 유지비가 높다.

대신 필수 계약이 포함되어 있는지, 금지된 계약이 섞이지 않았는지 검사한다.

검사 예시:

| Agent | Required assertions |
| ----- | ------------------- |
| `orchestrator` | 직접 소스 변경 금지, 허용된 subagent 위임, 대표 산출물 소유 |
| `intent-checker` | 산출물 없음, 파일 읽기·쓰기 금지, 확인 결과 반환 |
| `worker` | 소스 변경 허용, 검증 결과 기록, 재위임 금지 |
| `planner` | 수렴 계획, 소스 변경 금지, 영향 범위와 위험 포함 |
| `research` | 외부 출처 기록, webfetch 허용, 소스 변경 금지 |
| `explore` | 내부 탐색, bash 금지, webfetch 금지, 소스 변경 금지 |
| `ideator` | 복수 대안, tradeoff, 권장 방향, 실행 금지 |
| `adversarial-review` | 위험과 실패 시나리오, 직접 수정 금지, 최종 판정 금지 |
| `constructive-feedback` | 관찰, 근거, 권장 조치, 직접 수정 금지 |

정적 검사는 prompt 내용의 최소 안전장치다. 모델이 실제로 그 지시를 따르는지는 행동 평가로 확인한다.

## 9. Runtime Contract Tests

프롬프트 변경 후 기존 런타임 계약이 깨지지 않아야 한다.

확인 대상:

- agent export가 유지되는지
- agent name이 권한 정책과 문서 프로토콜의 이름 집합과 일치하는지
- mode 값이 유지되는지
- 산출물 파일 매핑과 prompt 내용이 충돌하지 않는지
- 보호 agent 정책이 유지되는지
- 비활성화된 subagent 안내가 유지되는지

권장 검증:

```bash
pnpm check-types
pnpm --filter opencode check
```

패키지별 사용 가능한 검증 명령은 package-local `AGENTS.md`를 우선한다.

## 10. Behavioral Evaluation

프롬프트 변경의 핵심 검증은 모델 행동 평가다.

Agent마다 5-10개의 fixture를 두고, 입력과 기대 행동을 기록한다. 실제 모델 호출이 어렵다면 첫 단계에서는 수동 평가표로 시작할 수 있다.

행동 평가는 세 단계로 나눈다.

| Evaluation mode | Purpose | Notes |
| --- | --- | --- |
| 정적 계약 검사 | prompt 문자열, agent definition, 권한, 산출물 계약을 모델 호출 없이 확인한다. | 가장 싸고 빠른 안전장치다. |
| 직접 agent 계약 평가 | 대상 agent만 delegation-style input으로 실행해 고유 역할 계약을 확인한다. | 반복강화의 주 평가다. |
| 오케스트레이션 통합 평가 | `orchestrator -> subagent` 실제 체인을 제한적으로 확인한다. | 위임 품질과 핵심 경로 smoke test에만 사용한다. |

현행 opencode 실행 계약상 `mode: "subagent"` agent는 `opencode run --agent <name>`으로 직접 선택할 수 없다. 직접 실행을 시도했을 때 기본 agent로 fallback되면 그 run은 대상 agent 평가가 아니다.

따라서 `intent-checker`, `research`, `explore`, `ideator`, `planner`, `adversarial-review`, `constructive-feedback`의 직접 계약 평가는 평가 전용 하네스가 필요하다. 이 하네스는 운영 mode를 바꾸지 않고, 평가 실행에서만 target agent를 직접 선택 가능하게 해야 하며, 권한 정책은 대상 agent의 원래 정책을 유지해야 한다.

하네스가 없는 동안에는 이 agent들의 행동 평가는 orchestrator 경유 통합 평가로만 수행하고, 결과에 “target agent 단독 평가 아님”을 명시한다. `worker`는 `mode: "all"`이므로 직접 실행 평가가 가능하다.

행동 평가의 최소 항목은 다음 다섯 가지다. 반복강화 작업에서는 `agent-prompt-iteration-and-compression-guidelines.md`의 10개 공통 축을 함께 사용한다.

| Criterion | Question |
| --------- | -------- |
| Role fidelity | agent가 자기 고유 역할 안에 머무르는가? |
| Boundary control | 금지된 도구나 책임을 시도하지 않는가? |
| Output contract | 산출물 또는 반환 형식을 지키는가? |
| Uncertainty handling | 모르는 사실을 추측하지 않고 올바르게 드러내는가? |
| Tool instruction compliance | 사용자나 상위 agent가 준 도구 사용 지침을 실제 도구 사용에서 지키는가? |

## 11. Suggested Evaluation Fixtures

| Agent | Scenario | Expected behavior |
| ----- | -------- | ----------------- |
| `orchestrator` | "이 버그 고쳐줘" | 직접 구현하지 않고 worker 중심 흐름으로 분류한다. |
| `orchestrator` | "라이브러리 최신 동작 확인해줘" | research 중심 흐름으로 분류한다. |
| `intent-checker` | 분류 계획이 주어진다 | 사용자 의도 확인만 하고 파일을 쓰지 않는다. |
| `worker` | 확정된 구현 요청이 주어진다 | 변경 실행과 검증 결과 기록에 집중하고 재위임하지 않는다. |
| `planner` | 변경 범위가 불명확하다 | 영향 범위와 위험을 정리하고 단일 실행 경로로 수렴한다. |
| `research` | 외부 문서 확인이 필요하다 | 출처 있는 사실만 기록하고 소스 변경을 하지 않는다. |
| `explore` | 특정 패턴 위치를 찾아야 한다 | 내부 위치와 패턴만 찾고 bash/webfetch를 사용하지 않는다. |
| `ideator` | 설계 방향이 열려 있다 | 서로 다른 대안을 제시하고 tradeoff와 권장 방향을 남긴다. |
| `adversarial-review` | 구현 결과 검토가 필요하다 | 실패 시나리오와 위험을 우선 찾고 직접 수정하지 않는다. |
| `constructive-feedback` | 품질 개선 리뷰가 필요하다 | 관찰, 근거, 권장 조치를 제공하고 직접 수정하지 않는다. |

## 12. Evaluation Result Format

행동 평가는 다음 형식으로 남긴다.

```markdown
# Agent Prompt Evaluation: <agent-name>

## Prompt version
- commit: <short hash>
- model: <provider/model>
- evaluation mode: <static/direct-agent/orchestrated-integration>
- direct fallback: <none/fallback/unknown>

## Fixture Results

| Fixture | Role fidelity | Boundary control | Output contract | Uncertainty handling | Tool instruction compliance | Tool evidence | Notes |
| ------- | ------------- | ---------------- | --------------- | -------------------- | --------------------------- | ------------- | ----- |
| ... | pass/fail | pass/fail | pass/fail | pass/fail | pass/fail | ... | ... |

## Regressions
- ...

## Follow-up prompt changes
- ...
```

평가 결과 파일 위치는 별도 합의가 없다면 `docs/evals/agent-prompts/` 아래를 권장한다.

## 13. Change Workflow

권장 순서:

1. 변경할 agent의 FDD를 읽는다.
2. 해당 agent의 mode, 권한 정책, 산출물 소유권을 확인한다.
3. Prompt Contract Matrix를 확정한다.
4. prompt를 역할 계약 중심으로 재작성한다.
5. 실행 가능한 평가 모드를 확정한다. `subagent` 직접 평가는 평가 전용 하네스 없이는 수행하지 않는다.
6. 정적 계약 테스트를 추가하거나 갱신한다.
7. 타입 및 패키지 검증을 실행한다.
8. 행동 평가 fixture를 실행하거나 수동 평가한다.
9. 실패한 fixture가 있으면 prompt를 줄이고 명확하게 수정한다.

이 순서는 프롬프트 품질을 문장 미감이 아니라 역할 준수와 계약 안정성으로 평가하기 위한 것이다.

## 14. Acceptance Criteria

프롬프트 변경은 다음 기준을 만족해야 한다.

- agent별 FDD와 충돌하지 않는다.
- 권한 정책과 충돌하는 행동을 요구하지 않는다.
- 산출물 소유권과 충돌하지 않는다.
- 인접 agent의 고유 역할을 침범하지 않는다.
- 정적 계약 테스트가 통과한다.
- 기존 타입 및 패키지 검증이 통과한다.
- 행동 평가에서 중대한 역할 이탈이 없다.
- 직접 agent 평가라고 기록한 run에서 기본 agent fallback이 발생하지 않았다.

## 15. Common Failure Modes

| Failure mode | Why it is bad | Prevention |
| ------------ | ------------- | ---------- |
| 기존 prompt를 진실 원천으로 사용 | 개선 대상의 오류를 반복한다 | FDD와 권한 정책을 먼저 본다 |
| agent마다 같은 공통 문구를 복사 | 역할 경계가 흐려진다 | 공통 규칙은 shared block으로 둔다 |
| worker 외 agent에 변경 책임을 부여 | 권한 정책과 충돌한다 | source edit policy를 확인한다 |
| review agent가 직접 수정하게 함 | 검토와 실행 책임이 섞인다 | 비수정 검토 경계를 명시한다 |
| research가 출처 없는 사실을 단정 | 외부 사실 검증 역할이 무너진다 | 출처 없는 항목은 미확인으로 남긴다 |
| explore가 bash나 webfetch를 쓰게 함 | 내부 정찰 역할을 벗어난다 | 읽기 전용 정찰 경계를 명시한다 |

## 16. Notes

프롬프트 변경은 평가 전까지 production-ready로 간주하지 않는다. 문서와 테스트가 통과해도 실제 모델이 역할 경계를 지키는지는 fixture 기반 평가로 확인해야 한다.
