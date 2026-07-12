# 사용 흐름

이 문서는 `@livteam/agents-cli`의 전체 사용 흐름을 짧게 정리합니다. 처음 설치하거나 실제 명령을 찾는 사용자는 [CLI 사용 안내](../guides/cli-usage.md)를 따라 하세요. npm에 처음 등록하거나 새 버전을 공개하는 담당자는 [npm 등록과 배포](../guides/npm-publishing.md)를 사용하세요.

## 가장 빠른 시작

Node.js 18 이상이 설치된 터미널에서 다음 명령을 실행합니다.

```sh
npm install --global @livteam/agents-cli
agents --help
agents install
agents doctor
```

설치할 때 화면에서 Codex, OpenCode 또는 둘 다를 선택할 수 있습니다. OpenCode를 고르면 내 컴퓨터 전체에서 쓸지, 현재 프로젝트에서만 쓸지도 선택합니다.

npm에 등록된 이름은 `@livteam/agents-cli`이고, 설치 후 실행하는 명령은 `agents`입니다. OpenCode 플러그인 id는 기존 사용자와의 호환을 위해 `buyong-agents`를 유지합니다.

## 명령별 역할

| 하고 싶은 일 | 명령 | 동작 |
| --- | --- | --- |
| 처음 설치 | `agents install` | 화면에서 대상을 선택해 설치합니다. |
| 설치 내용 갱신 | `agents update` | 이미 설치되어 있으면 갱신하고, 설치되어 있지 않으면 설치 단계로 이어집니다. |
| 상태와 문제 확인 | `agents doctor` | 설치 상태, 설정 파일과 실행 준비 상태를 한 번에 확인합니다. |
| 안전 사본 만들기 | `agents backup` | 현재 설치 내용을 나중에 되돌릴 수 있도록 기록합니다. |
| 안전 사본 복원 | `agents restore` | 화면에서 기록을 고르거나 `--backup <ID>`로 지정해 복원합니다. |
| 설치 내용 삭제 | `agents uninstall` | CLI가 관리하는 설치 내용을 제거합니다. 사용자 설정은 가능한 한 보존합니다. |
| GitHub 묶음으로 설치한 CLI 갱신 | `agents upgrade` | GitHub Release 방식의 CLI를 갱신합니다. npm 설치라면 npm 갱신 명령을 안내합니다. |

`status`와 `validate`는 별도 명령으로 제공하지 않습니다. 상태 확인과 설정 검사는 `agents doctor` 하나로 처리합니다.

## 이미 설치되어 있을 때

`install`과 `update`는 현재 상태에 맞게 동작을 바꿉니다.

- `agents install`: CLI가 이미 관리 중이면 갱신 흐름으로 전환합니다.
- `agents update`: 설치된 대상이 없으면 설치 흐름으로 전환합니다.
- 설치 파일은 있지만 CLI 관리 기록이 없으면 바로 덮어쓰지 않습니다. 먼저 `agents backup`으로 안전 사본을 만들고 내용을 확인한 뒤 `agents install --adopt`를 사용합니다.
- 너무 오래되어 바로 갱신할 수 없는 설치는 새로 설치하는 흐름으로 처리합니다.

## 대상을 직접 지정하기

화면 선택 없이 실행하려면 대상을 직접 적습니다.

```sh
agents install --target codex
agents install --target opencode --opencode-scope project
agents install --target all --opencode-scope user
```

OpenCode의 `project`는 현재 프로젝트에만 적용하고, `user`는 내 컴퓨터의 여러 프로젝트에 공통으로 적용합니다. 다른 프로젝트에 적용하려면 `--project <프로젝트-경로>`를 추가합니다.

## 안전 사본과 복원

삭제하거나 기존 설치를 관리 대상으로 가져오기 전에는 안전 사본을 만드세요.

```sh
agents backup --target all --opencode-scope project
agents restore
```

`agents restore`는 저장된 기록을 목록으로 보여 주고 사용자가 고르게 합니다. 기록 ID를 알고 있으면 다음처럼 바로 지정할 수 있습니다.

```sh
agents restore --backup <backup-id>
```

복원 뒤에는 `agents doctor`를 실행해 상태를 확인합니다.

## CLI 버전 확인과 변경

npm으로 설치한 현재 버전과 최신 버전은 다음 명령으로 확인합니다.

```sh
npm list --global @livteam/agents-cli --depth=0
npm view @livteam/agents-cli version
```

최신 버전으로 갱신하거나 원하는 버전으로 되돌리려면 다시 설치합니다.

```sh
npm install --global @livteam/agents-cli@latest
npm install --global @livteam/agents-cli@<version>
```

버전을 바꾼 뒤에는 `agents doctor`로 Codex와 OpenCode 설치 상태를 확인하세요.

## 개발 중 로컬 실행

저장소를 내려받아 배포 전에 확인할 때만 아래 명령을 사용합니다. 일반 사용자는 npm 설치 방법을 사용하면 됩니다.

```sh
pnpm install
pnpm --filter ./apps/cli exec agents --help
pnpm --filter ./apps/cli exec agents install
```

## 더 자세한 안내

- 설치·갱신·삭제·진단·백업·복원·문제 해결: [CLI 사용 안내](../guides/cli-usage.md)
- npm 최초 등록과 이후 안전한 배포: [npm 등록과 배포](../guides/npm-publishing.md)
- 저장소 첫 화면의 빠른 시작: [README](../../README.md)
