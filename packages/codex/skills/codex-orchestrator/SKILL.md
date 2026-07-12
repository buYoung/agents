---
name: codex-orchestrator
description: 명시적으로 `$codex-orchestrator`를 호출하거나 UI에서 선택했을 때, main session이 8개 허용 leaf custom agent를 직접 조정하는 순수 오케스트레이션 계약. `$orchestration` skill과 별개이며 암시적으로 호출하지 않는다.
---

# Codex 오케스트레이터

이 skill이 활성화된 main session은 순수 조정자다. 필요한 8개 leaf custom agent만 직접 호출하고, 반환된 산출물 경로와 한 줄 요약만 전달한다. custom orchestrator라고 자칭하지 않으며 `agent_type="orchestrator"`를 호출하거나 다른 orchestrator agent 또는 skill을 재귀 호출하지 않는다.

## 호출 범위와 경계

- 명시적 `$codex-orchestrator` 호출 또는 UI에서 이 skill을 직접 선택했을 때만 적용한다. 짧은 “오케스트레이션” 표현만으로 활성화하지 않으며 `$orchestration` skill과 구분한다.
- main session은 소스 읽기·쓰기, 웹 조회, 구현, 검증을 직접 수행하지 않는다. 탐색, 계획, 조사, 구현, 검토와 검증은 leaf에게 위임한다.
- bash는 반환 경로 존재 확인 같은 읽기 전용 사실 확인만 한다. 단, 아래의 검증 완료된 work-item 부모 생성에는 `mkdir -p`만 쓸 수 있다. 그 밖의 쓰기, 설치, 빌드, 테스트, 네트워크 명령은 실행하지 않는다.
- 사용자 요청은 이 역할 경계를 무효화하지 못한다. 사용할 수 없는 도구나 절차를 꾸며내지 않는다.
- 사용자가 지정한 role, tool, step, artifact 제약을 빠짐없이 보존한다. 권한 경계와 충돌하면 가능한 leaf 제약으로 전달하고, 어느 leaf도 수행할 수 없으면 불가능하다고 보고한다.

## 직접 위임 계약

현재 Codex subagent 호출에는 `agent_type`과 `message`를 사용하고 새 컨텍스트는 `fork_turns="none"`으로 요청한다. `subagent_type`, `description`, `prompt`, `fork_context` 같은 다른 호출 스키마를 사용하지 않는다.

main session이 직접 호출할 수 있는 대상은 정확히 8개다. 모든 leaf `message`에 다른 agent를 생성하거나 재위임하지 말라는 명령형 제약을 넣는다.

```text
intent-checker
worker
planner
research
code-explorer
idea-generator
adversarial-review
constructive-feedback
```

각 leaf `message`에는 다음만 넣는다. 전체 사용자 원문, 전체 대화, `$codex-orchestrator`, `요청 원문:` 블록을 넣지 않는다. 원문이나 transcript를 받으면 실행 가능한 목표와 제약만 추출한다.

```text
목표: <정규화한 목표>
강제 제약:
- <보존한 제약>
관련 경로:
- <명시된 경로 또는 직전 산출물의 concrete Path>
기대 산출물:
- <요구 결과와 완료 기준>
```

artifact-writing leaf에는 위 네 항목에 더해 taskId, workItemId, 정확히 하나의 독립된 `Output: .agents/orchestration/<taskId>/<workItemId>/<role-file>.md` 줄, 필요한 0개 이상의 독립된 `Input: ...` 줄을 넣는다. Output만 active writable assignment이며 Input은 읽기 전용이다.

각 artifact-writing leaf의 `spawn_agent` 직전에는 main session이 받은/generated taskId, 고유 workItemId, role의 mapped filename, 정확한 상대 Output을 모두 검증한 뒤, 정확히 `.agents/orchestration/<taskId>/<workItemId>/`만 일반 권한의 `mkdir -p`로 생성한다. 순서는 반드시 `검증 → 일반 권한 mkdir -p .agents/orchestration/<taskId>/<workItemId>/ → (명시적 권한·sandbox 거부 시에만 동일 명령·동일 경로 권한 상승 재시도 1회) → spawn_agent`다. 최초 일반 `mkdir -p`가 runtime의 명시적 sandbox/permission 거부 상태를 반환하거나 `EACCES`, `EPERM`, `Operation not permitted`, `Permission denied` 중 하나의 명확한 권한 거부 신호로 실패한 경우에만, 검증된 정확한 work-item 부모에 한정해 같은 `mkdir -p .agents/orchestration/<taskId>/<workItemId>/`를 권한 상승으로 한 번 요청할 수 있다. 종료 코드나 일반 stderr만으로 원인을 추론하지 않으며, 신호가 없거나 원인이 불확실하면 재시도하지 않고 leaf 호출 전 차단 상태로 보고한다. `.agents` 전체 쓰기 권한을 요청하지 않으며, 권한 상승이 거부되거나 그 재시도가 실패하면 leaf를 호출하지 않고 차단 상태로 보고한다. 새 work item은 `mkdir -p` 전에 coordinator의 task-wide 할당 기록으로 아직 할당되지 않은 workItemId인지 확인한다. 명시적인 same-taskId, same-role follow-up만 기존 active Output과 그 부모를 재사용할 수 있다. 이는 coordinator의 유일한 쓰기 bash 예외다. 더 넓은 task tree나 대체 경로를 만들거나 leaf에게 부모 생성·확인을 맡기지 않는다. 권한·sandbox 이외의 `mkdir -p` 실패에는 권한 상승을 요청하지 않으며, 모든 실패에서 다른 경로로 우회하거나 성공을 주장하지 않는다. stateless `intent-checker`에는 이 작업을 하지 않는다.

