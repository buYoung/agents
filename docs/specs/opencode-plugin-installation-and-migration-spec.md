# opencode Plugin Installation And Migration Spec

## 1. Purpose

이 문서는 opencode 플러그인의 설치, 업데이트, 제거, 구성 패치, legacy-to-v2 마이그레이션 기준을 정의한다. 특정 패키지 매니저나 특정 플러그인의 설치 스크립트를 설명하지 않는다.

## 2. Installation Entry Points

플러그인 설치는 여러 진입점에서 시작될 수 있다.

| Entry point | Purpose |
| ----------- | ------- |
| CLI install | 명령줄에서 package plugin을 설치하고 config를 패치한다. |
| TUI install | 사용자 인터페이스에서 package plugin을 선택하고 설치한다. |
| Manual config | 사용자가 config에 `plugins` 항목을 직접 추가한다. |
| Local discovery | 사용자가 `.opencode/plugin/` 또는 `.opencode/plugins/`에 파일을 둔다. |

CLI와 TUI 설치는 같은 결과를 만들어야 한다. 둘 다 package spec, manifest, compatibility, config patch를 같은 규칙으로 처리한다.

## 3. Package Plugin Install Flow

패키지 플러그인 설치 흐름:

1. package spec을 정규화한다.
2. package manager 또는 runtime install 위치를 결정한다.
3. package manifest를 읽는다.
4. plugin target 또는 entrypoint를 확인한다.
5. runtime compatibility를 검사한다.
6. config의 `plugins` 목록을 패치한다.
7. 필요한 경우 `package.json` 또는 dependency metadata를 생성하거나 갱신한다.
8. 사용자에게 재시작 필요 여부를 안내한다.

Package spec 예시:

```text
opencode-reviewer
opencode-reviewer@1.2.3
@my-org/opencode-reviewer
@my-org/opencode-reviewer@1.2.3
```

구성 패치 결과:

```jsonc
{
  "plugins": [
    {
      "package": "@my-org/opencode-reviewer",
      "options": {
        "agentName": "reviewer"
      }
    }
  ]
}
```

## 4. Local Plugin Flow

로컬 플러그인은 설치 명령보다 디렉터리 발견을 기본으로 한다.

```text
.opencode/plugins/reviewer.ts
```

규칙:

- 로컬 파일을 `plugins` 목록에 억지로 넣지 않는다.
- 기존 legacy local path config가 있으면 파일을 discovery directory로 이동하는 migration을 안내한다.
- 로컬 플러그인은 프로젝트 소유 파일이므로 uninstall이 임의 삭제하지 않는다.
- 로컬 플러그인 변경 후 반영 시점은 재시작 또는 명시적 reload 지원 여부에 따라 안내한다.

## 5. Compatibility Checks

설치 시 가능한 compatibility를 확인한다.

| Check | Purpose |
| ----- | ------- |
| package exists | package spec이 설치 가능한지 확인한다. |
| manifest target | server, TUI, 또는 v2 plugin target을 확인한다. |
| runtime version | 현재 opencode 런타임과 호환되는지 확인한다. |
| module format | ESM/CJS 또는 export shape가 지원되는지 확인한다. |
| duplicate entry | 이미 같은 plugin이 등록되어 있는지 확인한다. |

호환성 실패는 config를 변경하기 전에 보고하는 것이 원칙이다.

## 6. Config Patch Rules

설치 명령은 config를 패치할 때 다음을 지킨다.

- 기존 `plugins` 목록 순서를 보존한다.
- 새 플러그인은 기본적으로 목록 끝에 추가한다.
- 이미 같은 package spec이 있으면 중복 추가하지 않는다.
- 옵션을 추가할 때 기존 옵션을 임의로 삭제하지 않는다.
- legacy `plugin` 필드가 있으면 migration 여부를 묻거나 명시적 migration 모드에서만 변환한다.
- config 파일의 JSONC 주석 보존 여부를 정하고 문서화한다.

## 7. Generated Files

설치가 생성할 수 있는 파일:

| File | Purpose |
| ---- | ------- |
| opencode config | `plugins` 목록 패치. |
| `package.json` | package-managed install metadata. |
| lockfile | package manager dependency lock. |
| `node_modules` or runtime cache | 설치된 plugin package. |

