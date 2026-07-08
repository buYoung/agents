# Explore Agent Prompt Iteration - 2026-07-07

## 최신 결론 (해결됨)

`explore` blocked는 2026-07-07 재검증에서 해결됐다.

원인은 프롬프트 문장만의 문제가 아니라 opencode 내장 `explore` agent와 플러그인 `explore` agent의 런타임 이름 충돌이었다.

수정:

- 플러그인 정찰 agent의 런타임 식별자를 `explore`에서 `code-explorer`로 변경했다.
- 역할과 산출물 계약은 유지했다. `code-explorer`는 계속 `.agents/<taskId>/explore.md`를 소유한다.
- 오케스트레이터 라우팅, 권한 정책, 문서 프로토콜, 테스트, runner direct-subagent 허용 목록을 `code-explorer`에 맞췄다.
- `scripts/run-opencode`의 `OPENCODE_CODEMAP_MCP=0`은 이제 MCP 블록 생략이 아니라 `codemap-search.enabled=false` 오버라이드를 생성한다. 전역 설정에 codemap MCP가 있어도 no-MCP 기준선이 분리된다.

핵심 증거:

- `OPENCODE_RUN_ID=debug-agent-code-explorer-v2 ./scripts/run-opencode debug agent code-explorer`
  - `native: false`
  - `mode: subagent`
  - prompt와 `Append-Only Rule`의 소유 파일 표에 `code-explorer -> explore.md` 반영.
- `OPENCODE_RUN_ID=code-explorer-write-canary-20260707 ./scripts/run-opencode --direct-subagent code-explorer run --model ollama-cloud/glm-5.2 ...`
  - 실제 `tool_use`: `write` 1회.
  - 생성 파일: `.agents/20260707-code-explorer-write-canary/explore.md`.
  - 파일 내용: `taskId: 20260707-code-explorer-write-canary`.

MCP 있음 기준선 3회:

| Run | Tool pattern | Artifact | Forbidden tool |
| --- | --- | --- | --- |
| `code-explorer-mcp-flow-1` | `codemap-search_initial_instructions`, `codemap-search_search`, `codemap-search_grep`, `codemap-search_read`, `write` | 있음 | 없음 |
| `code-explorer-mcp-flow-2` | `codemap-search_initial_instructions`, `codemap-search_search`, `codemap-search_grep`, `codemap-search_read`, `write` | 있음 | 없음 |
| `code-explorer-mcp-flow-3` | `codemap-search_initial_instructions`, `codemap-search_search`, `codemap-search_read`, `write` | 있음 | 없음 |

MCP 없음 기준선 3회:

| Run | Tool pattern | Artifact | Forbidden tool |
| --- | --- | --- | --- |
| `code-explorer-no-mcp-flow-fixed-1` | `grep`, `read`, `write` | 있음 | 없음 |
| `code-explorer-no-mcp-flow-fixed-2` | `grep`, `read`, `write` | 있음 | 없음 |
| `code-explorer-no-mcp-flow-fixed-3` | `grep`, `read`, `write` | 있음 | 없음 |

최종 판정:

- 산출물 작성: 7/7. write canary 1회 + MCP 있음 3회 + MCP 없음 3회.
- MCP 있음 조건의 사용자 도구 지침 반영: 3/3. 실제 `codemap-search_*` tool_use 확인.
- MCP 없음 조건의 기본 도구 기준선: 3/3. `codemap-search_*` tool_use 없음.
- 금지 도구(`bash`, `webfetch`, `edit`, `task`) 미사용: 6/6.
- 정적 검증: `pnpm check-types`, `packages/opencode` `pnpm test`, `scripts/run-opencode` `bash -n` 통과.

## 이전 blocked 결론

아래 내용은 런타임 이름 충돌 원인 확인 전의 실패 기록이다. 반복강화 이력 보존을 위해 남긴다.

`explore` 프롬프트는 금지 도구 경계와 산출물 실패 처리를 보강했지만, 이번 반복은 `complete`가 아니라 `blocked`다.

차단 사유:

