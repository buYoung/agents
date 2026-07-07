# Developer Specifications

이 폴더의 문서는 opencode 플러그인 개발 명세와 CLI 운용 사양을 모은다. 개발 명세는 구현자가 문서만 보고 플러그인을 개발하거나 검토할 수 있도록 작성했고, 운용 사양은 특정 실행 절차를 재현 가능하게 정리한다.

| Document | Purpose |
| -------- | ------- |
| [opencode-plugin-development-reference.md](opencode-plugin-development-reference.md) | opencode 플러그인 작성, 등록, 로딩, 훅, 변형, 재로드, 배포 형식. |
| [opencode-agent-development-reference.md](opencode-agent-development-reference.md) | opencode 에이전트 작성 형식, 플러그인에서 에이전트를 제공하는 방식, 권한과 기본 에이전트 규칙. |
| [opencode-plugin-configuration-spec.md](opencode-plugin-configuration-spec.md) | 플러그인 구성 형식, `plugins` 목록, 로컬 발견, 옵션 검증, 재시작 규칙. |
| [opencode-plugin-orchestration-spec.md](opencode-plugin-orchestration-spec.md) | transform, runtime hook, registration scope, reload, cross-domain orchestration 규칙. |
| [opencode-plugin-mcp-integration-spec.md](opencode-plugin-mcp-integration-spec.md) | MCP 서버 구성, local/remote 서버, 인증 치환, timeout, 요청 시점 tool materialization. |
| [opencode-plugin-installation-and-migration-spec.md](opencode-plugin-installation-and-migration-spec.md) | 플러그인 설치, config patch, generated files, legacy-to-v2 migration, 복구 규칙. |
| [agent-prompt-improvement-and-testing-spec.md](agent-prompt-improvement-and-testing-spec.md) | 번들 agents 시스템 프롬프트 개선 시 FDD 기반 리라이트 절차와 정적·런타임·행동 평가 기준. |
| [agent-prompt-iteration-and-compression-guidelines.md](agent-prompt-iteration-and-compression-guidelines.md) | 모든 agent에 공통 적용할 반복강화, 치팅 방지, 프롬프트 압축, 3회 반복 평가 기준. |
| [agent-prompt-improvement-checklist.md](agent-prompt-improvement-checklist.md) | `orchestrator` 이후 8개 agent 프롬프트 개선 순서와 agent별 체크리스트 초안. |
| [opencode-cli-ollama-cloud-glm52-usage-spec.md](opencode-cli-ollama-cloud-glm52-usage-spec.md) | opencode CLI에서 Ollama Cloud GLM-5.2를 실행하고 프롬프트 개선 테스트에 사용하는 절차. |

## Recommended Reading Order

1. `opencode-plugin-development-reference.md`
2. `opencode-agent-development-reference.md`
3. `opencode-plugin-configuration-spec.md`
4. `opencode-plugin-orchestration-spec.md`
5. `opencode-plugin-mcp-integration-spec.md`
6. `opencode-plugin-installation-and-migration-spec.md`
7. `agent-prompt-improvement-and-testing-spec.md`
8. `agent-prompt-iteration-and-compression-guidelines.md`
9. `agent-prompt-improvement-checklist.md`
10. `opencode-cli-ollama-cloud-glm52-usage-spec.md`
11. `docs/FDD/opencode-plugin-authoring.md`
12. `docs/FDD/opencode-agent-authoring.md`

FDD는 제품 방향과 설계 판단을 설명한다. 개발 명세는 opencode 플러그인과 에이전트의 작성 계약과 검증 기준을 설명한다.
