# Developer Specifications

이 폴더의 문서는 구현자가 문서만 보고 opencode 플러그인을 개발하거나 검토할 수 있도록 작성한 개발 명세다.

| Document | Purpose |
| -------- | ------- |
| [opencode-plugin-development-reference.md](opencode-plugin-development-reference.md) | opencode 플러그인 작성, 등록, 로딩, 훅, 변형, 재로드, 배포 형식. |
| [opencode-agent-development-reference.md](opencode-agent-development-reference.md) | opencode 에이전트 작성 형식, 플러그인에서 에이전트를 제공하는 방식, 권한과 기본 에이전트 규칙. |
| [opencode-plugin-configuration-spec.md](opencode-plugin-configuration-spec.md) | 플러그인 구성 형식, `plugins` 목록, 로컬 발견, 옵션 검증, 재시작 규칙. |
| [opencode-plugin-orchestration-spec.md](opencode-plugin-orchestration-spec.md) | transform, runtime hook, registration scope, reload, cross-domain orchestration 규칙. |
| [opencode-plugin-mcp-integration-spec.md](opencode-plugin-mcp-integration-spec.md) | MCP 서버 구성, local/remote 서버, 인증 치환, timeout, 요청 시점 tool materialization. |
| [opencode-plugin-installation-and-migration-spec.md](opencode-plugin-installation-and-migration-spec.md) | 플러그인 설치, config patch, generated files, legacy-to-v2 migration, 복구 규칙. |

## Recommended Reading Order

1. `opencode-plugin-development-reference.md`
2. `opencode-agent-development-reference.md`
3. `opencode-plugin-configuration-spec.md`
4. `opencode-plugin-orchestration-spec.md`
5. `opencode-plugin-mcp-integration-spec.md`
6. `opencode-plugin-installation-and-migration-spec.md`
7. `docs/FDD/opencode-plugin-authoring.md`
8. `docs/FDD/opencode-agent-authoring.md`

FDD는 제품 방향과 설계 판단을 설명한다. 개발 명세는 opencode 플러그인과 에이전트의 작성 계약과 검증 기준을 설명한다.