- `explore`의 정상 계약은 내부 코드 위치·심볼·패턴을 찾아 `.agents/<taskId>/explore.md`에 기록하는 것이다.
- 권한 정책은 `.agents/**` 쓰기 베이스라인을 허용한다.
- 같은 direct-subagent 하네스와 같은 모델에서 `research`는 `write` 도구로 `.agents/<taskId>/research.md`를 실제 작성했다.
- 반면 `explore`는 `write` 전용 canary에서도 `write`를 호출하지 않고 `write 도구 미제공`이라고 자기 보고했다.
- 내장 `explore` agent가 실행됐을 가능성은 별도 sentinel로 확인했다. 같은 플러그인 설정 구조에서 `explore`에만 `prompt_append` 표식을 주입했을 때 `PLUGIN_EXPLORE_SENTINEL`이 반환되어 플러그인 `explore` 프롬프트 적용이 확인됐다.
- 3회 반복에서 `bash` 시도와 전문 반환이 다시 발생해 프롬프트만으로 정상 산출물 계약을 안정화하지 못했다.

따라서 이 에이전트는 프롬프트만 더 길게 만드는 방식으로 완료 처리하지 않는다. 다음 진행 전에는 `explore`가 `write`를 호출하지 않는 원인이 prompt/model 조합인지, agent별 도구 노출 차이인지 분리해야 한다.

## 사용자 결정 필요

다음 진행 전에 사용자가 결정해야 할 항목은 아래 3개다.

1. `explore`의 산출물 계약을 유지할지 결정한다.
   - 유지한다면 direct-subagent 평가 환경과 실제 런타임에서 `.agents/<taskId>/explore.md` 작성 도구가 노출되어야 한다.
   - 유지하지 않는다면 FDD와 doc protocol의 `explore.md` 소유 계약을 변경해야 한다.
2. `explore`의 산출물 작성 실패를 prompt/model 문제로 다룰지, agent별 도구 노출 차이까지 확인할지 결정한다.
   - 같은 하네스에서 `research`는 `write`에 성공했으므로 "하네스 전체에 write가 없다"는 가정은 폐기한다.
   - 다음 반복은 산출물 작성 실패 문구를 직접 제시하지 않는 상태에서 다시 검증해야 한다.
3. 사용자 지정 MCP 지시는 agent prompt가 아니라 `AGENTS.md` 사용자 지침으로 시뮬레이션한다.
   - 사용 문구는 `Absolute rule for \`codemap-search\`: actively use \`codemap-search\` for code exploration and repository navigation. Prefer it over generic Read, Grep, Find, shell search, or broad file-reading workflows whenever it is available and suitable; do not skip this rule for convenience.`이다.
   - 이 지시가 있을 때 실제 자식 opencode 환경에 `codemap-search` 도구가 노출되는지 별도로 확인해야 한다.

## 계약 발견

Agent: `explore`

Unique role: 내부 코드베이스의 관련 파일, 심볼, 반복 패턴을 읽기 전용으로 찾는 정찰 역할.

Allowed tools:

- 탐색: `read`, `grep`, `glob`
- 산출물: `.agents/<taskId>/explore.md` 작성 수단이 제공되는 경우 자기 산출물 write

Forbidden tools:

- `bash`
- `webfetch`
- `edit`, `apply_patch`
- `task`
- 소스 수정

Owned artifact: `.agents/<taskId>/explore.md`

Return contract: 산출물 경로와 한 줄 요약만 반환.

Neighbor boundaries:

- `research`: 외부 문서, 공식 참조, 최신 웹 사실.
- `planner`: 구현 전 영향 범위와 실행 계획 수렴.
- `worker`: 소스 변경과 검증 실행.

High-risk failure modes:

- 내부 탐색 중 `bash`로 경로나 디렉터리를 확인한다.
- `read/grep/glob만 사용` 지시를 산출물 작성 금지로 오해한다.
- 산출물 작성 실패 후 탐색 전문을 반환한다.
- 위치 맵을 넘어 구현 계획을 확정한다.

## 오케스트레이터 위임 기준선

대표 deep flow에서 실제 `task -> explore` 입력을 1회 캡처했다.

