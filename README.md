# buyong-agents

opencode용 에이전트 플러그인과 설치·검증 CLI를 함께 관리하는 모노레포입니다.

이 저장소는 다음 두 패키지를 포함합니다.

| 영역 | 경로 | 역할 |
| --- | --- | --- |
| 플러그인 런타임 | `packages/opencode` | opencode에 주입되는 에이전트 정의, 권한 정책, 설정 로딩, 모델 catalog, 실행 문서 프로토콜을 제공합니다. |
| CLI | `apps/cli` | `agents` 명령으로 설치, 제거, 설정 검증, 진단, catalog 갱신, CLI 업그레이드를 수행합니다. |

## 에이전트 구성

플러그인은 primary 오케스트레이터와 8개 서브에이전트를 제공합니다.

| 에이전트 | 역할 |
| --- | --- |
| `orchestrator` | 사용자 요청을 분류하고 가장 좁은 서브에이전트 체인으로 위임합니다. |
| `intent-checker` | 구체 계획과 사용자 의도가 맞는지 무상태로 확인합니다. |
| `worker` | 확정된 구현, 파일 변경, 검증 명령을 수행합니다. |
| `planner` | 구현 전 영향 범위, 위험, 순서를 단일 실행 경로로 수렴합니다. |
| `research` | 외부 문서, 공식 참조, 최신 웹 사실을 출처와 함께 조사합니다. |
| `code-explorer` | 내부 코드 위치, 심볼, 반복 패턴을 읽기 전용으로 찾습니다. |
| `idea-generator` | 여러 접근 대안과 트레이드오프를 발산합니다. |
| `adversarial-review` | 구현 또는 산출물의 결함, 반례, 회귀·보안 위험을 검토합니다. |
| `constructive-feedback` | 가독성, 유지보수성, 일관성 개선 제안을 제공합니다. |

## 설치해서 사용하기

Node.js 18 이상과 npm이 있으면 다음 세 명령으로 시작할 수 있습니다.

```sh
npm install --global @livteam/agents-cli
agents install
agents doctor
```

`agents install`은 화면에서 Codex, OpenCode 또는 둘 다를 고르게 합니다. Codex만 사용하면 Codex, OpenCode만 사용하면 OpenCode, 둘 다 사용하면 둘 다를 고르세요. 프로젝트 범위 설치는 적용할 프로젝트의 최상위 폴더에서 실행하거나 `--project <프로젝트-경로>`를 붙입니다. 마지막 명령은 설치와 실행 준비 상태를 확인합니다. 실행 파일 이름 `agents`와 OpenCode 플러그인 id `buyong-agents`는 기존 사용자를 위해 유지됩니다.

