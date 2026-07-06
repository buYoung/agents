# opencode Agent Development Reference

## 1. Purpose

이 문서는 opencode 에이전트를 작성하거나, opencode 플러그인에서 에이전트를 제공할 때 보는 개발 레퍼런스다. 특정 플러그인의 에이전트 목록을 설명하지 않는다. 에이전트 작성자는 이 문서만 보고 inline config, file-based agent, plugin-provided agent의 형식과 검증 기준을 잡을 수 있어야 한다.

## 2. Agent Authoring Surfaces

에이전트는 세 가지 방식으로 제공될 수 있다.

| Surface | Use when |
| ------- | -------- |
| Inline config | 짧은 에이전트 정의나 built-in override가 필요할 때. |
| Agent markdown file | 긴 system prompt, 사람이 읽는 프롬프트, 프로젝트 공유 에이전트가 필요할 때. |
| Plugin-provided transform | 플러그인이 에이전트를 자동으로 추가하거나 옵션에 따라 생성해야 할 때. |

비단순 에이전트는 markdown file 또는 plugin-provided transform을 권장한다.

## 3. Inline Agent Config

Inline agent는 opencode 구성의 agent map에 정의한다.

호환 형식:

```jsonc
{
  "agent": {
    "my-reviewer": {
      "description": "Reviews PRs for style violations.",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-6",
      "permission": {
        "edit": "deny",
        "bash": "ask"
      },
      "prompt": "You are a strict PR reviewer..."
    }
  }
}
```

권장 v2 형식:

```jsonc
{
  "agents": {
    "my-reviewer": {
      "description": "Reviews PRs for style violations.",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-6",
      "permissions": [
        { "action": "edit", "resource": "*", "effect": "deny" },
        { "action": "bash", "resource": "*", "effect": "ask" }
      ],
      "system": "You are a strict PR reviewer..."
    }
  }
}
```

개발 시 대상 런타임이 어떤 config shape를 소비하는지 확인하고, 한 문서 안에서 legacy와 v2 필드를 섞지 않는다.

## 4. Agent Markdown Files

에이전트 파일 위치:

```text
.opencode/agent/<agent-name>.md
.opencode/agents/<agent-name>.md
```

예시:

```markdown
---
description: Reviews PRs for style violations.
mode: subagent
model: anthropic/claude-sonnet-4-6
permission:
  edit: deny
  bash: ask
---

You are a strict PR reviewer. Focus on correctness, regressions, and missing tests.
```

규칙:

- 파일 본문은 에이전트의 prompt 또는 system content가 된다.
- frontmatter에 `prompt` 또는 `system`을 동시에 넣고 본문에도 같은 내용을 반복하지 않는다.
- 긴 지시문은 본문에 둔다.
- 구조적 metadata만 frontmatter에 둔다.

## 5. Agent Fields

### 5.1 Common fields

| Field | Meaning |
| ----- | ------- |
| `name` | 에이전트 이름. 파일명이나 map key에서 파생될 수 있다. |
| `description` | 사용자가 에이전트 역할을 이해하기 위한 설명. |
| `mode` | `primary`, `subagent`, `all` 중 하나. |
| `model` | `provider/model-id` 형식의 모델 참조. |
| `variant` | 같은 모델의 변형이나 preset 이름. |
| `hidden` | 사용자 선택 UI에서 숨길지 여부. |
| `color` | 사용자 표시용 색상 metadata. |
| `steps` | 에이전트 반복 또는 최대 단계 예산. |
| `options` | provider/request specific options. |

### 5.2 Prompt fields

| Legacy field | V2 field | Rule |
| ------------ | -------- | ---- |
| `prompt` | `system` | 파일 본문과 중복하지 않는다. |

Markdown file에서는 본문을 사용한다. Config object에서는 대상 런타임의 필드 이름에 맞춰 `prompt` 또는 `system`을 사용한다.

### 5.3 Disable fields