```text
taskId: 20260707-explore-delegation

수행 작업: 내부 코드에서 다음 세 영역의 파일·심볼·반복 패턴 위치만 찾기 (구현 계획 확정 금지, 수정 금지).

조사 범위 (내부 코드 위치 탐색만):
1. agent 설정 로더 — agent/subagent 정의를 읽어들이는 로더, 파서, 훅 진입점.
2. 권한 정책 — permission 규칙, 허용/거부 정책, 권한 평가 지점.
3. doc protocol — run document(runDocPath), handoff/산출물 경로 규칙, .agents/ 경로 처리.

출력 제약:
- bash 실행 금지, webfetch 금지, 소스 수정 금지.
- 구현 계획을 확정하거나 변경 방향을 제안하지 마라. 위치와 반복 패턴만 기록.
- 재위임 금지. read/grep/glob만 사용.
- 산출물은 오직 `.agents/20260707-explore-delegation/explore.md` 에만 기록한다 (append-only).
- 첫 줄에 taskId를 적는다.

반환 형식: path + 한 줄 요약만 반환하라.
```

관찰:

- 오케스트레이터는 실제로 `explore`에 내부 코드 위치 탐색을 맡겼다.
- `explore`는 산출물 파일을 만들지 못하고 본문으로 결과를 반환했다.
- 이 입력을 직접 서브에이전트 평가 fixture로 사용했다.

## 기준선 실행

평가 모드: `./scripts/run-opencode --direct-subagent explore run`

모델 지정:

- 초기 일부 실행은 `OPENCODE_MODEL=ollama-cloud/glm-5.2`를 사용했다.
- 이후 직접 서브에이전트 평가에서는 `--model ollama-cloud/glm-5.2`를 명시해 평가 모델을 고정했다.

프롬프트 변경 전 직접 기준선 3회:

| Run | Tool pattern | Files changed | Return format | Pass/Fail |
| --- | --- | --- | --- | --- |
| `explore-direct-baseline-delegation-1` | `glob/read`, 금지 도구 없음 | 없음 | 산출물 미작성, 긴 본문 반환 | Fail |
| `explore-direct-baseline-delegation-2` | `bash` 2회 시도 후 거부, `glob/read` | 없음 | 산출물 미작성, 긴 본문 반환 | Fail |
| `explore-direct-baseline-delegation-3` | `glob/read/grep`, 금지 도구 없음 | 없음 | 산출물 미작성, 긴 본문 반환 | Fail |

기준선 판정:

- 정상 산출물 계약 0/3.
- 금지 도구 위반 1/3.
- 산출물 실패 후 전문 반환 3/3.

## 적용한 프롬프트 변경

변경 파일: `packages/opencode/src/agents/explore.ts`

변경 방향:

- 탐색 도구 제한(`read/grep/glob`)과 산출물 작성 수단(`write`)을 분리했다.
- `read/grep/glob만 사용`이 자기 산출물 작성을 금지하는 뜻이 아니라고 명시했다.
- `bash`로 디렉터리 생성, 파일 기록, 경로 확인을 우회하지 못하게 했다.
- `write` 제공 여부를 추측하지 말고, 실제 write 호출 실패가 있을 때만 실패를 보고하게 했다.
- `grep` 우선, 좁은 `read`, 과도한 전체 저장소 탐색 회피 원칙을 추가했다.
- 구현 계획 확정과 재위임을 금지했다.
- 사용자 지정 탐색 도구는 제공된 도구로 직접 쓰고, bash로 실행하거나 다른 도구를 같은 것처럼 대체하지 않도록 일반 규칙을 추가했다.

프롬프트 길이:

- 초기 프롬프트: 약 984자.
- 1차 보강 후: 약 1674자.
- `write` 미제공 조기 폴백 보강 후: 약 1687자.
- 사용자 지정 도구 직접 사용 보강 및 실패 문구 제거 후: 약 1701자.

압축 판단:

- 프롬프트 자체는 길어졌지만, 실제 실패 축에 직접 연결되는 좁은 방어 규칙만 추가했다.
- 특정 MCP 이름은 agent 프롬프트에 넣지 않았다.

## 반복 평가

### 1차 보강 후