처음 설치하는 사용자는 [CLI 사용 안내](https://github.com/buYoung/agents/blob/main/docs/guides/cli-usage.md)를, npm에 처음 등록하거나 배포하는 운영자는 [npm 배포 안내](https://github.com/buYoung/agents/blob/main/docs/guides/npm-publishing.md)를 따르세요.

## 저장소에서 개발하기

개발 의존성을 설치한 뒤에는 경로 필터로 CLI를 실행합니다.

```sh
pnpm install
pnpm --filter ./apps/cli exec agents --help
```

개발 중 설치와 진단은 다음처럼 실행합니다.

```sh
pnpm --filter ./apps/cli exec agents install --target opencode --opencode-scope project
pnpm --filter ./apps/cli exec agents doctor --target opencode --opencode-scope project
```

## 설정 파일

플러그인 설정은 TOML 파일을 사용합니다.

| 범위 | 경로 |
| --- | --- |
| 프로젝트 | `.opencode/agents.toml` |
| 사용자 | `~/.config/opencode/agents.toml` 또는 `$XDG_CONFIG_HOME/opencode/agents.toml` |

프로젝트 범위 설정이 사용자 범위 설정보다 우선합니다. 설정 파일이 없으면 기본 에이전트 정의와 bundled catalog로 동작합니다.

예시는 [packages/opencode/agents.example.toml](packages/opencode/agents.example.toml)을 참고하세요.

```toml
# preset = "performance"

[agents.orchestrator]
model = "ollama-cloud/glm-5.2"
reasoning_effort = "max"

[agents.worker]
reasoning_effort = "high"
disabled_mcp = ["browser"]

[agents.idea-generator]
enable = false
```

지원 필드:

| 필드 | 설명 |
| --- | --- |
| `model` | bundled catalog에 있는 모델 ID로 에이전트 모델을 바꿉니다. |
| `reasoning_effort` | catalog가 허용하는 추론 노력 값을 설정합니다. |
| `prompt_append` | 기존 프롬프트 끝에 프로젝트별 지시를 덧붙입니다. |
| `enable` | 일부 비보호 에이전트를 비활성화합니다. |
| `disabled_mcp` | native `opencode.json(c)`의 MCP 서버 키를 대소문자까지 정확히 지정해 해당 역할의 서버 도구 호출을 추가로 거부합니다. `"*"`는 모든 MCP 서버 도구를 거부하고, 배열은 preset/사용자/프로젝트 병합에서 통째로 교체되므로 `[]`로 상속된 추가 거부를 비울 수 있습니다. |

설정 검증:

```sh
pnpm --filter ./apps/cli exec agents validate
pnpm --filter ./apps/cli exec agents doctor
```

### 도구 ID 충돌 지원 경계

OpenCode의 실행 전 훅은 도구의 등록 주체나 효과 정보 없이 도구 ID만 전달합니다. 따라서 사용자 지정 플러그인이 `read`, `glob`, `grep`, `list`, `lsp`, `codesearch`, `edit`, `write`, `apply_patch`, `bash`, `webfetch`, `websearch`, `task` 중 하나와 같은 ID를 등록하는 환경은 지원하지 않습니다. 이 플러그인을 그런 사용자 지정 도구와 함께 사용하지 마세요.

현재 OpenCode 설정과 훅 API는 플러그인 package 목록은 노출하지만 각 package가 등록한 도구 ID의 출처는 노출하지 않으므로, 이 플러그인이 충돌을 정확히 탐지하거나 내장 도구 호출과 구분할 수 없습니다. 네임스페이스가 붙은 ID의 접미사로 권한을 추론하지 않으며, 분류되지 않은 전체 ID는 기본 거부합니다. 충돌 환경에서는 권한 집행 보장을 제공하지 않습니다.

### 구성된 MCP 신뢰와 감쇠 경계

native `opencode.json(c).mcp`에서 활성화한 서버는 사용자가 명시적으로 신뢰한 capability로 취급합니다. `worker`, `planner`, `research`, `code-explorer`, `idea-generator`, `adversarial-review`, `constructive-feedback`는 구성된 서버 도구를 기본 사용할 수 있고, `orchestrator`와 `intent-checker`는 항상 거부합니다. 역할별 `disabled_mcp`는 이 기본 권한을 더 줄일 뿐이며, native agent 설정 병합 뒤 OpenCode 1.17.x의 `permission` 표면과 호환 `tools` 표면에 적용되고 실행 전 훅에서도 다시 확인됩니다.

플러그인은 MCP 도구의 읽기/쓰기/네트워크 효과를 추론하지 않습니다. 서버 활성화는 그 서버가 제공하는 도구 전체에 대한 사용자 신뢰이며, 세부 효과 제한이 필요하면 서버 자체 설정과 `disabled_mcp`를 사용해야 합니다. OpenCode가 만든 최종 도구 ID는 서버 provenance 증명이 아니므로 같은 ID를 만드는 custom/plugin 환경은 지원하지 않습니다. 서로 다른 서버 키가 OpenCode 정리 규칙 뒤 충돌하거나 한 서버 접두사가 다른 서버 접두사와 모호해지면 구성 오류로 닫습니다. 구성 서버 접두사가 알려진 builtin/core 도구 또는 generic MCP resource 도구 ID와 충돌할 수 있어도 native 권한 규칙을 만들기 전에 구성 오류로 닫습니다. 서버 키 비교는 대소문자를 구분하며 suffix나 namespace 추정으로 다른 ID를 허용하지 않습니다.

`disabled_mcp`는 서버 도구 호출만 다룹니다. `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`는 정확한 예약 ID로 먼저 분류되어 구성 서버 도구 권한으로 승격되지 않고 기본 거부됩니다. 그렇더라도 이 정책은 generic MCP resource API를 서버별로 필터링하거나 완전 격리하는 기능이 아니므로 `disabled_mcp`의 서버별 resource 격리 보장으로 해석하면 안 됩니다. CLI 설치·제거는 native MCP 블록을 소유하거나 수정하지 않고 기존 비파괴 보존 계약을 유지합니다.

## 개발 명령

루트에서 실행합니다.

```sh
pnpm check-types
pnpm test
pnpm build
```

패키지 단위로 실행할 수도 있습니다.

```sh
pnpm --filter opencode check
pnpm --filter opencode test
pnpm --filter ./apps/cli check
pnpm --filter ./apps/cli test
```

## 문서

주요 개발 문서는 [docs/specs/index.md](docs/specs/index.md)에서 출발합니다.

프롬프트 개선과 검증 기록은 다음 문서에 정리되어 있습니다.

| 문서 | 설명 |
| --- | --- |
| [docs/specs/agent-prompt-improvement-guide.md](docs/specs/agent-prompt-improvement-guide.md) | 프롬프트 개선 규칙, 절차, 평가 기준 통합 문서입니다. |
| [docs/evals/agent-prompts](docs/evals/agent-prompts) | 에이전트별 평가 결과와 최종 증명 기록입니다. |

## 저장소 작업 규칙

- 에이전트 역할이나 프롬프트를 바꿀 때는 `packages/opencode/src/agents`와 `docs/FDD`의 역할 문서를 함께 확인합니다.
- 권한, 파일 접근, 도구 제한 변경은 `packages/opencode/src/core/permissions/`가 소유합니다.
- 실행 문서 경로와 산출물 계약은 `packages/opencode/src/core/doc-protocol/`가 소유합니다.
- 설정, 모델, 추론 노력 검증은 `packages/opencode/src/core/config/`와 `packages/opencode/src/core/catalog/catalog.toml`을 기준으로 합니다.
- 코드 변경 후에는 최소한 `pnpm check-types`를 실행합니다.
