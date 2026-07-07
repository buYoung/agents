# Agent Prompt Iteration and Compression Guidelines

## 1. Purpose

이 문서는 번들 agent 시스템 프롬프트를 개선할 때 사용하는 공통 반복강화 기준과 프롬프트 압축 기준을 정의한다.

대상은 특정 agent 하나가 아니라 `packages/opencode/src/agents`의 모든 agent다. 각 agent의 고유 역할 값은 FDD와 권한 정책에서 가져오고, 평가는 이 문서의 공통 축에 맞춰 수행한다.

## 2. Source of Truth

반복강화와 압축의 기준은 기존 프롬프트 문장이 아니다. 기존 프롬프트는 개선 대상이다.

우선순위는 다음과 같다.

1. Agent별 FDD
2. 실행 모드
3. 권한 정책
4. 실행 문서 프로토콜
5. Agent 이름과 설명
6. 기존 프롬프트 본문

프롬프트는 위 계약을 모델이 더 안정적으로 따르도록 돕는 지시문이다. 계약 자체를 새로 만들거나 확장하지 않는다.

## 3. Universal Evaluation Axes

모든 agent는 아래 공통 축으로 평가한다. agent마다 달라지는 것은 축의 값이지 축 자체가 아니다.

| Axis | Question |
| --- | --- |
| 역할 경계 | agent가 자기 고유 책임 안에 머무르는가? |
| 권한 경계 | 허용된 도구와 파일 범위만 사용하는가? |
| 입력 해석 | 사용자 또는 상위 agent의 목표, 범위, 금지 조건을 보존하는가? |
| 실행 범위 | 요청받은 단계까지만 수행하고 다음 단계를 실행하지 않는가? |
| 산출물 계약 | 자기 산출물 파일, 한 줄 반환, 경로 반환 같은 결과 형식을 지키는가? |
| 근거와 불확실성 | 확인한 사실과 추론을 구분하고, 모르는 사실을 꾸며내지 않는가? |
| 도구 사용 충실도 | 써야 할 도구는 실제로 쓰고, 쓰면 안 되는 도구는 쓰지 않는가? |
| 실패 처리 | 권한 밖 요청, 부족한 입력, 도구 실패, 확인 불가 상태를 성공처럼 포장하지 않는가? |
| 최소성 | 불필요한 조사, 계획, 상태 파일, todo, 장황한 설명을 만들지 않는가? |
| 재현 안정성 | 같은 유형의 요청을 반복 실행했을 때 같은 계약을 안정적으로 지키는가? |

## 4. Agent Contract Matrix

각 agent를 반복강화하기 전에 아래 값을 먼저 확정한다.

| Field | Meaning |
| --- | --- |
| Agent name | 변경 대상 agent 이름 |
| Unique role | 해당 agent만 맡는 고유 역할 |
| Execution mode | `primary`, `subagent`, `all` 중 실제 mode |
| Allowed tools | 권한 정책상 허용되는 도구와 파일 접근 |
| Forbidden tools | 금지되는 도구, 파일 접근, 재위임 |
| Input contract | 사용자가 직접 주는 입력인지, orchestrator 위임 입력인지 |
| Allowed actions | 수행해도 되는 행동 |
| Forbidden actions | 수행하면 안 되는 행동 |
| Owned artifact | 소유 산출물 파일 또는 무상태 여부 |
| Return contract | 반환 형식과 최소 포함 정보 |
| Neighbor boundaries | 역할이 겹치기 쉬운 agent와의 경계 |
| Failure behavior | 불확실성, 권한 밖 요청, 실패를 처리하는 방식 |

이 표가 비어 있으면 프롬프트를 먼저 쓰지 않는다.

## 5. Iterative Reinforcement Workflow

반복강화는 모델이 특정 fixture 정답을 외우게 하는 작업이 아니다. 역할 계약을 실제 실행에서 안정적으로 지키도록 실패 행동을 일반 규칙으로 줄이는 작업이다.

권장 절차:

1. 기준선 실행을 기록한다.
2. 오케스트레이터가 호출하는 subagent라면 대표 오케스트레이터 flow를 1회 실행해 실제 delegation input shape를 캡처한다.
3. 직접 agent 계약 평가 fixture는 캡처한 실제 delegation input shape를 기준으로 만든다.
4. 실제 `tool_use`, 산출물, 반환 형식을 확인한다.
5. 실패를 공통 평가 축 중 하나로 분류한다.
6. 실패 하나당 가장 좁은 일반 규칙을 추가하거나 기존 규칙을 줄여 명확하게 만든다.
7. 프롬프트가 바뀌면 해당 평가 유형의 통과 횟수를 리셋한다.
8. 같은 유형 요청을 최소 3회 반복 실행한다.
9. 3회 모두 같은 계약을 지키면 그 유형을 통과로 본다.
10. 실패가 재발하면 다시 5단계로 돌아간다.