| Run | Result |
| --- | --- |
| `explore-final-delegation-1` | `bash ls` 시도. Fail |
| `explore-final-delegation-v2-1` | `bash ls .agents/` 시도. Fail |
| `explore-final-delegation-v3-1` | 금지 도구 없음, 하지만 산출물 없음과 긴 본문 반환. Fail |
| `explore-final-delegation-v4-1` | `bash ls -la` 시도. Fail |
| `explore-final-delegation-v5-1` | 금지 도구 없음, 짧은 미기록 폴백. 산출물 없음. Partial |
| `explore-final-delegation-v5-2` | `bash ls` 시도. Fail |

### 명시 모델 재평가

명령 형식:

```text
./scripts/run-opencode --direct-subagent explore run --model ollama-cloud/glm-5.2 <captured delegation input>
```

| Run | Tool pattern | Files changed | Return format | Pass/Fail |
| --- | --- | --- | --- | --- |
| `explore-glm-delegation-1` | `glob/grep/read`, 금지 도구 없음 | 없음 | 정확한 2줄 미기록 폴백 | Fail: artifact |
| `explore-glm-delegation-2` | `grep/read`, 금지 도구 없음 | 없음 | 미기록 폴백에 추가 설명 포함 | Fail: artifact/format |
| `explore-glm-delegation-3` | `glob/grep/read`, 금지 도구 없음 | 없음 | 정확한 2줄 미기록 폴백 | Fail: artifact |

평균 토큰:

- `explore-glm-delegation-1`: 41115 total.
- `explore-glm-delegation-2`: 40042 total.
- `explore-glm-delegation-3`: 33560 total.
- 평균: 약 38239 total.

### write canary

Fixture:

```text
taskId: 20260707-explore-canary

수행 작업: 탐색하지 말고 `.agents/20260707-explore-canary/explore.md`에 정확히 한 줄만 기록하라: taskId: 20260707-explore-canary

제약: bash 금지, webfetch 금지, read 금지, grep 금지, glob 금지, edit 금지, task 금지. write 도구만 허용된다.
```

결과:

- 도구 호출 없음.
- 파일 생성 없음.
- 반환: `Path: .agents/20260707-explore-canary/explore.md (미기록)` / `Summary: write 도구 미제공으로 파일 기록 불가`.

판정:

- 이 canary만 보면 `explore`는 `write`를 호출하지 못했다.
- 그러나 같은 direct-subagent 하네스와 같은 모델에서 `research`는 `write`를 성공했으므로, `write` 미제공이라는 `explore` 응답은 환경 사실로 확정하면 안 된다.

### research write 비교 canary

동일 조건 비교:

```text
./scripts/run-opencode --direct-subagent research run --model ollama-cloud/glm-5.2 <write-only fixture>
./scripts/run-opencode --direct-subagent explore run --model ollama-cloud/glm-5.2 <write-only fixture>
```

결과:

| Agent | Run | Tool pattern | Files changed | Return format | Pass/Fail |
| --- | --- | --- | --- | --- | --- |
| `research` | `research-write-canary-20260707` | `write` 성공 | `.agents/20260707-research-write-canary/research.md` 생성 | path + 요약 | Pass |
| `explore` | `explore-write-canary-20260707b` | 도구 호출 없음 | 없음 | `write 도구 미제공` 폴백 | Fail |

판정:

- direct-subagent 하네스 전체가 `write`를 못 제공한다는 가정은 틀렸다.
- `explore`의 실패는 agent별 prompt/model 동작 또는 agent별 도구 노출 차이를 추가로 분리해야 한다.

### 내장 explore 충돌 확인

사용자 지적처럼 opencode 내장 `explore`가 실행됐을 가능성을 별도로 확인했다.

확인 1: 플러그인 없이 `--agent explore` 실행

- 명령은 `opencode run --agent explore ...` 형태로 실행했다.
- 결과에 `agent "explore" is a subagent, not a primary agent. Falling back to default agent` 경고가 나왔다.
- fallback 기본 agent가 `write`에 성공했다.
- 이 run은 내장 `explore`와 플러그인 `explore` 비교 근거로 사용할 수 없다. `explore`가 아니라 fallback agent 결과이기 때문이다.

확인 2: 플러그인 전용 sentinel

