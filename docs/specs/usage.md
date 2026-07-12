# 사용법

이 문서는 이 저장소를 사용하는 세 가지 표면을 정리한다.

- `agents` CLI로 opencode 플러그인 설정을 설치, 검증, 갱신한다.
- Codex 사용자 정의 에이전트를 설치하고 `agent_type` 계약으로 사용한다.
- opencode 플러그인으로 제공되는 에이전트를 opencode 설정에 연결해 사용한다.

근거 파일은 `apps/cli/src/cli.ts`, `apps/cli/src/commands/install.ts`, `apps/cli/src/commands/update.ts`, `apps/cli/src/paths.ts`, `packages/opencode/agents.example.toml`, `packages/opencode/src/index.ts`, `packages/opencode/src/plugin-hooks.ts`, `packages/opencode/src/core/config/load.ts`, `packages/opencode/src/core/doc-protocol/`, `packages/codex/agents/*.toml`이다.

## 1. CLI 사용

### 1.1 개발 중 CLI 실행

저장소 루트에서 의존성을 설치한다.

```sh
pnpm install
```

개발 중에는 `apps/cli` 패키지의 `agents` 실행 파일을 `pnpm --filter cli exec ./bin/agents`로 실행한다.

```sh
pnpm --filter cli exec ./bin/agents --help
```

공식 명령 표면은 다음 형식이다.

```sh
agents <install|uninstall|validate|doctor|update|upgrade> [options]
```

### 1.2 프로젝트 범위 설치

현재 프로젝트에 플러그인 설정을 설치한다.

```sh
pnpm --filter cli exec ./bin/agents install --scope project
```

프로젝트 범위 설치는 다음 파일을 대상으로 한다.

| 파일 | 역할 |
| --- | --- |
| `.opencode/agents.toml` | 에이전트별 모델, 추론 노력, 추가 프롬프트, 활성화 여부를 설정한다. |
| `.opencode/agents.install.json` | CLI가 설치 시 추가한 항목을 추적한다. |
| `opencode.json` | opencode native 설정이며, `plugin` 배열에 `agents`를 추가하고 provider 설정을 병합한다. |

다른 프로젝트 경로에 설치하려면 `--project`를 함께 쓴다.

```sh
pnpm --filter cli exec ./bin/agents install --scope project --project ../target-project
```

### 1.3 사용자 범위 설치

사용자 opencode 설정 디렉터리에 설치하려면 다음 명령을 사용한다.

```sh
pnpm --filter cli exec ./bin/agents install --scope user
```

사용자 범위 설정 경로는 환경 변수에 따라 달라진다.

| 조건 | 경로 |
| --- | --- |
| `OPENCODE_CONFIG_DIR` 지정 | `$OPENCODE_CONFIG_DIR/agents.toml`, `$OPENCODE_CONFIG_DIR/opencode.json` |
| `XDG_CONFIG_HOME` 지정 | `$XDG_CONFIG_HOME/opencode/agents.toml`, `$XDG_CONFIG_HOME/opencode/opencode.json` |
| 둘 다 없음 | `~/.config/opencode/agents.toml`, `~/.config/opencode/opencode.json` |

예시:

```sh
OPENCODE_CONFIG_DIR="$HOME/.config/opencode" pnpm --filter cli exec ./bin/agents install --scope user
```

### 1.4 설정 검증과 진단

설치 후에는 설정 파일을 검증한다.

```sh
pnpm --filter cli exec ./bin/agents validate
pnpm --filter cli exec ./bin/agents doctor
```

`validate`는 `agents.toml`의 모델, 추론 노력, 보호 에이전트 설정을 확인한다. `doctor`는 catalog, 설정 파일, 환경 변수, 런타임 주입 준비 상태를 진단한다.

### 1.5 갱신과 업그레이드

catalog와 Codex 사용자 정의 에이전트 artifact를 갱신한다.

```sh
pnpm --filter cli exec ./bin/agents update
```

`update`는 release manifest의 catalog artifact를 검증한 뒤 `.opencode` 관리 catalog에 쓰고, manifest에 Codex 에이전트 artifact가 있으면 `$CODEX_HOME/agents` 또는 `~/.codex/agents`에 `.toml` 파일을 적용한다.

CLI 자체 artifact를 갱신하려면 `upgrade`를 사용한다.

```sh
pnpm --filter cli exec ./bin/agents upgrade
```

release manifest 위치를 바꾸려면 `AGENTS_RELEASE_URL`을 지정한다.

```sh
AGENTS_RELEASE_URL="https://example.com/latest.json" pnpm --filter cli exec ./bin/agents update
```

### 1.6 설정 예시

`install --scope project`가 만든 `.opencode/agents.toml`을 열어 필요한 에이전트만 조정한다.