규칙:

- 생성 파일은 설치 전 사용자에게 알려야 한다.
- 기존 사용자 파일을 덮어쓸 때는 백업 또는 diff 안내를 제공한다.
- 실패 중간 상태에서 복구 방법을 제공한다.

## 8. Legacy-to-v2 Migration

Migration mapping:

| Legacy | V2 | Rule |
| ------ | -- | ---- |
| `plugin` | `plugins` | 순서 유지. |
| `"pkg"` | `"pkg"` | 문자열 package spec은 그대로 유지. |
| `["pkg", options]` | `{ "package": "pkg", "options": options }` | tuple을 객체로 변환. |
| configured local path | local discovery directory | 파일을 `.opencode/plugin/` 또는 `.opencode/plugins/`로 이동. |
| file URL | local discovery or package install | 사용 목적에 따라 분리. |

마이그레이션 규칙:

- 순서 계약을 보존한다.
- migration 전후 로드되는 플러그인 집합이 같아야 한다.
- 변환할 수 없는 항목은 자동 삭제하지 않고 사용자 조치로 남긴다.
- legacy와 v2 필드가 함께 있으면 어느 쪽이 우선인지 명시한다.

## 9. Update And Uninstall

지원하는 경우에만 update/uninstall 동작을 문서화한다. 지원하지 않는 명령을 암묵적으로 약속하지 않는다.

Update 규칙:

- package spec의 pinned version을 변경할지, latest를 다시 해석할지 명시한다.
- compatibility check를 다시 수행한다.
- 기존 options를 보존한다.
- 실패 시 기존 설치 상태를 유지한다.

Uninstall 규칙:

- package-loaded plugin은 config entry와 package dependency를 제거할 수 있다.
- 사용자 작성 local plugin 파일은 기본적으로 삭제하지 않는다.
- shared dependency를 제거할 때 다른 plugin이 쓰는지 확인한다.
- 제거 후 재시작 필요 여부를 안내한다.

## 10. Force And Global Options

설치 도구가 제어 옵션을 제공한다면 의미를 명확히 한다.

| Option | Expected meaning |
| ------ | ---------------- |
| `--force` | compatibility 또는 duplicate guard를 우회할 수 있다. 위험을 출력해야 한다. |
| `--global` | 사용자 범위 config에 설치한다. |
| `--project` | 프로젝트 범위 config에 설치한다. |
| `--dry-run` | 파일 변경 없이 예정 변경을 출력한다. |

옵션이 구현되지 않았다면 문서에 넣지 않는다.

## 11. Restart And Recovery

설치, 제거, 마이그레이션 후에는 보통 opencode 재시작을 안내한다.

복구 안내:

- broken config면 마지막 변경 entry를 제거하거나 비활성화한다.
- broken package면 package entry를 제거하거나 version을 되돌린다.
- local plugin 문제면 파일명을 임시로 바꾸거나 discovery directory 밖으로 이동한다.
- 옵션 오류면 plugin options를 기본값으로 줄인다.

비상 회피 수단:

```jsonc
{
  "plugins": [
    {
      "package": "@my-org/opencode-reviewer",
      "options": {
        "disabled": true
      }
    }
  ]
}
```

플러그인이 자체 `disabled` 옵션을 지원한다면 이 옵션은 setup 초기에 확인되어야 한다.

## 12. Verification Checklist

- [ ] CLI와 TUI 설치가 같은 결과를 만든다.
- [ ] package spec 정규화 규칙이 있다.
- [ ] manifest와 entrypoint를 config patch 전에 확인한다.
- [ ] compatibility 실패 시 config를 변경하지 않는다.
- [ ] `plugins` 목록 순서를 보존한다.
- [ ] local plugin은 discovery directory로 안내한다.
- [ ] legacy `plugin`에서 `plugins`로의 migration이 순서를 보존한다.
- [ ] generated files와 rollback 방법이 문서화되어 있다.
- [ ] update/uninstall은 지원하는 경우에만 문서화되어 있다.
- [ ] 설치 후 재시작 또는 reload 안내가 명확하다.