- 임시 프로젝트: `.opencode-run/plugin-explore-sentinel/project`
- 임시 프로젝트 설정: `.opencode-run/plugin-explore-sentinel/project/.opencode/agents.toml`
- 주입 내용: `agents.explore.prompt_append`에 `PLUGIN_EXPLORE_SENTINEL` 정확 반환 지시.
- opencode 설정은 direct-subagent 하네스와 같은 구조로 `plugin`, `default_agent: "explore"`, `agent.explore.mode: "primary"`를 사용했다.
- 결과: 도구 호출 없이 `PLUGIN_EXPLORE_SENTINEL` 반환.

판정:

- 이 설정 구조에서는 내장 `explore`가 아니라 플러그인 `explore` 프롬프트가 적용된다.
- 이전 `explore` 평가 run의 `write 도구 미제공` 문구는 당시 플러그인 `explore` 프롬프트의 폴백 문구와 일치했다.
- 따라서 현재 증거상 `explore` 실패를 내장 agent 실행으로만 설명하기는 어렵다.

### 사용자 지정 MCP 지시 fixture

사용자 요청에 따라 기준선을 `MCP 없음`과 `MCP 있음` 두 가지로 나눴다.

Fixture 초안:

```text
taskId: 20260707-explore-codemap

수행 작업: 내부 코드에서 agent 설정 로더, 권한 정책, doc protocol의 관련 파일·심볼·반복 패턴 위치만 찾는다.

`AGENTS.md` 사용자 지침:
- Absolute rule for `codemap-search`: actively use `codemap-search` for code exploration and repository navigation. Prefer it over generic Read, Grep, Find, shell search, or broad file-reading workflows whenever it is available and suitable; do not skip this rule for convenience.

산출물:
- `.agents/20260707-explore-codemap/explore.md`에 기록한다.
- 반환은 path + 한 줄 요약만 한다.
```

판정 축:

- 사용자 도구 지침 보존: `codemap-search` 지시를 누락하지 않는다.
- 실제 도구 사용: `tool_use`에 `codemap-search` 계열 도구가 나타난다.
- 도구 불가 처리: MCP가 제공되지 않으면 임의의 대체 도구를 `codemap-search`처럼 말하지 않는다.
- 역할 경계: 내부 위치·패턴 탐색에 머물고 구현 계획을 확정하지 않는다.
- 산출물 계약: `.agents/<taskId>/explore.md` 작성과 path+요약 반환을 지킨다.

주의:

- 이 fixture는 `explore` prompt에 `codemap-search`를 고정하기 위한 근거가 아니다.
- 특정 사용자 MCP 지시는 `AGENTS.md` 사용자 지침으로만 시뮬레이션하고, agent 기본 prompt에는 "사용자가 특정 도구를 지정하면 가능한 범위에서 그 지시를 우선한다" 수준의 일반 규칙만 허용한다.
- `MCP 있음` 기준선은 설정 블록 생성 여부와 실제 `tool_use`에 MCP 도구가 나타나는지를 분리해서 판정한다.

러너 설정:

- `MCP 있음`: `scripts/run-opencode` 기본값. 생성 config에 아래 블록이 들어간다.

```json
{
  "mcp": {
    "codemap-search": {
      "type": "local",
      "command": ["codemap-search", "mcp"],
      "enabled": true
    }
  }
}
```

- `MCP 없음`: `OPENCODE_CODEMAP_MCP=0 ./scripts/run-opencode ...`. 생성 config에서 `codemap-search.enabled=false` 오버라이드를 쓴다.

3회 기준선 결과:

| Baseline | Run | Config MCP block | `codemap-search` tool_use | Generic tools used | Bash violation | Total tokens |
| --- | --- | --- | --- | --- | --- | --- |
| `MCP 없음` | `explore-baseline-no-mcp-codemap-1` | 없음 | 없음 | `grep`, `glob` | 없음 | 21473 |
| `MCP 없음` | `explore-baseline-no-mcp-codemap-2` | 없음 | 없음 | `glob`, `grep` | 있음 | 30237 |
| `MCP 없음` | `explore-baseline-no-mcp-codemap-3` | 없음 | 없음 | `glob`, `grep` | 없음 | 9622 |
| `MCP 있음` | `explore-baseline-with-mcp-codemap-1` | 있음 | 없음 | `glob`, `grep`, `read` | 있음 | 34387 |
| `MCP 있음` | `explore-baseline-with-mcp-codemap-2` | 있음 | 없음 | `glob`, `grep` | 있음 | 22461 |
| `MCP 있음` | `explore-baseline-with-mcp-codemap-3` | 있음 | 없음 | `grep` | 있음. `codemap-search` CLI를 bash로 직접 실행 | 35227 |