```toml
preset = "performance"

[agents.orchestrator]
model = "ollama-cloud/glm-5.2"
reasoning_effort = "max"

[agents.worker]
reasoning_effort = "high"

[agents.code-explorer]
prompt_append = """
탐색 결과는 파일 경로와 줄 번호를 먼저 보여준다.
"""

[agents.idea-generator]
enable = false
```

설정 규칙은 다음과 같다.

| 항목 | 동작 |
| --- | --- |
| 사용자 범위와 프로젝트 범위가 함께 있으면 | 사용자 범위를 먼저 읽고 프로젝트 범위를 나중에 병합하므로 프로젝트 설정이 우선한다. |
| `AGENTS_PRESET`이 있으면 | `agents.toml`의 `preset` 값을 덮어쓴다. |
| `preset`과 root `[agents.*]`가 함께 있으면 | preset 값을 먼저 적용하고 root `[agents.*]` 값을 우선 병합한다. |
| catalog에 없는 모델이면 | `validate` 또는 `doctor`에서 오류로 보고된다. |
| 모델이 지원하지 않는 `reasoning_effort`이면 | 경고 후 무시된다. |

## 2. Codex 사용자 정의 에이전트 사용

### 2.1 설치 위치

Codex 사용자 정의 에이전트 원본은 이 저장소의 `packages/codex/agents/*.toml`에 있다. CLI가 release manifest에서 Codex 에이전트 artifact를 받으면 다음 위치에 설치한다.

| 환경 | 설치 경로 |
| --- | --- |
| `CODEX_HOME` 지정 | `$CODEX_HOME/agents/<agent-name>.toml` |
| `CODEX_HOME` 없음 | `~/.codex/agents/<agent-name>.toml` |

설치 또는 갱신 예시:

```sh
pnpm --filter cli exec ./bin/agents update
```

적용 후 Codex 세션을 새로 시작해 사용자 정의 에이전트 정의를 다시 읽게 한다.

### 2.2 사용 가능한 에이전트

Codex 번들은 다음 사용자 정의 에이전트를 제공한다.

| `agent_type` | 용도 |
| --- | --- |
| `orchestrator` | 요청을 분류하고 가장 좁은 하위 에이전트 체인으로 위임한다. |
| `intent-checker` | 계획과 사용자 의도의 일치 여부를 확인한다. |
| `worker` | 확정된 구현, 문서 작성, 검증을 수행한다. |
| `planner` | 구현 전 영향 범위와 순서를 수렴한다. |
| `research` | 외부 문서와 최신 사실을 조사한다. |
| `code-explorer` | 저장소 구조와 코드 위치를 읽기 전용으로 정찰한다. |
| `idea-generator` | 여러 접근 대안과 트레이드오프를 제시한다. |
| `adversarial-review` | 결함, 반례, 회귀, 보안 위험을 검토한다. |
| `constructive-feedback` | 가독성, 유지보수성, 일관성 개선점을 제안한다. |

### 2.3 orchestrator 사용 예시

Codex에서 오케스트레이션이 필요한 작업은 `orchestrator`에 보낸다. 메시지는 원문 전체가 아니라 목표, 제약, 관련 경로, 기대 산출물만 담는다.

```text
agent_type = "orchestrator"
message = """
Goal: docs/specs/usage.md 사용법 문서를 갱신한다.
Constraints: 기존 정찰 산출물 .agents/20260709-usage-docs/explore.md를 기준으로 삼고, 새 문서와 README 링크만 수정한다.
Deliverables: docs/specs/usage.md, .agents/20260709-usage-docs/work.md
"""
```

`orchestrator`는 직접 소스 코드를 읽거나 쓰지 않고, 필요한 경우 `code-explorer`, `planner`, `worker`, `research`, `adversarial-review`, `constructive-feedback`, `idea-generator`, `intent-checker` 중 하나로 위임한다.

### 2.4 leaf agent 사용 예시

범위가 이미 좁으면 leaf agent를 직접 사용할 수 있다.

```text
agent_type = "code-explorer"
message = """
taskId: 20260709-cli-install-flow
Goal: apps/cli의 install 명령이 어떤 파일을 생성하거나 갱신하는지 읽기 전용으로 정찰한다.
Scope: apps/cli/src/commands/install.ts, apps/cli/src/paths.ts, apps/cli/src/native-config.ts
Output: .agents/20260709-cli-install-flow/explore.md
"""
```

```text
agent_type = "worker"
message = """
taskId: 20260709-usage-docs
Goal: docs/specs/usage.md 문서를 작성한다.
Input artifact: .agents/20260709-usage-docs/explore.md
Allowed changes: docs/specs/usage.md and .agents/20260709-usage-docs/work.md only.
Verification: 문서 링크와 명령 예시를 최소 범위로 확인한다.
"""
```

