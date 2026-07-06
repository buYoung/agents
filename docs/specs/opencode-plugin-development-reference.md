# opencode Plugin Development Reference

## 1. Purpose

이 문서는 opencode 플러그인을 새로 개발할 때 보는 개발 레퍼런스다. 특정 플러그인의 내부 구현이나 에이전트 목록을 설명하지 않는다. 플러그인 작성자는 이 문서만 보고 플러그인 모듈 형식, 설정 등록 방식, 훅 표면, 변형 훅, 재로드, 실패 처리 기준을 잡을 수 있어야 한다.

## 2. Choose The Plugin API

opencode 플러그인은 두 계열의 작성 표면을 가진다.

| API style | When to use | Shape |
| --------- | ----------- | ----- |
| Hook-returning plugin | 기존 플러그인 호환성, 간단한 런타임 훅, 도구나 설정 훅 중심 플러그인 | plugin function returns a hooks object |
| V2 context plugin | 에이전트, 카탈로그, 명령, 참조, 스킬 같은 stateful domain을 변형하는 플러그인 | `define({ id, setup })` 또는 `define({ id, effect })` |

에이전트를 플러그인에서 제공하거나 기존 에이전트 도메인을 바꾸려면 V2 context plugin을 기본 선택지로 삼는다. 단, 현재 대상 런타임이 hook-returning plugin만 읽는 경우에는 hook-returning 형식을 사용하고 `config` 훅에서 agent 구성을 병합한다.

## 3. Installation And Discovery

### 3.1 Configured package plugins

플러그인은 구성에서 순서 있는 목록으로 선언한다. 순서는 훅 등록과 실행 결과에 영향을 줄 수 있으므로 의미 있는 계약이다.

권장 v2 형식:

```jsonc
{
  "plugins": [
    "opencode-example-plugin",
    {
      "package": "@my-org/opencode-review-plugin",
      "options": {
        "strict": true
      }
    }
  ]
}
```

호환 형식:

```jsonc
{
  "plugin": [
    "opencode-example-plugin",
    "opencode-example-plugin@1.2.3",
    ["opencode-example-plugin", { "strict": true }]
  ]
}
```

### 3.2 Local plugins

로컬 플러그인은 프로젝트의 opencode 플러그인 디렉터리에서 자동 발견된다.

```text
.opencode/plugin/*.ts
.opencode/plugin/*.js
.opencode/plugins/*.ts
.opencode/plugins/*.js
```

로컬 플러그인은 실험, 프로젝트 전용 확장, 패키지 배포 전 검증에 적합하다.

## 4. Hook-returning Plugin Shape

hook-returning 플러그인은 default export 또는 named export로 plugin function을 제공한다. export 값은 plain object가 아니라 function이어야 한다.

```ts
import type { Plugin } from "@opencode-ai/plugin";

export default (async (input, options) => {
  return {
    config: (config) => {
      // mutate config in place
    },
    "tool.execute.before": async (input, output) => {
      // inspect input and mutate output in place
    },
  };
}) satisfies Plugin;
```

필수 규칙:

- 플러그인 함수는 hook object를 반환한다.
- 등록할 훅이 없으면 `{}`를 반환한다.
- 훅은 가능한 경우 `output` 또는 전달받은 config 객체를 in-place로 변경한다.
- 훅에서 장기 상태를 보관해야 하면 plugin function closure 안에 둔다.
- 사용자 옵션은 plugin function의 `options` 인자로 받는다.

## 5. Hook-returning Runtime Hooks

다음 훅은 callback 형태로 등록된다.