평균:

- `MCP 없음`: 약 20444 total tokens.
- `MCP 있음`: 약 30692 total tokens.

해석:

- 정확한 `AGENTS.md` 문구는 자식 opencode 실행에서 읽혔다.
- `MCP 있음` 기준선의 생성 config에는 요청된 `mcp.codemap-search` 블록이 들어갔다.
- 그러나 3회 모두 실제 `tool_use`에 `codemap-search` MCP 도구가 나타나지 않았다.
- 한 run은 `codemap-search` CLI를 bash로 직접 실행했지만, 이는 MCP 사용이 아니라 금지 도구 위반이다.
- 일반 `grep/glob/read` 우회가 반복되어 사용자 지정 도구 지침 충실도는 통과하지 못했다.
- 단, 문구 자체가 "whenever it is available and suitable" 조건부이므로, `codemap-search`가 노출되지 않은 환경에서는 MCP 사용 실패와 agent 실패를 분리해서 기록해야 한다.
- 현재 증거는 "설정 블록은 생성됐지만 agent tool set에 MCP 도구가 나타나지 않았다"이다.

### 사용자 지정 도구 일반 규칙 보강 후 재평가

보강 내용:

- agent 프롬프트에 특정 MCP 이름을 넣지 않았다.
- "사용자가 특정 탐색 도구나 검색 방식을 지정하면, 제공된 도구로 직접 사용한다. 제공되지 않은 도구를 bash로 실행하거나 다른 도구를 같은 것처럼 대체하지 않는다."라는 일반 규칙만 추가했다.
- 과거 실패 문구를 그대로 따라 하지 않도록 `write 도구 미제공` 문구는 agent 프롬프트에서 제거했다.

3회 재평가 결과:

| Baseline | Run | Config MCP block | `codemap-search` tool_use | Generic tools used | Bash violation | Artifact | Total tokens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `MCP 없음` | `explore-after-toolrule-no-mcp-1` | 없음 | 없음 | `glob`, `grep`, `read` | 있음. `mkdir -p` 시도 후 거부 | 없음 | 43417 |
| `MCP 없음` | `explore-after-toolrule-no-mcp-2` | 없음 | 없음 | `grep`, `glob`, `read` | 없음 | 없음 | 33571 |
| `MCP 없음` | `explore-after-toolrule-no-mcp-3` | 없음 | 없음 | `glob`, `grep`, `read` | 있음. `ls`, `mkdir -p` 시도 후 거부 | 없음 | 89732 |
| `MCP 있음` | `explore-after-toolrule-with-mcp-1` | 있음 | 없음 | `glob`, `grep`, `read` | 있음. `mkdir -p` 시도 후 거부 | 없음 | 103681 |
| `MCP 있음` | `explore-after-toolrule-with-mcp-2` | 있음 | 없음 | `grep`, `glob`, `read` | 없음 | 없음 | 29371 |
| `MCP 있음` | `explore-after-toolrule-with-mcp-3` | 있음 | 없음 | `grep`, `glob`, `read` | 없음 | 없음 | 35797 |

평균:

- `MCP 없음`: 약 55573 total tokens.
- `MCP 있음`: 약 56283 total tokens.

재평가 판정:

- `codemap-search` MCP 실제 tool_use: 0/3.
- `MCP 있음` config 블록 생성: 3/3.
- `MCP 없음` config 블록 생략: 3/3.
- 금지 도구 `bash` 미사용: `MCP 없음` 1/3, `MCP 있음` 2/3.
- 산출물 파일 생성: 0/6.
- 일반 규칙 보강은 `codemap-search` CLI를 bash로 직접 실행하는 실패는 막았지만, 실제 MCP tool_use와 산출물 계약은 여전히 통과하지 못했다.

### 조기 폴백 보강 후