문서형 에이전트는 `.agents/<taskId>/<filename>` 규칙을 따른다. 예를 들어 `planner`는 `.agents/<taskId>/plan.md`, `worker`는 `.agents/<taskId>/work.md`, `code-explorer`는 `.agents/<taskId>/explore.md`를 쓴다. `intent-checker`는 상태 없는 확인 역할이므로 파일을 쓰지 않는다.

## 3. opencode 플러그인과 에이전트 사용

### 3.1 플러그인 연결

이 저장소의 opencode 플러그인 패키지는 `packages/opencode`이며 패키지 이름은 `opencode`이다. 프로젝트 범위 설치 명령은 `opencode.json`의 `plugin` 배열에 `agents` 항목을 추가하고, catalog 기반 provider 설정을 병합한다.

```sh
pnpm --filter cli exec ./bin/agents install --scope project
pnpm --filter cli exec ./bin/agents validate
pnpm --filter cli exec ./bin/agents doctor
```

설치 후 opencode를 재시작해 native 설정과 플러그인 훅을 다시 읽게 한다.

설치 결과로 기대하는 native 설정의 핵심 형태는 다음과 같다.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["agents"],
  "provider": {
    "ollama-cloud": {
      // catalog에서 생성된 provider 설정
    }
  }
}
```

기존 `plugin`이나 `provider` 설정이 있으면 CLI는 가능한 범위에서 기존 값을 보존하고 필요한 항목만 추가한다.

### 3.2 플러그인이 제공하는 에이전트

opencode 플러그인은 9개 에이전트를 번들한다.

```text
orchestrator
intent-checker
worker
planner
research
code-explorer
idea-generator
adversarial-review
constructive-feedback
```

사용자가 `default_agent`를 직접 지정하지 않은 경우 플러그인은 기본 에이전트를 `orchestrator`로 설정한다. 또한 최종 에이전트 레코드를 opencode 설정의 `agent` 맵에 병합한다.

### 3.3 opencode 세션 사용 예시

프로젝트에 설치한 뒤 opencode 세션에서 자연어로 역할을 지정해 사용할 수 있다.

```text
orchestrator로 처리해줘.
Goal: README의 CLI 설명과 실제 install 명령 구현이 어긋나는지 확인한다.
Constraints: 읽기 전용 정찰 후 필요한 경우에만 worker로 넘긴다.
Expected output: .agents/20260709-cli-readme/explore.md 또는 후속 work.md 경로.
```

범위가 확정된 구현 작업은 `worker`를 직접 지정할 수 있다.

```text
worker로 처리해줘.
taskId: 20260709-readme-link
Goal: README 문서 섹션에 docs/specs/usage.md 진입 링크만 추가한다.
Allowed changes: README.md and .agents/20260709-readme-link/work.md only.
Verification: README의 링크 대상 파일 존재 여부만 확인한다.
```

읽기 전용 정찰은 `code-explorer`를 지정한다.

```text
code-explorer로 처리해줘.
taskId: 20260709-opencode-config
Goal: opencode 플러그인이 default_agent와 agent 맵을 어디서 병합하는지 찾는다.
Scope: packages/opencode/src
Output: .agents/20260709-opencode-config/explore.md
```

### 3.4 에이전트별 override 예시

프로젝트별로 모델이나 지시를 바꾸려면 `.opencode/agents.toml`을 수정한다.

```toml
[agents.orchestrator]
reasoning_effort = "max"

[agents.worker]
model = "ollama-cloud/deepseek-v4-pro"
reasoning_effort = "high"

[agents.research]
prompt_append = """
공식 문서가 있으면 공식 문서를 먼저 확인하고 출처를 함께 남긴다.
"""
```

비보호 에이전트를 끄려면 `enable = false`를 사용한다.

```toml
[agents.idea-generator]
enable = false
```

비활성화된 에이전트가 있으면 플러그인은 `orchestrator` 프롬프트에 해당 에이전트로 위임하지 말라는 내용을 덧붙인다.

### 3.5 로컬 opencode 에이전트 파일과의 관계

opencode 자체의 로컬 에이전트 Markdown 파일은 다음 경로에서 발견될 수 있다.

```text
.opencode/agent/<agent-name>.md
.opencode/agents/<agent-name>.md
```

이 저장소의 `agents` 플러그인은 이 방식 대신 플러그인 훅으로 에이전트 레코드를 제공한다. 프로젝트 전용 단발 에이전트는 Markdown 파일 경로를 사용할 수 있고, 이 저장소가 번들한 공통 에이전트는 `agents.toml` override로 조정하는 것이 자연스럽다.
