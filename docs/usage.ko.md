# 사용 안내

[English](usage.md) | 한국어

이 문서는 `@livteam/agents-cli`의 설치와 일상적인 사용법을 설명합니다. CLI는 이 저장소의 에이전트 정의를 Codex와 OpenCode에 설치하고 관리합니다. OpenCode 플러그인 id는 호환성을 위해 계속 `buyong-agents`입니다.

## 준비

- Node.js 18 이상
- npm

설치 전에 두 도구를 확인합니다.

```sh
node --version
npm --version
```

## CLI 설치

```sh
npm install --global @livteam/agents-cli
agents --help
```

전역 설치 없이 한 명령만 실행할 수도 있습니다.

```sh
npx --yes @livteam/agents-cli doctor --target codex
```

현재 `agents --version`은 제공하지 않습니다. 버전 확인은 [버전 관리](#버전-관리)를 참고하세요.

## 대화형 설치

```sh
agents install
```

Codex, OpenCode 또는 둘 다를 선택합니다. OpenCode를 선택하면 설정을 설치할 위치도 고릅니다.

| OpenCode 범위 | 설정 경로 | 알맞은 경우 |
| --- | --- | --- |
| `user` | `~/.config/opencode/agents.toml` 또는 `$XDG_CONFIG_HOME/opencode/agents.toml` | 여러 프로젝트에서 같은 설정을 사용할 때 |
| `project` | `<프로젝트>/.opencode/agents.toml` | 설정을 하나의 프로젝트나 팀에서 관리할 때 |

프로젝트 범위는 프로젝트 최상위 폴더에서 실행하거나 `--project <프로젝트-경로>`를 추가합니다.

설치 결과를 확인합니다.

```sh
agents doctor
```

## 비대화형 설치

자동화에서는 대상과 OpenCode 범위를 직접 지정합니다.

```sh
agents install --target codex
agents install --target opencode --opencode-scope project
agents install --target all --opencode-scope user
```

`--target all`에는 OpenCode가 포함되므로 `--opencode-scope user` 또는 `--opencode-scope project`가 필요합니다.

## 명령 개요

| 목적 | 명령 | 동작 |
| --- | --- | --- |
| 설치 | `agents install` | 선택한 대상을 설치하고, 이미 관리 중이면 갱신 흐름으로 전환합니다. |
| 관리 파일 갱신 | `agents update` | 설치된 대상을 갱신하고, 관리 대상이 없으면 설치 흐름으로 전환합니다. |
| 진단 | `agents doctor` | 설정, 설치 상태, 실행 준비 상태를 확인합니다. |
| 백업 | `agents backup` | 현재 대상 파일을 나중에 복원할 수 있도록 기록합니다. |
| 복원 | `agents restore` | 백업을 선택하거나 `--backup <ID>`로 지정해 복원합니다. |
| 삭제 | `agents uninstall` | CLI 관리 파일을 제거하고 사용자 소유 설정은 가능한 한 보존합니다. |
| 묶음 설치 CLI 갱신 | `agents upgrade` | 과거 GitHub Release 설치를 갱신합니다. npm 설치에는 npm 갱신 명령을 안내합니다. |

`status`와 `validate`는 임시 호환 명령이며 공개 명령 표면에 포함되지 않습니다. 상태와 설정 검사는 `agents doctor`를 사용하세요.

## 기존 설치 가져오기

호환 파일이 있지만 CLI가 관리하지 않는 경우 바로 덮어쓰지 않습니다. 먼저 백업하고 내용을 확인한 뒤 관리 대상으로 가져옵니다.

```sh
agents backup --target opencode --opencode-scope project
agents install --target opencode --opencode-scope project --adopt
```

두 명령에 같은 대상과 범위를 사용하세요. `--adopt`는 사용자 설정을 무조건 삭제하지 않고 기존 파일을 CLI 관리 대상으로 가져옵니다.

## 관리 파일과 CLI 갱신

관리되는 Codex/OpenCode 파일과 npm으로 설치한 CLI는 따로 갱신합니다.

```sh
agents update
npm install --global @livteam/agents-cli@latest
```

npm 설치에서 `agents upgrade`를 실행하면 파일을 바꾸지 않고 npm 명령을 안내합니다. 이 명령은 과거 GitHub Release 묶음으로 설치한 CLI에만 사용합니다.

## 백업과 복원

기존 설치를 가져오거나 교체·삭제하기 전에 백업합니다.

```sh
agents backup --target codex
agents backup --target opencode --opencode-scope project
agents backup --target all --opencode-scope project --json
```

사람이 읽는 출력은 백업 식별자를 `ID`로, `--json`과 `--format=kv` 출력은 `backupId`로 표시합니다.

화면에서 고르거나 백업 ID를 직접 지정해 복원합니다.

```sh
agents restore
agents restore --backup <backup-id>
```

복원은 백업 뒤에 변경한 내용을 덮어쓸 수 있습니다. CLI는 적용 전에 복원 직전 백업을 만들려고 시도합니다. 복원 뒤에는 항상 `agents doctor`를 실행하세요.

## 관리 파일 삭제

```sh
agents uninstall --target codex
agents uninstall --target opencode --opencode-scope project
agents uninstall --target all --opencode-scope user
```

설치할 때 사용한 OpenCode 범위를 그대로 지정하세요. CLI가 소유하지 않은 파일은 가능한 한 보존합니다.

## OpenCode 설정

OpenCode 플러그인은 TOML 설정 파일을 사용합니다. 프로젝트 설정이 사용자 설정보다 우선합니다.

| 범위 | 경로 |
| --- | --- |
| 프로젝트 | `.opencode/agents.toml` |
| 사용자 | `~/.config/opencode/agents.toml` 또는 `$XDG_CONFIG_HOME/opencode/agents.toml` |

설정 파일이 없으면 기본 에이전트 정의와 bundled catalog를 사용합니다. 전체 예시는 [packages/opencode/agents.example.toml](../packages/opencode/agents.example.toml)을 참고하세요.

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

| 필드 | 설명 |
| --- | --- |
| `model` | bundled catalog에 있는 모델 ID를 선택합니다. |
| `reasoning_effort` | 선택한 모델이 허용하는 추론 노력 값을 설정합니다. |
| `prompt_append` | 에이전트 프롬프트 끝에 프로젝트별 지시를 추가합니다. |
| `enable` | 일부 비보호 에이전트를 비활성화합니다. |
| `disabled_mcp` | native `opencode.json(c)`에 설정된 MCP 서버 키를 대소문자까지 정확히 지정해 추가로 거부합니다. `"*"`는 모든 MCP 서버 도구를 거부하고 `[]`는 상속된 추가 거부를 비웁니다. |

설정된 MCP 서버는 사용자가 명시적으로 신뢰한 capability로 취급합니다. `disabled_mcp`는 역할별 신뢰를 줄일 수 있지만 개별 서버 도구의 읽기, 쓰기, 네트워크 효과를 추론하거나 제한하지는 못합니다. CLI는 native MCP 설정 블록을 소유하거나 수정하지 않습니다.

## 진단과 문제 해결

문제가 있으면 먼저 실행합니다.

```sh
agents doctor
```

더 자세하거나 기계가 읽을 수 있는 출력이 필요하면 다음을 사용합니다.

```sh
agents doctor --verbose
agents doctor --target opencode --opencode-scope project --json
agents doctor --target codex --format=kv
```

| 문제 | 확인할 내용 |
| --- | --- |
| `agents`를 찾지 못함 | 새 터미널을 열고 `npm prefix --global`과 전역 실행 파일 경로가 `PATH`에 있는지 확인합니다. |
| `npm`을 찾지 못함 | 최신 Node.js LTS를 설치하고 새 터미널을 엽니다. |
| npm 전역 설치 권한 오류 | 관리자 셸을 반복해서 사용하지 말고 설정된 npm prefix의 소유권을 바로잡습니다. |
| OpenCode 위치가 필요함 | `--opencode-scope user`를 사용하거나 프로젝트 최상위에서 `--opencode-scope project`로 실행합니다. 다른 프로젝트는 `--project <경로>`를 추가합니다. |
| 기존 파일을 관리할 수 없음 | 같은 대상과 범위를 백업하고 내용을 확인한 뒤 `agents install --adopt`를 사용합니다. |
| GitHub Release를 읽거나 검증할 수 없음 | 네트워크를 확인하고 잠시 뒤 다시 시도하며 `agents doctor --verbose`로 세부 내용을 확인합니다. |
| 설치 뒤 변경이 보이지 않음 | Codex 또는 OpenCode를 다시 시작하고 `agents doctor`를 실행합니다. |

상세 진단 출력을 지원 요청에 첨부하기 전에 토큰, 비밀번호, 개인 경로를 제거하세요.

## 버전 관리

설치된 버전과 최신 버전을 확인합니다.

```sh
npm list --global @livteam/agents-cli --depth=0
npm view @livteam/agents-cli version
```

특정 버전을 설치합니다.

```sh
npm install --global @livteam/agents-cli@<version>
```

CLI 버전을 바꿔도 관리되는 Codex/OpenCode 파일이 자동으로 바뀌지는 않습니다. 버전을 바꾼 뒤 `agents doctor`를 실행하세요.

## 자동화

화면 선택을 피하려면 대상, 범위, 프로젝트 경로를 모두 지정합니다. 기계가 읽는 출력은 `--json` 또는 `--format=kv`를 사용합니다.

```sh
agents install --target all --opencode-scope project --project <프로젝트-경로>
agents backup --target all --opencode-scope project --json
agents restore --backup <backup-id> --format=kv
npx --yes @livteam/agents-cli doctor --target opencode --opencode-scope project --json
```

| 종료 코드 | 의미 |
| --- | --- |
| `0` | 정상 |
| `1` | 경고 |
| `2` | 설정 또는 입력이 잘못됨 |
| `3` | 실행할 수 없음 |
| `4` | 내부 오류 |
