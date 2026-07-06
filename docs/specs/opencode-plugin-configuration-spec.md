# opencode Plugin Configuration Spec

## 1. Purpose

이 문서는 opencode 플러그인의 구성 형식과 구성 로딩 경계를 정의한다. 특정 플러그인의 옵션을 설명하지 않는다. 플러그인 작성자는 이 문서만 보고 package-loaded plugin, local plugin, plugin options, configuration validation, restart behavior를 설계할 수 있어야 한다.

## 2. Configuration Surfaces

opencode 플러그인 구성은 두 표면으로 나뉜다.

| Surface | Purpose | Config ownership |
| ------- | ------- | ---------------- |
| Package-loaded plugin | 배포 가능한 플러그인을 구성에서 선언한다. | opencode config의 `plugins` 목록. |
| Local plugin | 프로젝트 안의 로컬 파일을 자동 발견한다. | `.opencode/plugin/` 또는 `.opencode/plugins/` 디렉터리. |

두 표면은 같은 플러그인 시스템으로 로드되지만 작성 계약은 다르다. `plugins` 목록은 패키지 로딩형 플러그인 선언을 담당하고, 로컬 플러그인 파일은 디렉터리 발견 규칙을 따른다.

## 3. `plugins` Field

권장 v2 구성은 `plugins` 필드를 사용한다.

```jsonc
{
  "plugins": [
    "opencode-example-plugin",
    {
      "package": "@my-org/opencode-review-plugin",
      "options": {
        "strict": true,
        "agentName": "reviewer"
      }
    }
  ]
}
```

규칙:

- `plugins`는 순서 있는 목록이다.
- 목록 순서는 훅 등록과 실행 결과에 영향을 줄 수 있다.
- 문자열 항목은 package spec이다.
- 객체 항목은 최소한 `package`를 가진다.
- `options`는 해당 플러그인에 전달되는 플러그인 전용 옵션이다.
- `options`는 opencode core config와 섞지 않는다.
- 임의 로컬 파일 경로나 file URL은 `plugins`의 기본 v2 작성 방식으로 사용하지 않는다. 로컬 플러그인은 디렉터리 발견 규칙을 따른다.

호환을 위해 legacy `plugin` 필드를 다룰 수 있지만, 새 문서와 새 구성 예시는 `plugins`를 기본으로 한다.

## 4. Local Plugin Discovery

로컬 플러그인은 구성 목록에 넣지 않아도 자동 발견된다.

```text
.opencode/plugin/*.ts
.opencode/plugin/*.js
.opencode/plugins/*.ts
.opencode/plugins/*.js
```

규칙:

- 로컬 플러그인은 프로젝트 전용 확장과 빠른 실험에 적합하다.
- 로컬 플러그인 파일은 플러그인 모듈 export 계약을 그대로 따라야 한다.
- 로컬 플러그인의 로딩 순서가 결과에 영향을 줄 수 있으면 파일명이나 문서로 순서 의존성을 명시한다.
- 로컬 플러그인과 package-loaded plugin이 같은 domain을 수정하면 순서와 충돌 정책을 문서화한다.

## 5. Plugin Options

플러그인 옵션은 플러그인 내부에서 명시적으로 검증한다.

예시:

```jsonc
{
  "plugins": [
    {
      "package": "@my-org/opencode-review-plugin",
      "options": {
        "agentName": "reviewer",
        "strict": true,
        "disabled": false
      }
    }
  ]
}
```

권장 TypeScript shape:

```ts
type ReviewPluginOptions = {
  agentName?: string;
  strict?: boolean;
  disabled?: boolean;
};
```

규칙:

- 옵션의 기본값은 플러그인 내부에서 한 곳에 정의한다.
- 알 수 없는 옵션을 허용할지 거부할지 정하고 문서화한다.
- 잘못된 옵션은 조용히 무시하지 않는다.
- 옵션 검증 오류는 플러그인 ID 또는 package spec과 원인을 포함해야 한다.
- 비활성 named entry에는 `disabled`를 사용한다.

## 6. Legacy Compatibility

기존 구성과 호환해야 하면 legacy 필드와 v2 필드를 명시적으로 분리한다.

| Legacy | V2 | Migration rule |
| ------ | -- | -------------- |
| `plugin` | `plugins` | 순서를 유지한 채 목록을 변환한다. |
| tuple entry `["pkg", options]` | `{ "package": "pkg", "options": options }` | tuple의 첫 번째 값은 `package`, 두 번째 값은 `options`로 옮긴다. |
| configured local path | local discovery | 파일을 `.opencode/plugin/` 또는 `.opencode/plugins/` 아래로 이동한다. |

마이그레이션 시 순서 계약을 유지해야 한다. 같은 플러그인이 중복 선언되면 어떤 항목이 유효한지 명시해야 한다.

## 7. Restart And Reload Behavior

구성 파일 변경은 일반적으로 재시작 후 반영되는 동작으로 문서화한다.

규칙:

- hot reload를 기본 동작으로 약속하지 않는다.
- transform이 외부 데이터를 캡처하고 자체 reload를 제공하는 경우에만 해당 domain reload를 설명한다.
- 구성 변경 후 재시작이 필요한 경우 사용자 안내와 오류 복구 절차를 제공한다.
- 플러그인 옵션이 런타임 중 변경될 수 있는지 여부는 플러그인별로 명시한다.

## 8. Error Handling

구성 오류는 단계별로 보고한다.

| Error class | Expected behavior |
| ----------- | ----------------- |
| Invalid JSON/JSONC | 구성 파일 경로와 파싱 오류를 보고한다. |
| Invalid plugin entry | 잘못된 항목의 index 또는 package spec을 보고한다. |
| Invalid options | 플러그인 ID와 옵션 경로를 보고한다. |
| Missing package | install 또는 load 단계에서 package spec을 보고한다. |
| Duplicate plugin | 중복 처리 정책을 적용하고 경고한다. |

비밀 값, 토큰, 전체 환경 변수는 오류 메시지에 포함하지 않는다.

## 9. Examples

### 9.1 Minimal package plugin

```jsonc
{
  "plugins": ["opencode-reviewer"]
}
```

### 9.2 Package plugin with options

```jsonc
{
  "plugins": [
    {
      "package": "@my-org/opencode-reviewer",
      "options": {
        "agentName": "reviewer",
        "strict": true
      }
    }
  ]
}
```

### 9.3 Local plugin

```text
.opencode/plugins/reviewer.ts
```

```ts
import type { Plugin } from "@opencode-ai/plugin";

export default (async () => {
  return {};
}) satisfies Plugin;
```

## 10. Verification Checklist

- [ ] 문서와 예시는 `plugins`를 기본으로 사용한다.
- [ ] legacy `plugin`은 호환 또는 마이그레이션 문맥에서만 등장한다.
- [ ] 로컬 플러그인과 package-loaded plugin의 경계를 구분했다.
- [ ] `plugins` 목록 순서가 의미 있는 계약임을 명시했다.
- [ ] 플러그인 옵션 스키마와 기본값이 문서화되어 있다.
- [ ] 잘못된 옵션 처리 방식이 정의되어 있다.
- [ ] 구성 변경 후 재시작 또는 reload 동작이 명확하다.
- [ ] 오류 메시지가 단계, 플러그인 식별자, 원인을 포함한다.

