# buyong-agents

[English](https://github.com/buYoung/agents/blob/main/README.md) | 한국어

Codex용 에이전트 정의와 OpenCode용 에이전트 플러그인을 하나의 설치·관리 CLI로 배포하는 프로젝트입니다.

## 패키지

| 패키지 | 경로 | 역할 |
| --- | --- | --- |
| OpenCode 플러그인 | `packages/opencode` | 에이전트 정의, 권한 정책, TOML 설정, 모델 catalog, 실행 문서 프로토콜을 제공합니다. |
| CLI | `apps/cli` | `agents` 명령으로 설치, 갱신, 진단, 백업, 복원, 삭제를 수행합니다. |

## 에이전트 구성

primary 오케스트레이터와 목적이 분명한 8개 에이전트를 제공합니다.

| 에이전트 | 역할 |
| --- | --- |
| `orchestrator` | 요청을 분류하고 위임을 조정합니다. |
| `intent-checker` | 구체 계획이 사용자 의도와 맞는지 확인합니다. |
| `worker` | 승인된 변경을 구현하고 검증합니다. |
| `planner` | 하나의 수렴된 구현 계획을 만듭니다. |
| `research` | 최신 외부 사실과 문서를 조사합니다. |
| `code-explorer` | 내부 코드와 반복 패턴을 찾습니다. |
| `idea-generator` | 대안과 트레이드오프를 탐색합니다. |
| `adversarial-review` | 결함, 회귀, 보안 위험을 찾습니다. |
| `constructive-feedback` | 유지보수성과 일관성 개선을 제안합니다. |

## 빠른 시작

Node.js 18 이상과 npm이 필요합니다.

```sh
npm install --global @livteam/agents-cli
agents install
agents doctor
```

`agents install`에서 Codex, OpenCode 또는 둘 다를 선택할 수 있습니다. `agents doctor`는 설치 결과와 실행 준비 상태를 확인합니다.

## 문서

- [사용 안내](docs/usage.ko.md)
- [English usage guide](docs/usage.md)
- [개발 명세](docs/specs/index.md)
- [기능 설계 문서](docs/FDD/index.md)
- [에이전트 프롬프트 평가](docs/evals/agent-prompts)
- [npm 배포 안내](docs/guides/npm-publishing.md)

## 개발

```sh
pnpm install
pnpm check-types
pnpm test
pnpm build
```

하나의 소유 경계에서 작업할 때는 패키지 단위 검사를 실행할 수 있습니다.

```sh
pnpm --filter opencode check
pnpm --filter opencode test
pnpm --filter ./apps/cli check
pnpm --filter ./apps/cli test
```

저장소 소유 경계와 작업 규칙은 [AGENTS.md](AGENTS.md)를 확인하세요.