| Hook | Purpose |
| ---- | ------- |
| `event(input)` | 모든 이벤트 버스 이벤트 관찰. |
| `config(config)` | 병합된 구성 초기화 시점에 구성 변경. |
| `chat.message(input, output)` | 채팅 메시지 처리 전후의 메시지 정보 관찰 또는 변경. |
| `chat.params(input, output)` | 모델 호출 파라미터 변경. |
| `chat.headers(input, output)` | 모델 호출 헤더 변경. |
| `tool.execute.before(input, output)` | 도구 실행 전 인자 검사 또는 변경. |
| `tool.execute.after(input, output)` | 도구 실행 후 결과 검사 또는 변경. |
| `tool.definition(input, output)` | 도구 정의 변경. |
| `command.execute.before(input, output)` | 명령 실행 전 검사 또는 변경. |
| `shell.env(input, output)` | 셸 환경 변수 제공 또는 변경. |
| `permission.ask(input, output)` | 권한 요청 처리. |
| `experimental.chat.messages.transform(input, output)` | 채팅 메시지 배열 변형. |
| `experimental.chat.system.transform(input, output)` | 시스템 프롬프트 변형. |
| `experimental.session.compacting(input, output)` | 세션 압축 동작 관여. |
| `experimental.compaction.autocontinue(input, output)` | 압축 후 자동 계속 동작 관여. |
| `experimental.text.complete(input, output)` | 텍스트 완성 동작 관여. |

특수 object-shaped 등록:

| Field | Purpose |
| ----- | ------- |
| `tool` | 커스텀 도구 정의. |
| `auth` | 인증 관련 확장. |
| `provider` | provider 관련 확장. |

## 6. V2 Context Plugin Shape

V2 Promise API:

```ts
import { define } from "@opencode-ai/plugin/v2/promise";

export const Plugin = define({
  id: "my-plugin",
  setup: async (ctx) => {
    await ctx.agent.transform((agents) => {
      agents.update("reviewer", (agent) => {
        agent.description = "Reviews code for regressions";
        agent.mode = "subagent";
      });
    });
  },
});
```

V2 Effect API:

```ts
import { define } from "@opencode-ai/plugin/v2/effect";
import { Effect } from "effect";

export const Plugin = define({
  id: "my-plugin",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform((agents) => {
      agents.update("reviewer", (agent) => {
        agent.description = "Reviews code for regressions";
        agent.mode = "subagent";
      });
    });
  }),
});
```

필수 규칙:

- `id`는 플러그인을 식별하는 안정적인 문자열이다.
- setup/effect는 훅을 명령형으로 등록한다.
- V2 plugin setup은 hook object를 반환하지 않는다.
- 플러그인 옵션은 `ctx.options`에서 읽는다.
- registration은 plugin scope가 닫히면 제거된다.
- 조기 제거가 필요하면 registration의 `dispose`를 호출한다.

## 7. V2 Transform Hooks

Transform hook은 stateful domain을 다시 계산하는 방식으로 확장한다.

```ts
await ctx.agent.transform((agents) => {
  agents.update("reviewer", (agent) => {
    agent.description = "Reviews code for regressions";
    agent.mode = "subagent";
  });
});
```

사용 가능한 domain:

```ts
ctx.agent.transform
ctx.catalog.transform
ctx.command.transform
ctx.integration.transform
ctx.reference.transform
ctx.skill.transform
```

동작 규칙:

- transform이 등록되거나 제거되면 해당 domain은 fresh state에서 다시 계산된다.
- 모든 active transform은 등록 순서대로 실행된다.
- 뒤에 등록된 transform은 앞 transform의 변경 결과를 관찰한다.
- transform은 자기 domain에 대한 변경만 책임져야 한다.

## 8. V2 Runtime Hooks

Runtime hook은 live operation을 가로챈다. domain을 재계산하는 transform과 다르다.

```ts
await ctx.aisdk.sdk(async (event) => {
  if (event.package !== "@ai-sdk/xai") return;
  const mod = await import("@ai-sdk/xai");
  event.sdk = mod.createXai(event.options);
});

await ctx.aisdk.language((event) => {
  if (event.model.providerID !== "xai") return;
  event.language = event.sdk.responses(event.model.api.id);
});
```

Runtime hook은 등록 순서대로 실행되며, 뒤 hook은 앞 hook이 변경한 값을 볼 수 있다.

## 9. Reloading Stateful Domains

플러그인이 외부 파일, 원격 데이터, 옵션 등 transform callback 밖의 상태를 캡처한다면 데이터 변경 후 해당 domain reload를 호출해야 한다.

