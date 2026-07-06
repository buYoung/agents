# opencode Plugin MCP Integration Spec

## 1. Purpose

이 문서는 opencode 플러그인 개발에서 Model Context Protocol (MCP) 서버를 구성하고 런타임 요청에 연결하는 방식을 정의한다. 특정 MCP 서버나 특정 플러그인의 내부 구현을 설명하지 않는다.

## 2. MCP Configuration Shape

권장 v2 구성은 `mcp.servers` 아래에 서버 맵을 둔다.

```jsonc
{
  "mcp": {
    "servers": {
      "playwright": {
        "type": "local",
        "command": ["npx", "@playwright/mcp@latest"],
        "disabled": false
      },
      "docs": {
        "type": "remote",
        "url": "https://docs.example.com/mcp",
        "headers": {
          "authorization": "Bearer {env:DOCS_MCP_TOKEN}"
        }
      }
    },
    "timeout": {
      "startup": 10000,
      "request": 30000
    }
  }
}
```

규칙:

- 일반적인 `mcpServers` 복붙 형식을 그대로 쓰지 않는다.
- 서버 항목은 `mcp.servers.<name>` 아래에 둔다.
- named entry 비활성화에는 `disabled`를 사용한다.
- global timeout과 per-server timeout이 모두 있다면 per-server가 우선한다.

## 3. Local Servers

Local MCP 서버는 로컬 프로세스로 실행된다.

```jsonc
{
  "mcp": {
    "servers": {
      "playwright": {
        "type": "local",
        "command": ["npx", "@playwright/mcp@latest"],
        "env": {
          "DEBUG": "pw:mcp"
        },
        "disabled": false
      }
    }
  }
}
```

규칙:

- `command`는 문자열 하나가 아니라 배열이다.
- shell parsing에 의존하지 않는다.
- 환경 변수는 필요한 값만 전달한다.
- 로컬 서버 시작 실패는 서버 이름과 command를 포함해 보고한다.

## 4. Remote Servers

Remote MCP 서버는 URL로 연결된다.

```jsonc
{
  "mcp": {
    "servers": {
      "github": {
        "type": "remote",
        "url": "https://api.githubcopilot.com/mcp/",
        "headers": {
          "authorization": "Bearer {env:GITHUB_TOKEN}"
        },
        "disabled": false
      }
    }
  }
}
```

규칙:

- `url`은 필수다.
- 인증 정보는 직접 문자열로 박아두지 않고 interpolation을 사용한다.
- header 값에 비밀이 포함될 수 있으므로 로그에 전체 header를 출력하지 않는다.
- remote 연결 실패는 서버 이름, URL host, 실패 원인을 포함한다.

## 5. Authentication And Interpolation

권장 interpolation:

| Syntax | Meaning |
| ------ | ------- |
| `{env:VAR_NAME}` | 환경 변수 값으로 치환한다. |
| `{file:/path/to/token}` | 파일 내용을 읽어 치환한다. |

규칙:

- `{env:VAR}` 형식을 허용한다.
- `${VAR}` 형식을 자동 치환한다고 문서화하지 않는다.
- 파일 치환은 읽기 실패, 빈 파일, 권한 오류를 구분해 보고한다.
- 치환 전후 값을 로그에 그대로 출력하지 않는다.

OAuth가 필요한 서버는 서버 항목에 명시한다.

```jsonc
{
  "mcp": {
    "servers": {
      "remote-docs": {
        "type": "remote",
        "url": "https://docs.example.com/mcp",
        "oauth": true
      }
    }
  }
}
```

## 6. Timeout Rules

Startup timeout과 request timeout은 분리한다.

```jsonc
{
  "mcp": {
    "timeout": {
      "startup": 10000,
      "request": 30000
    },
    "servers": {
      "slow-docs": {
        "type": "remote",
        "url": "https://docs.example.com/mcp",
        "timeout": {
          "startup": 20000,
          "request": 60000
        }
      }
    }
  }
}
```

규칙:

- startup timeout은 서버 연결 또는 초기화에 적용한다.
- request timeout은 tool/resource 호출에 적용한다.
- 단일 `mcp_timeout` 값만 두는 설계를 새 문서의 기본으로 삼지 않는다.
- legacy timeout이 있다면 `mcp.timeout.request`로 마이그레이션한다.

## 7. Request-time Materialization

MCP 도구와 리소스는 요청 시점에 현재 활성 서버 상태와 정책에 따라 재질화된다.

규칙:

- disabled server의 도구와 리소스는 노출하지 않는다.
- 서버 시작에 실패한 MCP의 도구와 리소스는 노출하지 않는다.
- MCP tool은 plugin tool, built-in tool과 함께 최종 tool set으로 조립될 수 있다.
- tool 정책 필터를 통과하지 못한 MCP tool은 모델 요청에 포함하지 않는다.
- MCP 리소스와 plugin tool materialization을 같은 것으로 설명하지 않는다.

## 8. Plugin-owned MCP

플러그인이 MCP 서버 구성을 생성하거나 주입할 수 있다.

규칙:

- 플러그인 옵션으로 MCP enable/disable을 제공할 수 있다.
- 플러그인이 주입한 MCP와 사용자 config MCP의 우선순위를 명시한다.
- 플러그인 제거 또는 비활성화 시 주입된 MCP 서버도 제거되어야 한다.
- 플러그인 주입 MCP가 static config 명령에 보이지 않을 수 있으면 doctor 또는 runtime 진단 문서에 그 차이를 설명한다.

## 9. Error Handling

| Failure | Expected behavior |
| ------- | ----------------- |
| invalid config | 서버 이름과 필드 경로를 보고한다. |
| command spawn failure | local 서버 이름과 command를 보고한다. |
| remote connection failure | remote 서버 이름과 URL host를 보고한다. |
| auth interpolation failure | 누락된 env/file 이름을 보고하되 값은 숨긴다. |
| startup timeout | 서버 이름과 timeout 값을 보고한다. |
| request timeout | 서버 이름, tool/resource 이름, timeout 값을 보고한다. |
| tool failure | MCP 서버 이름과 tool 이름을 포함해 보고한다. |

## 10. Migration Rules

| Legacy / external shape | opencode shape |
| ----------------------- | -------------- |
| `mcpServers` | `mcp.servers` |
| command string | command array |
| `enabled: false` | `disabled: true` |
| single MCP timeout | `mcp.timeout.request` plus optional `mcp.timeout.startup` |
| `${VAR}` | `{env:VAR}` |

마이그레이션은 서버 이름을 유지해야 한다. 서버 이름이 바뀌면 사용자 권한, 문서, 프롬프트, 진단 메시지가 함께 깨질 수 있다.

## 11. Verification Checklist

- [ ] `mcp.servers` shape를 사용한다.
- [ ] local server는 `command` 배열을 사용한다.
- [ ] remote server는 `url`과 필요한 `headers`를 가진다.
- [ ] `disabled`가 named entry 비활성화 용어로 쓰인다.
- [ ] startup timeout과 request timeout이 분리되어 있다.
- [ ] `{env:...}`와 `{file:...}` 치환 오류가 안전하게 보고된다.
- [ ] 비밀 값이 로그에 노출되지 않는다.
- [ ] 요청 시점 tool/resource 재질화와 정책 필터링이 설명되어 있다.
- [ ] 플러그인 주입 MCP와 사용자 config MCP의 우선순위가 정해져 있다.

