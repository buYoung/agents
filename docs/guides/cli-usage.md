# `agents` 사용 안내

이 안내는 처음 설치하는 사람을 위한 순서입니다. `agents`는 Codex와 OpenCode에 이 저장소의 에이전트 설정을 설치하고 관리하는 명령입니다. OpenCode 플러그인 id는 호환성을 위해 계속 `buyong-agents`입니다.

## 1. 준비하고 설치하기

Node.js 18 이상과 npm이 필요합니다. 먼저 터미널에서 아래 두 명령을 실행해 각각 버전 번호가 나오는지 확인하세요. `node` 또는 `npm`을 찾지 못한다면 [Node.js 내려받기](https://nodejs.org/en/download)에서 장기 지원 버전을 설치한 뒤 새 터미널을 여세요.

```sh
node --version
npm --version
```

그다음 설치하고 동작을 확인합니다.

```sh
npm install --global @livteam/agents-cli
agents --help
```

두 번째 명령이 사용법을 출력하면 설치가 끝난 것입니다. `agents --version`은 제공하지 않으므로 버전 확인 방법은 아래의 [CLI 버전 관리](#9-cli-버전-관리)를 사용하세요.

## 2. 가장 쉬운 설치

다음 명령을 실행하면 화면에서 설치할 대상을 고릅니다.

```sh
agents install
```

Codex만 사용하면 Codex, OpenCode만 사용하면 OpenCode, 둘 다 사용하면 둘 다를 고르세요. OpenCode를 고르면 설정을 둘 위치도 고릅니다.

| 설정을 둘 위치 | 설정 파일 | 알맞은 경우 |
| --- | --- | --- |
| 내 컴퓨터 전체 (`user`) | `~/.config/opencode/agents.toml` 또는 `$XDG_CONFIG_HOME/opencode/agents.toml` | 여러 프로젝트에서 같은 설정을 쓸 때 |
| 프로젝트 (`project`) | `<프로젝트-경로>/.opencode/agents.toml` | 팀 또는 프로젝트별 설정을 분리할 때 |

`project`는 명령을 실행한 현재 폴더를 뜻합니다. 적용할 프로젝트의 최상위 폴더에서 명령을 실행하거나, 다른 위치라면 `--project <프로젝트-경로>`를 붙이세요.

설치 뒤에는 다음으로 결과를 확인하세요.

```sh
agents doctor
```

## 3. 설치 대상을 직접 정하기

자동 처리나 복사 가능한 명령이 필요하면 대상을 직접 적습니다.

```sh
agents install --target codex
agents install --target opencode --opencode-scope project
agents install --target all --opencode-scope user
```

`--target all`에는 OpenCode도 포함되므로 `--opencode-scope user` 또는 `--opencode-scope project`가 꼭 필요합니다. 다른 프로젝트를 대상으로 할 때는 명령 끝에 `--project <프로젝트-경로>`를 더합니다.

## 4. 이미 설치되어 있을 때와 갱신하기

먼저 `agents doctor`를 실행한 뒤, 아래에서 내 상태와 같은 줄을 고르세요.

| 상태 | 실행할 명령 | 인수 고르는 법 |
| --- | --- | --- |
| CLI가 이미 관리 중 | `agents update` | 특정 대상만 갱신하려면 설치 때 쓴 `--target`과 OpenCode의 `--opencode-scope user` 또는 `project`를 같이 적습니다. |
| 아직 설치한 대상이 없음 | `agents update` 또는 `agents install` | `update`는 설치 단계로 이어집니다. Codex는 `--target codex`, OpenCode는 범위를 함께, 둘 다는 `--target all`과 범위를 함께 적습니다. |
| 파일은 있으나 CLI 관리 기록이 없음 | `agents backup` → 파일 확인 → `agents install --adopt` | 안전 사본과 `--adopt`에 같은 대상·범위를 사용합니다. 예: OpenCode 프로젝트 범위는 모두 `--target opencode --opencode-scope project`입니다. |

예를 들어 OpenCode 프로젝트 범위의 기존 설치를 관리 대상으로 가져오려면 다음 순서입니다.

```sh
agents backup --target opencode --opencode-scope project
agents install --target opencode --opencode-scope project --adopt
```

`--adopt`는 기존 설치를 CLI 관리 대상으로 가져온다는 뜻입니다. 사용자 설정을 자동으로 지우지 않으므로, 이 옵션은 내용을 확인한 뒤에만 사용하세요.

설정·에이전트 갱신과 CLI 프로그램 갱신은 다릅니다. npm으로 설치했다면 CLI 자체는 npm으로 갱신합니다.

```sh
npm install --global @livteam/agents-cli@latest
```

과거 GitHub Release 묶음으로 설치한 CLI만 다음 명령으로 자체 갱신할 수 있습니다.

```sh
agents upgrade
```

npm 설치에서 `agents upgrade`를 실행하면 파일을 바꾸지 않고 npm 갱신 명령을 안내합니다.

## 5. 변경 전 안전 사본 만들기

안전 사본은 현재 설정을 보관하는 복원용 기록입니다. 삭제하거나 기존 설치를 관리 대상으로 가져오기 전에는 먼저 만드세요.

```sh
agents backup --target codex
agents backup --target opencode --opencode-scope project
agents backup --target all --opencode-scope project --json
```

화면 출력에서는 `ID`, 기계가 읽는 `--json` 또는 `--format=kv` 출력에서는 `backupId`를 복사해 보관하세요. ID는 `20260712143000-a1b2c3d4`처럼 생성 시각과 짧은 임의 문자열로 이루어집니다.

```text
ID: 20260712143000-a1b2c3d4
생성 시각: 2026-07-12T14:30:00.000Z
대상·범위: opencode (project)
```

## 6. 기록을 골라 복원하기

터미널에서 선택할 수 있으면 다음 명령이 복원 가능한 기록 목록을 보여 줍니다. 목록에서 만들기 직전의 Codex/OpenCode 대상과 같은 범위의 기록을 고르세요.

```sh
agents restore
```

선택 뒤에는 ID, 생성 시각, 대상·범위, 파일 수와 현재 상태를 보여 주고 복원할지 한 번 더 묻습니다. 취소하면 파일을 바꾸지 않습니다. ID를 이미 알고 있거나 자동 처리 중이면 직접 지정합니다.

```sh
agents restore --backup 20260712143000-a1b2c3d4
```

복원은 이후에 한 사용자 변경을 덮어쓸 수 있습니다. 복원 중 실패하면 CLI는 복원 직전의 안전 사본을 만들어 되돌리기를 시도합니다. 완료 또는 실패 뒤에는 꼭 다음을 실행하세요.

```sh
agents doctor
```

## 7. 삭제하기

삭제 전에는 [안전 사본](#5-변경-전-안전-사본-만들기)을 먼저 만드세요. 대상에 따라 다음 명령을 사용합니다.

```sh
agents uninstall --target codex
agents uninstall --target opencode --opencode-scope project
agents uninstall --target all --opencode-scope user
```

CLI가 만들지 않은 사용자 설정은 삭제하지 않고 남깁니다. OpenCode를 삭제할 때도 설치 때와 같은 `--opencode-scope`를 지정해야 합니다.

## 8. 상태 확인과 문제 해결

문제가 있으면 먼저 다음을 실행하세요.

```sh
agents doctor
```

더 자세한 경로와 검사값이 필요하면 다음을 사용합니다.

```sh
agents doctor --verbose
agents doctor --target opencode --opencode-scope project --json
agents doctor --target codex --format=kv
```

| 상황 | 실행할 명령 | 확인할 항목 | 다시 실행할 명령 |
| --- | --- | --- | --- |
| `agents`를 찾지 못함 | `npm install --global @livteam/agents-cli` | 새 터미널을 연 뒤에도 실패하면 `npm prefix --global`로 전역 설치 위치를 확인하고 그 실행 파일 위치가 `PATH`에 있는지 확인합니다. | `agents --help` |
| `npm`을 찾지 못함 | `node --version` | 버전이 나오지 않으면 Node.js를 설치한 뒤 새 터미널을 엽니다. | `npm --version` 후 설치 명령 |
| npm 권한 또는 설치 오류 | `npm install --global @livteam/agents-cli` | 오류에 나온 전역 설치 위치의 쓰기 권한과 npm 설정을 확인합니다. 관리자 권한 명령을 무조건 쓰지 마세요. | 같은 설치 명령 |
| OpenCode 위치가 필요하다는 오류 | `agents doctor --target opencode --opencode-scope project --project <프로젝트-경로>` | `<프로젝트-경로>`가 적용할 프로젝트 최상위 폴더인지 확인합니다. 컴퓨터 전체 설정이면 `project` 대신 `user`를 씁니다. | 같은 범위를 붙인 `agents install` 또는 `agents update` |
| 기존 설치를 관리할 수 없다는 오류 | Codex: `agents backup --target codex`<br>OpenCode 프로젝트: `agents backup --target opencode --opencode-scope project` | 안전 사본을 만들고 기존 파일 내용을 확인합니다. OpenCode의 `user` 또는 `all` 범위는 [설치 예시](#3-대상과-설치-범위-선택)를 따릅니다. | Codex: `agents install --target codex --adopt`<br>OpenCode 프로젝트: `agents install --target opencode --opencode-scope project --adopt` |
| GitHub Release를 읽거나 검증하지 못함 | `agents doctor --verbose` | 네트워크를 확인하고 잠시 뒤 다시 시도합니다. | 원래 `agents update` 명령 |
| 설치 후 동작하지 않음 | `agents doctor` | 대상별 상태를 확인하고, OpenCode 또는 Codex가 실행 중이면 종료 후 다시 엽니다. | 설치 또는 갱신 명령 |

계속 실패하면 토큰, 비밀번호, 개인 경로를 지운 `agents doctor --verbose` 출력과 운영체제, 실행한 명령을 지원 요청에 함께 보내세요.

## 9. CLI 버전 관리

현재 전역 설치 버전은 다음으로 확인합니다.

```sh
npm list --global @livteam/agents-cli --depth=0
```

npm에 있는 최신 버전은 다음으로 확인합니다.

```sh
npm view @livteam/agents-cli version
```

특정 버전으로 고정하거나 이전 버전으로 되돌리려면 원하는 버전을 넣어 다시 설치합니다.

```sh
npm install --global @livteam/agents-cli@<version>
```

CLI 버전과 Codex/OpenCode 설치 상태는 별개입니다. 버전을 바꾼 뒤에는 `agents doctor`로 대상 상태를 확인하세요.

## 10. 화면 없이 실행하기

자동화에서는 화면 선택이 나오지 않도록 대상과 OpenCode 위치를 모두 지정합니다. 결과를 다른 프로그램이 읽게 하려면 `--json` 또는 `--format=kv`를 사용합니다. `backupId`에는 바로 앞 `agents backup --json` 출력의 값을 넣으세요.

```sh
agents install --target all --opencode-scope project --project <프로젝트-경로>
agents backup --target all --opencode-scope project --json
agents restore --backup <backup-id> --format=kv
npx --yes @livteam/agents-cli doctor --target opencode --opencode-scope project --json
```

종료 코드는 `0`이면 정상, `1`이면 경고, `2`이면 설정 또는 입력이 잘못됨, `3`이면 실행할 수 없음, `4`이면 내부 오류입니다. 자동화에서는 출력과 종료 코드를 함께 확인하세요.