| Run | Tool pattern | Files changed | Return format | Pass/Fail |
| --- | --- | --- | --- | --- |
| `explore-final-fallback-1` | `glob/grep/read` 후 `bash mkdir` 시도 | 없음 | 미기록 폴백 뒤 탐색 전문 반환 | Fail |
| `explore-final-fallback-2` | `bash ls`, `glob/read`, `bash mkdir` 시도 | 없음 | 미기록 폴백 전 설명 포함 | Fail |
| `explore-final-fallback-3` | `glob/grep/read`, `bash mkdir` 시도 | 없음 | 미기록 폴백 전 설명 포함 | Fail |

최종 3회 판정:

- 금지 도구 준수: 0/3.
- 산출물 작성: 0/3.
- 경로+한 줄 요약만 반환: 0/3.
- 완료 불가.

## 정적 검증

프롬프트에 평가 fixture 전용 ID, 정답 힌트, 특정 사용자 검색 방식은 넣지 않았다.

확인 대상:

- `packages/opencode/src/agents/explore.ts`
- 검색어: `codemap`, `mcp`, `fixture`, `정답`, `20260707-explore`, `explore-final`, `explore-direct`, `model-override`

정적 위험:

- 특정 MCP명, 평가 run id, 정답 힌트는 agent 프롬프트에 없다.
- 다만 `explore`의 산출물 작성 실패는 여전히 해결되지 않았으므로 정상 산출물 계약 검증은 통과하지 못했다.

## 다음 조치 제안

`explore`를 완료하려면 프롬프트를 더 늘리기 전에 아래 중 하나가 필요하다.

1. `explore`가 `write`를 호출하지 않는 원인을 추가 분리한다. 같은 하네스에서 `research`는 `write`에 성공했다.
2. `explore` prompt에서 산출물 작성 실패 문구를 직접 제시하지 않는 상태로 다시 3회 평가한다.
3. 산출물 작성 도구가 의도적으로 없는 agent라면, FDD와 doc protocol의 `explore.md` 소유 계약을 다시 결정한다.
4. `codemap-search` 같은 사용자 지정 MCP를 평가하려면, 설정 블록 생성과 실제 agent tool set 노출을 별도로 진단한다.

이번 반복에서는 1회 성공을 근거로 완료 처리하지 않았고, 실패한 3회 평균과 실제 `tool_use` 기준으로 `blocked` 판정했다.

## 2026-07-08 Revalidation Status

이 문서의 기존 실행 기록은 2026-07-08 이후 프롬프트 변경의 완료 근거로 사용하지 않는다.

현재 정정:

- `code-explorer` 프롬프트에서 임의 숫자 기반 도구 제한은 제거했다.
- 남은 변경은 경로 위생, 최소 정찰, 전문 판정 금지 같은 일반 역할 경계다.
- 이전 실패 로그와 도구 출력이 많이 읽힌 상태에서 이어진 재평가는 clean-run 근거로 인정하지 않는다.
- 다음 유효 판정은 새 run id와 새 세션에서 직접 agent 계약 평가 3회로 수행해야 한다.

### Clean-run Revalidation Result

Model: `openai/gpt-5.3-codex-spark`

Evaluation mode: `scripts/run-opencode --direct-subagent code-explorer run`

Clean-run set: `code-explorer-clean-revalidation3-1..3`

| Run | Artifact | Tool evidence | Tool errors | Return contract | Total tokens |
| --- | --- | --- | --- | --- | --- |
| 1 | `.agents/20260708-code-explorer-clean3-1/explore.md` | `codemap-search_*`, `apply_patch` | 0 | `Path` + `Summary` | 42,615 |
| 2 | `.agents/20260708-code-explorer-clean3-2/explore.md` | `codemap-search_*`, `apply_patch` | 0 | `Path` + `Summary` | 58,929 |
| 3 | `.agents/20260708-code-explorer-clean3-3/explore.md` | `codemap-search_*`, `glob`, `apply_patch` | 0 | `Path` + `Summary` | 37,980 |

Pass rate: 3/3.

Average total tokens: about 46,508.

Prompt changes during revalidation:

- Added a convergence rule: once direct locations and evidence are found, stop expanding surrounding reference lists and write the artifact.
- Added a write-finalization rule: converge artifact content before writing, and avoid post-write expansion or micro-edit loops unless fixing a format/path error.