1회 성공은 안정성 근거가 아니다. 모델 변동성이 있으므로 최소 3회 반복 평균과 실패 양상을 함께 기록한다.

### 5.1 Clean-run Retest Rule

실패 후 재평가는 반드시 깨끗한 새 평가 run으로 시작한다.

금지:

- 실패 로그 전문, 이전 도구 출력, 평가 문서 전문을 다음 평가 입력에 넣지 않는다.
- 같은 opencode 세션이나 장시간 누적된 대화 컨텍스트 안에서 “수정 후 재평가”를 계속 이어가지 않는다.
- 실패 원인을 모델에게 힌트처럼 설명한 뒤 통과 여부를 재측정하지 않는다.

허용:

- 사람이 실패 로그를 집계해 원인을 분석한다.
- 프롬프트나 권한 정책을 수정한다.
- 새 `OPENCODE_RUN_ID`와 새 opencode 세션으로 대상 fixture만 실행한다.
- 새 평가 입력에는 사용자 요청, taskId, 필요한 경로, 사용자 지정 도구 지침만 넣는다.
- 이전 실패는 평가 문서에 요약 수치로만 기록한다.

판정:

- 실패 분석 컨텍스트가 다음 모델 입력에 들어간 run은 행동 평가로 인정하지 않는다.
- 프롬프트 변경 후 통과 기록은 clean-run 3회가 모두 통과해야만 유효하다.
- 이전 실패 로그를 많이 읽은 뒤 이어서 실행한 “재평가”는 오염 가능성이 있으므로 `needs-clean-revalidation`으로 되돌린다.

## 6. Evaluation Execution Modes

반복강화 평가는 실행 경로를 분리해서 봐야 한다.

| Mode | Purpose | When to use |
| --- | --- | --- |
| 정적 계약 검사 | 모델 호출 없이 prompt, agent definition, 권한, 산출물 계약을 확인한다. | 모든 변경 전후에 사용한다. |
| 직접 agent 계약 평가 | 대상 agent만 delegation-style input으로 실행해 고유 역할 계약을 평가한다. | agent 프롬프트 반복강화의 주 평가로 사용한다. |
| 오케스트레이션 통합 평가 | 실제 `orchestrator -> subagent` 체인을 제한적으로 실행한다. | 핵심 경로 smoke test와 위임 프롬프트 품질 확인에만 사용한다. |

직접 agent 계약 평가는 토큰 비용과 실패 원인 분리를 위해 필요하다. 단, 현행 실행 계약에서 `mode: "subagent"` agent는 일반 `opencode run --agent <name>`으로 직접 선택할 수 없다. 이 경우 CLI가 기본 agent로 fallback하면 대상 agent 평가가 아니다.

따라서 `subagent` 직접 평가는 `scripts/run-opencode --direct-subagent <agent> run ...` 같은 평가 전용 하네스가 아래 조건을 만족할 때만 수행한다.

- 평가 실행에서만 대상 agent를 직접 선택 가능하게 한다.
- 운영 agent definition의 mode 계약은 바꾸지 않는다.
- 권한 정책은 대상 agent의 원래 권한을 유지한다.
- 입력은 실제 orchestrator가 줄 법한 delegation-style input으로 구성한다.
- JSON event에서 fallback 경고, `tool_use`, token, 파일 변경 여부를 수집한다.

평가 하네스가 없거나 fallback이 감지되면 `subagent`는 orchestrator 경유 통합 평가로만 실행할 수 있다. 이 경우 결과에는 “target agent 단독 평가 아님”을 명시한다.

## 7. Anti-Cheating Rules

행동 평가는 치팅을 막아야 한다.

- 모델 입력에 fixture의 `expected behavior`나 `failure criteria`를 넣지 않는다.
- 평가 문서 전체를 첨부하지 않는다.
- 이전 실패 로그 전문이나 도구 출력 전문을 첨부하지 않는다.
- 프롬프트에 특정 fixture 문장, 정답 예시, 평가용 키워드를 그대로 넣지 않는다.
- 프롬프트 보강은 특정 케이스가 아니라 일반 규칙으로 작성한다.
- 사용자의 요청 문장만 넣고, 판정은 실행 후 `tool_use`, 반환, 파일 변경 여부를 기준으로 한다.
- 실제로 실행하지 않은 행동을 통과로 기록하지 않는다.
- 중간에 프롬프트가 바뀌면 이전 반복 성공 횟수를 이어 쓰지 않는다.
- 실패 분석과 재평가를 같은 누적 컨텍스트로 이어가면 해당 재평가는 무효로 기록한다.
- `subagent` 직접 실행을 시도했는데 기본 agent fallback이 발생하면 해당 run은 실패 또는 무효로 기록한다.

