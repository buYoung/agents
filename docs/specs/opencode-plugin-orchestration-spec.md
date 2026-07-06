# opencode Plugin Orchestration Spec

## 1. Purpose

이 문서는 opencode 플러그인의 등록, scope, transform, runtime hook, reload orchestration 규칙을 정의한다. 특정 플러그인의 업무 흐름을 설명하지 않는다. 플러그인 작성자는 이 문서만 보고 stateful domain 변경과 live operation hook을 분리해 설계할 수 있어야 한다.

## 2. Core Concepts

| Concept | Meaning |
| ------- | ------- |
| Plugin scope | 플러그인 등록과 생명주기를 묶는 범위. scope가 닫히면 registration이 제거된다. |
| Registration | transform 또는 runtime hook 등록 결과. 조기 제거가 필요하면 `dispose`한다. |
| Transform hook | stateful domain을 fresh state에서 다시 계산하는 hook. |
| Runtime hook | live operation을 가로채거나 변경하는 hook. |
| Domain reload | 특정 domain의 모든 active transform을 다시 실행하는 동작. |
| Registration order | transform과 runtime hook 실행 순서에 영향을 주는 등록 순서. |

## 3. Transform Versus Runtime Hook

| Hook kind | Runs when | Mutates |
| --------- | --------- | ------- |
| Transform hook | registration, disposal, reload, domain rebuild | stateful domain draft |
| Runtime hook | live operation execution | current event/input/output |

Transform은 에이전트, 카탈로그, 명령, 참조, 스킬 같은 domain state를 만든다. Runtime hook은 채팅, 도구 실행, 모델 SDK 선택 같은 실행 중 동작에 관여한다.

규칙:

- runtime hook은 domain rebuild 때문에 자동 재실행된다고 가정하지 않는다.
- transform은 live operation을 직접 가로채는 용도로 사용하지 않는다.
- transform과 runtime hook을 같은 책임으로 섞지 않는다.

## 4. Transform Registration

Promise API 예시:

```ts
await ctx.agent.transform((agents) => {
  agents.update("reviewer", (agent) => {
    agent.description = "Reviews changes for regressions";
    agent.mode = "subagent";
  });
});
```

Effect API 예시:

```ts
yield* ctx.catalog.transform((catalog) => {
  catalog.provider.update("example", (provider) => {
    provider.name = "Example";
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

규칙:

- transform callback은 해당 domain의 draft만 변경한다.
- 여러 플러그인이 같은 domain을 변경하면 등록 순서가 의미를 가진다.
- 같은 ID의 entry를 교체하거나 갱신할 때는 기존 위치와 충돌 정책을 문서화한다.
- plugin scope가 닫히면 해당 scope의 transform registration은 제거되어야 한다.

## 5. Runtime Hook Registration

Runtime hook은 live operation을 다룬다.

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

규칙:

- hook은 등록 순서대로 실행된다.
- 뒤 hook은 앞 hook의 변경 결과를 볼 수 있다.
- hook은 자신이 책임지는 event/input/output만 변경한다.
- hook callback 실패가 전체 런타임을 중단할지, 해당 요청만 실패시킬지 플러그인별로 정한다.

## 6. Reload Semantics

외부 데이터나 옵션이 transform callback 밖에서 변경되면 해당 domain reload를 호출한다.

```ts
let data = await loadExternalData();

await ctx.agent.transform((agents) => {
  applyAgents(data, agents);
});

data = await loadExternalData();
await ctx.agent.reload();
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

규칙:

- reload는 개별 registration이 아니라 domain에 속한다.
- reload는 해당 domain의 모든 active transform을 다시 실행한다.
- reload는 fresh domain state에서 시작해야 한다.
- reload 순서를 다른 domain에 암묵적으로 의존하지 않는다.
- 여러 domain을 바꿔야 하면 각각의 reload 책임을 명시한다.

## 7. Boot Batching

부팅 중 여러 transform registration이 한꺼번에 추가될 수 있다.

규칙:

- boot batching 동안 동일 domain의 불필요한 반복 rebuild를 피한다.
- 부팅이 끝난 뒤 domain 최종 상태가 등록 순서를 반영해야 한다.
- deferred activation이 있다면 사용자가 관찰할 수 있는 중간 상태를 문서화한다.
- batching은 실행 순서 계약을 바꾸면 안 된다.

## 8. Cross-domain Dependencies

플러그인은 한 domain의 데이터가 다른 domain transform에 영향을 주도록 설계할 수 있다. 이때 runtime이 의존성을 자동 추론한다고 가정하지 않는다.

규칙:

- cross-domain read가 필요한 경우 어느 domain이 source of truth인지 문서화한다.
- 한 domain의 reload가 다른 domain reload까지 자동으로 보장된다고 쓰지 않는다.
- cross-domain consistency가 필요하면 명시적인 reload 순서나 이벤트 구독을 둔다.
- 여러 domain 변경을 하나의 원자적 트랜잭션처럼 설명하지 않는다.

예시:

```ts
await ctx.integration.transform((integrations) => {
  integrations.update("docs", (integration) => {
    integration.enabled = true;
  });
});

await ctx.reference.transform((references) => {
  references.update("docs", (reference) => {
    reference.source = "docs";
  });
});
```

## 9. Disposal And Replacement

registration은 scope 또는 수동 dispose로 제거된다.

```ts
const registration = await ctx.agent.transform(applyAgents);
await registration.dispose();
```

규칙:

- dispose 후 해당 registration의 transform은 다음 rebuild에 참여하지 않는다.
- same-ID replacement는 기존 entry와 새 entry의 순서 정책을 유지해야 한다.
- disable 옵션이 있으면 registration 제거, transform no-op, entry disabled 중 어떤 모델인지 정한다.
- scope 없는 전역 등록을 기본으로 삼지 않는다.

## 10. Error Boundaries

| Failure | Expected behavior |
| ------- | ----------------- |
| transform registration failure | 플러그인 로드 또는 해당 domain 구성 실패로 보고한다. |
| transform callback failure | 해당 domain rebuild 실패로 보고한다. |
| runtime hook failure | 해당 live operation 실패 또는 세션 오류로 보고한다. |
| reload failure | 이전 domain state 유지 여부를 명시하고 오류를 보고한다. |
| dispose failure | resource cleanup 실패로 보고하고 후속 상태를 명시한다. |

오류 메시지는 plugin ID, domain 또는 hook 이름, 원인을 포함해야 한다.

## 11. Verification Checklist

- [ ] transform과 runtime hook의 책임이 분리되어 있다.
- [ ] 등록 순서 의존성이 문서화되어 있다.
- [ ] scope 종료와 dispose 동작이 정의되어 있다.
- [ ] 외부 데이터 변경 후 필요한 reload가 호출된다.
- [ ] reload가 domain 단위라는 점이 명확하다.
- [ ] cross-domain 의존성을 자동 추론으로 설명하지 않았다.
- [ ] boot batching이 최종 순서 계약을 깨지 않는다.
- [ ] 오류 경계가 domain/hook/stage별로 구분되어 있다.