| Legacy field | V2 field | Meaning |
| ------------ | -------- | ------- |
| `disable` | `disabled` | 에이전트 정의는 남겨두되 비활성화한다. |

새 v2 문서나 새 플러그인 옵션에서는 `disabled`를 권장한다. 기존 런타임 호환이 필요하면 `disable`을 지원할 수 있다.

### 5.4 Permission fields

| Legacy field | V2 field |
| ------------ | -------- |
| `permission` | `permissions` |

권장 v2 ruleset:

```jsonc
{
  "permissions": [
    { "action": "edit", "resource": "*", "effect": "deny" },
    { "action": "bash", "resource": "git status", "effect": "allow" },
    { "action": "bash", "resource": "*", "effect": "ask" }
  ]
}
```

## 6. Agent Modes

| Mode | Meaning |
| ---- | ------- |
| `primary` | 사용자가 직접 선택해 대화를 시작할 수 있는 주 에이전트. |
| `subagent` | 다른 에이전트가 위임할 때 사용하는 하위 에이전트. |
| `all` | 직접 선택과 위임 양쪽에서 사용할 수 있는 에이전트. |

기본 에이전트는 non-hidden primary-mode 에이전트여야 한다. 숨김 에이전트나 subagent-only 에이전트를 기본 에이전트로 지정하지 않는다.

## 7. Built-in Agents And Overrides

opencode는 built-in agent를 제공한다. 일반적으로 사용자에게 노출되는 built-in agent는 다음과 같다.

| Agent | Purpose |
| ----- | ------- |
| `build` | 구현 또는 변경 수행. |
| `plan` | 계획 수립. |
| `general` | 일반 작업. |
| `explore` | 탐색. |

내부용 hidden agent는 사용자 선택 대상이 아니다.

| Hidden agent | Purpose |
| ------------ | ------- |
| `compaction` | 세션 압축. |
| `title` | 제목 생성. |
| `summary` | 요약 생성. |

Built-in agent를 override하려면 같은 key로 정의한다.

```jsonc
{
  "agent": {
    "build": {
      "model": "anthropic/claude-sonnet-4-6",
      "permission": { "edit": "ask" }
    }
  }
}
```

비활성화:

```jsonc
{
  "agent": {
    "build": { "disable": true }
  }
}
```

v2 config에서는 `disabled: true`를 사용한다.

## 8. Plugin-provided Agents

플러그인은 `agent` domain transform으로 에이전트를 추가하거나 override한다.

```ts
import { define } from "@opencode-ai/plugin/v2/promise";

export const Plugin = define({
  id: "reviewer-plugin",
  setup: async (ctx) => {
    await ctx.agent.transform((agents) => {
      agents.update("reviewer", (agent) => {
        agent.description = "Reviews changes for regressions.";
        agent.mode = "subagent";
        agent.model = "anthropic/claude-sonnet-4-6";
        agent.system = [
          "You are a strict reviewer.",
          "Focus on correctness, regressions, and missing tests.",
        ].join("\n");
        agent.permissions = [
          { action: "edit", resource: "*", effect: "deny" },
          { action: "bash", resource: "*", effect: "ask" },
        ];
      });
    });
  },
});
```

설계 규칙:

- plugin option으로 agent name을 받는 경우 기본값을 안정적으로 둔다.
- 기존 built-in agent를 override할 때는 의도적으로 같은 이름을 사용한다.
- 새 에이전트는 충돌 가능성이 낮은 이름을 사용한다.
- 플러그인이 여러 에이전트를 추가하면 각 에이전트의 역할과 mode를 분리한다.
- 에이전트 transform은 다른 domain까지 임의로 변경하지 않는다.

## 9. Permissions

에이전트 권한은 최소 권한으로 시작한다.

권장 기본값:

| Agent kind | Suggested permission |
| ---------- | -------------------- |
| Reviewer | `edit: deny`, `bash: ask` 또는 제한적 allow |
| Planner | `edit: deny`, `bash: ask` |
| Builder | `edit: ask` 또는 `allow`, `bash: ask` |
| Researcher | `edit: deny`, web/reference access as needed |

권한 설계 원칙:

- `allow`는 자동 실행을 허용하므로 필요한 범위에만 사용한다.
- `ask`는 사용자가 승인해야 하는 작업에 사용한다.
- `deny`는 역할상 필요 없는 작업을 막는 기본값으로 사용한다.
- edit-adjacent 도구는 같은 정책으로 묶어 생각한다.
- shell command 권한은 command prefix나 resource로 좁힌다.

## 10. Options And Model Variants

`model`은 provider와 model ID를 포함한다.

```text
provider/model-id
```

모델 ID 자체가 slash를 포함할 수 있으므로 variant를 model 문자열 뒤에 임의로 붙이지 않는다. 별도 `variant` 필드를 사용한다.

Provider-specific request options는 `options` 아래에 둔다.

```jsonc
{
  "agents": {
    "reviewer": {
      "model": "openrouter/openai/gpt-5",
      "variant": "high",
      "options": {
        "headers": { "x-agent": "reviewer" },
        "body": {},
        "aisdk": {
          "provider": {},
          "request": { "reasoningEffort": "high" }
        }
      }
    }
  }
}
```

## 11. File-based Agent Validation

Markdown agent를 작성할 때 확인한다.

- [ ] 파일 경로가 `.opencode/agent/` 또는 `.opencode/agents/` 아래다.
- [ ] 파일명이나 frontmatter name이 안정적인 에이전트 이름이다.
- [ ] `mode`가 `primary`, `subagent`, `all` 중 하나다.
- [ ] 본문이 비어 있지 않다.
- [ ] 본문과 frontmatter에 prompt/system 내용이 중복되지 않는다.
- [ ] 권한 필드가 대상 런타임 형식과 일치한다.
- [ ] built-in override라면 같은 이름을 의도적으로 사용했다.
- [ ] 비활성화 목적이면 `disable` 또는 `disabled`만 사용하고 불필요한 prompt를 남기지 않는다.

## 12. Plugin-provided Agent Validation

플러그인에서 에이전트를 제공할 때 확인한다.

- [ ] `ctx.agent.transform`을 사용한다.
- [ ] transform callback은 에이전트 domain만 변경한다.
- [ ] 에이전트 이름 충돌이 의도적인지 확인했다.
- [ ] `mode`가 역할과 일치한다.
- [ ] `description`이 사용자에게 보일 수 있는 수준으로 명확하다.
- [ ] system prompt가 플러그인 옵션과 일관된다.
- [ ] permissions가 최소 권한 원칙을 따른다.
- [ ] 외부 파일이나 원격 데이터에서 에이전트 내용을 읽는다면 변경 시 `ctx.agent.reload()`를 호출한다.
- [ ] 에이전트를 제거하거나 비활성화하는 옵션이 있다면 reload 후 결과가 일관된다.

## 13. Common Mistakes

| Mistake | Fix |
| ------- | --- |
| plugin object를 export함 | function 또는 `define(...)` 결과를 export한다. |
| 에이전트 본문과 frontmatter prompt를 중복함 | 긴 지시문은 본문 하나에만 둔다. |
| subagent-only 에이전트를 default로 지정함 | non-hidden primary 에이전트를 default로 둔다. |
| 권한을 전부 allow로 시작함 | 역할별 최소 권한으로 시작한다. |
| built-in override와 새 에이전트 추가를 구분하지 않음 | 같은 이름은 override, 새 이름은 addition으로 문서화한다. |
| transform에서 여러 domain을 무분별하게 변경함 | 필요한 domain의 transform만 등록한다. |
| 외부 데이터 변경 후 reload하지 않음 | `ctx.agent.reload()`를 호출한다. |