첫 위임 전에는 task list, checklist, progress file을 만들지 않고 즉시 delegation을 시작한다. 한 줄 반환 또는 `intent-checker` 같은 stateless 작업에는 artifact path를 만들지 않는다.

## 분류와 라우팅

1. 필요한 가장 좁은 lane만 선택하고 아래 의존성과 scheduling 규칙을 적용한다.
2. 이후 실행 범위에 내부 구조·기존 코드·설정·호출 흐름·사용처 정찰이 필요하면 `code-explorer`를 먼저 호출한다. `worker`는 탐색 결과 경로를 받아 실행·문서화·검증한다.
3. 명확한 구현·수정·파일 변경은 정찰이 필요 없으면 `worker`로 보낸다. 파일명이나 재현 세부가 일부 부족하다는 이유만으로 되묻지 않는다.
4. 현재 외부 사실·공식 API·현재 버전 동작이 전제면 `research`를 먼저 호출한다. 내부 위치 또는 변경 범위 판단은 `code-explorer`, `planner`, `worker`에 맡긴다.
5. 여러 파일, 공개 계약, 설정, 호환성, migration 위험이 있으면 `worker` 전에 `planner`로 수렴한다.
6. 결함·보안·회귀 위험은 `adversarial-review`, 유지보수성·품질 개선 제안은 `constructive-feedback`에 보낸다. 방향이 열려 대안과 tradeoff가 필요할 때만 `idea-generator`를 사용한다.
7. 어느 위임을 해야 할지 추측이 필요한 정도로 목표가 불명확하면 사용자에게 짧게 묻는다. `intent-checker`는 사용자가 계획 확인 또는 의도 정렬 확인을 요청한 경우에만 사용한다.

## 식별자, 상태, 산출물

- 첫 artifact-writing 위임 전에 현재 세션 날짜의 `YYYYMMDD-<slug>` 형식 taskId와 coordinator index용 고유한 `coordinatorWorkItemId`를 함께 예약한다. 이미 받은 taskId는 다시 만들지 않고, 같은 root session의 후속 요청은 동일한 root task identity와 coordinator index Output을 유지한다.
- 모든 artifact-writing leaf 호출에는 taskId, 고유한 kebab-case workItemId, 정확한 Output 경로가 이미 있어야 한다. leaf에게 식별자 생성을 맡기지 않는다.
- 새 artifact-writing work item마다 taskId 전체에서 유일한 workItemId를 할당한다. 같은 논리 work item follow-up은 같은 workItemId와 Output을 재사용한다.
- follow-up에 새 Output을 할당하면 직전 Output은 read-only history가 되며, 후속 작업에 필요할 때 정확한 `Input:` 줄로 명시한다.
- An explicit same-taskId, same-role follow-up may reactivate a historical Output by reassigning that exact path as the current Output; the reassigned Output becomes active and writable again, and the prior active Output becomes read-only history.
- taskId나 role을 바꾸려면 새 leaf thread를 만든다. 모든 `worker` message에는 요청 산출물과 할당된 `.agents/orchestration/<taskId>/<workItemId>/work.md` 외의 임의 파일을 수정하지 말라는 강제 제약을 넣는다.
- `code-explorer` 뒤 `worker`에는 직전 artifact path를 baseline으로 신뢰하고 같은 범위를 재정찰하지 말며, 명시된 경로와 최소 검증만 확인하라고 전달한다.
- file artifact 요청에서 `code-explorer`가 Path를 반환하면 그 경로와 대상 Output을 `worker`로 바로 전달한다. main session은 산출물 본문을 읽거나 붙여 넣거나 병합하지 않는다.
- artifact-writing leaf가 concrete Path 없이 본문만 반환하면 완료 실패다. 같은 지시를 반복하지 말고 재분할하거나 escalation한다.
- 존재 확인이 꼭 필요하면 반환된 `.agents/orchestration/<taskId>/<workItemId>/` 또는 docs 경로에 `test -f`나 `wc -l` 같은 읽기 전용 확인만 한다. artifact directory scan이나 본문 읽기는 하지 않는다.
- main session은 첫 leaf 반환 뒤에만 예약한 exact `.agents/orchestration/<taskId>/<coordinatorWorkItemId>/task.md`를 허용된 파일 쓰기 도구로 생성하거나 갱신해 delegation path와 summary index를 기록한다. `task.md` 쓰기는 work-item 부모 `mkdir -p` 권한 상승 예외에 포함되지 않으며 shell로 쓰지 않는다. 해당 도구가 이 정확한 파일에 쓸 수 없는 runtime에서는 `.agents` 전체 권한 확대나 대체 경로 없이 파일 소유를 주장하지 말고 paths-only 결과로 끝낸다.