## 8. Prompt Compression Criteria

압축은 토큰을 줄이기 위해 역할 계약을 약화시키는 작업이 아니다. 같은 행동 안정성을 유지하면서 중복과 과적합을 줄이는 작업이다.

압축해도 되는 것:

- 긴 예시를 일반 규칙으로 바꾸기
- 반복된 금지 문구를 하나의 강한 경계 문장으로 합치기
- agent별 설명을 표로 압축하기
- fixture 전용 문장을 제거하기
- 같은 계약을 공통 prompt block에 이미 담고 있다면 agent prompt에서 중복 제거하기

압축하면 안 되는 것:

- agent의 고유 역할 경계
- 권한 정책과 직접 연결되는 금지 행동
- 산출물 소유권과 반환 형식
- 불확실성 처리 방식
- 사용자 지침 보존 규칙
- 실제 평가에서 실패했던 핵심 방어 규칙

압축 후에는 반드시 행동 평가를 다시 실행한다. 정적 길이 감소만으로 완료로 보지 않는다.

## 9. Failure Classification

실패는 아래 형식으로 기록한다.

```text
Failure:
- observed behavior:
- violated axis:
- expected contract:
- likely cause:
- prompt change:
- retest result:
```

예시:

```text
Failure:
- observed behavior: 첫 위임 전에 별도 진행 상태 도구를 만들었다.
- violated axis: 최소성, 실행 범위, 도구 사용 충실도
- expected contract: 필요한 경우 바로 task 위임으로 시작한다.
- likely cause: 상태 관리 금지 규칙이 압축 과정에서 약해졌다.
- prompt change: 첫 위임 전 별도 작업 목록/체크리스트/진행 상태 도구 금지 규칙 추가.
- retest result: 같은 유형 3회 반복 통과.
```

## 10. Result Recording

반복강화 결과는 다음 내용을 남긴다.

| Field | Required |
| --- | --- |
| Agent | 평가 대상 agent |
| Prompt version | 변경 전후 식별자 또는 파일 상태 |
| Model | 평가 모델 |
| Fixture type | 정상, 경계 위반, 모호성, 도구 지침, deep 요청, 산출물 계약 등 |
| Runs | 반복 실행 횟수 |
| Pass rate | 예: `3/3` |
| Execution mode | 정적 검사, 직접 agent 계약 평가, 오케스트레이션 통합 평가 중 무엇인지 |
| Tool evidence | 실제 `tool_use` 순서와 대상 |
| Delegation input evidence | 오케스트레이터 경유 평가에서 target agent에 전달된 실제 입력 |
| Token evidence | 가능하면 입력 토큰 또는 프롬프트 길이 변화 |
| Clean-run evidence | 실패 분석 컨텍스트와 분리된 새 run id/새 세션에서 실행했는지 |
| Fallback evidence | `--agent` 직접 실행 시 fallback이 없었는지 |
| Failures found | 발견한 실패와 보강 내용 |
| Verification | 타입 검사, 정적 검색, 프로세스 잔존 여부 등 |

## 11. Acceptance Criteria

반복강화와 압축은 다음 조건을 만족해야 한다.

- FDD와 권한 정책을 새로 해석하지 않고 따른다.
- 모든 변경은 공통 평가 축 중 하나 이상의 실패를 해결한다.
- fixture 정답을 프롬프트에 심지 않는다.
- 프롬프트 길이를 줄였더라도 핵심 행동 평가가 통과한다.
- 도구 사용이 중요한 축은 실제 `tool_use` 이벤트로 확인한다.
- 변경 후 관련 평가 유형을 최소 3회 반복 실행한다.
- 실패 후 재평가는 clean-run이어야 하며, 이전 실패 전문이 다음 평가 입력에 들어가면 완료로 인정하지 않는다.
- 정적 검증과 타입 검증이 필요한 변경이면 실제 명령 결과를 확인한다.
- 직접 agent 계약 평가라고 주장하려면 대상 agent fallback이 없어야 한다.

## 12. Relationship to Other Docs

- 전체 프롬프트 개선 절차는 `docs/specs/agent-prompt-improvement-and-testing-spec.md`를 따른다.
- Agent별 역할 값은 `docs/FDD/agent-*-role.md`를 따른다.
- 행동 fixture seed는 `docs/evals/agent-prompts/fixtures.md`를 따른다.

이 문서는 위 문서들을 대체하지 않고, 반복 실행과 프롬프트 압축의 공통 판정 기준만 정의한다.