```ts
let data = await loadExternalData();

await ctx.catalog.transform((catalog) => {
  applyCatalog(data, catalog);
});

data = await loadExternalData();
await ctx.catalog.reload();
```

사용 가능한 reload:

```ts
ctx.agent.reload()
ctx.catalog.reload()
ctx.command.reload()
ctx.integration.reload()
ctx.reference.reload()
ctx.skill.reload()
```

Reload는 개별 registration이 아니라 domain에 속한다. `ctx.agent.reload()`는 모든 active agent transform을 다시 실행한다.

## 10. Configuration Design Rules

플러그인 옵션은 다음 원칙을 따른다.

- 옵션은 plugin config entry의 `options` 또는 tuple/object form으로 전달한다.
- 옵션 스키마는 플러그인 내부에서 명시적으로 검증한다.
- 잘못된 옵션은 조용히 무시하지 말고 진단 가능한 경고나 오류로 처리한다.
- 플러그인 옵션과 opencode core config 필드를 혼동하지 않는다.
- 로컬 파일 경로 옵션은 선언한 config 파일 기준 상대 경로인지, 작업공간 기준 상대 경로인지 명확히 정한다.

예시:

```jsonc
{
  "plugins": [
    {
      "package": "@my-org/reviewer-plugin",
      "options": {
        "agentName": "reviewer",
        "strict": true
      }
    }
  ]
}
```

## 11. Error Handling

플러그인 오류는 단계별로 구분한다.

| Stage | Typical cause | Expected behavior |
| ----- | ------------- | ----------------- |
| install | package install failure | 설치 명령 실패와 원인 보고. |
| entry | missing export or unsupported entrypoint | 패키지 형식 문제로 보고. |
| compatibility | incompatible runtime or API surface | 호환성 오류로 보고. |
| load | import or setup failure | 플러그인 로드 실패로 보고. |
| runtime | hook callback failure | 해당 작업 실패 또는 세션 오류로 보고. |

플러그인은 다음 기준을 지킨다.

- 개별 플러그인 실패가 가능한 한 전체 런타임 실패가 되지 않게 한다.
- 실패 메시지는 플러그인 ID 또는 package spec, 단계, 원인을 포함한다.
- 비밀 값과 전체 환경 변수는 로그에 출력하지 않는다.
- cleanup이 필요한 registration이나 resource는 dispose한다.

## 12. Agent-providing Plugins

플러그인에서 에이전트를 제공하려면 `ctx.agent.transform`을 사용한다.

```ts
await ctx.agent.transform((agents) => {
  agents.update("reviewer", (agent) => {
    agent.description = "Reviews code for regressions";
    agent.mode = "subagent";
    agent.model = "anthropic/claude-sonnet-4-6";
    agent.system = "You are a strict reviewer...";
    agent.permissions = [
      { action: "edit", resource: "*", effect: "deny" },
    ];
  });
});
```

에이전트 작성 형식과 권한 규칙은 [opencode-agent-development-reference.md](opencode-agent-development-reference.md)를 따른다.

## 13. Verification Checklist

플러그인 개발 완료 전 확인한다.

- [ ] 플러그인 export가 대상 API 형식과 일치한다.
- [ ] plugin ID 또는 package spec이 안정적이다.
- [ ] config entry와 local discovery 중 어떤 방식으로 로드되는지 문서화했다.
- [ ] 옵션 스키마와 기본값이 명확하다.
- [ ] transform hook은 필요한 domain만 변경한다.
- [ ] runtime hook은 input/output 변경 범위를 최소화한다.
- [ ] hook 실행 순서에 의존하는 경우 그 의존성을 주석 또는 문서에 남겼다.
- [ ] 외부 데이터 변경 후 필요한 domain reload를 호출한다.
- [ ] 오류 메시지는 단계와 원인을 포함하고 비밀을 노출하지 않는다.
- [ ] 에이전트를 제공하는 경우 에이전트 개발 레퍼런스의 검증 항목도 통과한다.