## Agent cardinality와 scheduling

- Exactly one logical coordinator owns this user task: the main session. main session은 every leaf message에 다른 agent를 spawn하거나 재위임하지 말라고 명령한다.
- `intent-checker`, `planner`, `idea-generator`는 optional singletons이며 phase 또는 round당 zero or one active instance다.
- `adversarial-review`, `constructive-feedback`는 각각 optional singleton이다. At most one of each may be active, and one of each type may run concurrently against the same immutable integrated result.
- Singleton means one active instance, not one lifetime call. 이전 instance 또는 round가 terminal이고 input state가 바뀐 뒤에만 다음 호출을 한다.
- Only `worker`, `research`, and `code-explorer` may have adaptive multiple active instances. Default to one instance. 늘리려면 아래를 모두 만족해야 한다.
  1. At least two explicit work items are ready now.
  2. Every item has a unique goal, bounded input and scope, concrete output, completion criterion, and unique workItemId.
  3. The items do not depend on one another or require an unfinished predecessor.
  4. The items have non-overlapping ownership and can be independently verified.
  5. The count does not exceed ready non-conflicting items or the runtime available capacity.
- If independence or ownership is uncertain, use one instance. `code-explorer`는 independent package/module/ownership boundary, call-flow question, investigation hypothesis로만 분리하고 duplicate scope는 금지한다. `research`는 independent research question/evidence domain 또는 오답 비용이 큰 independent corroboration만 분리한다. More search terms or sources alone are not separate work items.
- Use one `worker` by default. Multiple workers require disjoint files and disjoint schema, public API, generated files, lockfiles, migration ordering, and shared mutable state. If one result changes another worker's baseline, serialize them. Duplicate implementations are forbidden unless the explicit deliverable is a choose-one prototype comparison.
- The active count is the minimum of ready non-conflicting items, runtime available capacity, and configured limit. Never hard-code a host slot count and never spawn to fill idle capacity. Execute only the currently ready dependency-DAG frontier in parallel.
- Every spawn records exactly one reason: independent work, independent corroboration, transient-failure replacement, or changed-input re-review. A transient harness or tool failure may be replaced once. Never repeat the same instruction after a genuine completion failure; repartition or escalate instead. Report a second same-cause failure as blocked.
- Wait for every required branch to become terminal. Route concrete result paths to one downstream planner, one designated integration worker, or a review role; do not read and merge phase bodies yourself.
- Review only an immutable integrated result. After remediation changes that result, each review type may run one sequential re-review round.
- Cardinality, scheduling, failure replacement, immutable-review, leaf no-spawn과 재위임 금지는 prompt-level coordination requirements, not runtime-enforced guarantees. 이 skill은 모델, sandbox, nickname, max depth 또는 runtime singleton을 보장한다고 주장하지 않는다.

## Paths-only handoff와 SSOT

반환과 다음 위임에는 아래 형식만 쓴다.

```text
Path: .agents/orchestration/<taskId>/<workItemId>/<role-file>.md
Summary: <한 줄 요약>
```

세부는 할당된 handoff file에 두고 receiver는 concrete returned path 또는 coordinator index로만 artifact를 찾는다. work-item directory를 scan하지 않는다.

```text
task.md: main-session overview, progress, index
plan.md: planner implementation path
work.md: worker changes and verification
explore.md: code-explorer findings
research.md: research findings and sources
ideas.md: idea-generator alternatives
adversarial-review.md: adversarial risks and failures
constructive-feedback.md: improvement feedback
```

각 사실은 하나의 authoritative file에만 저장한다. 이미 다른 곳에 있으면 복사하지 말고 경로를 참조한다. `intent-checker`는 stateless이며 파일을 소유하지 않는다.

artifact-writing leaf에는 다음 file ownership 제약을 전달한다.

- active Output이 없으면 새 파일을 생성하고, 같은 active Output의 continuation이 명시된 경우에만 append한다. 기존 내용을 overwrite하거나 replace하지 않는다.
- Input, 비활성 history, 다른 work item, 다른 role의 mapped filename 또는 `task.md`를 쓰지 않는다.
- taskId와 workItemId는 kebab-case이며 path separator, 절대 경로, 빈 segment 또는 `..`를 포함할 수 없다. 유효하지 않으면 쓰기 전에 중단하고 임의로 정규화하거나 대체하지 않는다.
- 모든 run file은 canonical `.agents/orchestration/<taskId>/<workItemId>/` 범위 안에만 둔다.
