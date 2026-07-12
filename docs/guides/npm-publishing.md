# `@livteam/agents-cli` npm 등록과 배포

이 문서는 npm 공개를 맡은 운영자를 위한 안내입니다. GitHub Release는 서명된 원본 CLI·플러그인 배포 파일과 과거 `agents upgrade`를 유지하고, npm은 새 사용자의 설치와 npm을 통한 CLI 갱신을 제공합니다. npm 공개는 서명까지 확인한 GitHub Release가 먼저 있어야 합니다.

공식 안내: [조직 만들기](https://docs.npmjs.com/creating-an-organization/), [범위 패키지 공개](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/), [신뢰할 수 있는 배포](https://docs.npmjs.com/trusted-publishers/), [GitHub OIDC 권한](https://docs.github.com/en/actions/reference/security/oidc).

## 1. 시작 전 권한 확인

1. npm 웹에서 `livteam` 조직이 있는지 확인합니다. 없으면 조직을 만들고, 있으면 새로 만들지 말고 조직 소유자에게 배포 권한을 요청합니다.
2. 배포자는 필요한 사람만 포함한 팀에서 `@livteam/agents-cli`의 `read-write` 권한을 받아야 합니다. 조직 전체에 넓은 권한을 주지 않습니다.
3. 사람의 수동 배포를 위해 npm 계정에 2단계 인증을 켭니다. 자세한 정책은 [npm의 2단계 인증 안내](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/)를 따릅니다.
4. 개인 컴퓨터에서 로그인 계정과 권한을 확인합니다.

```sh
npm login --auth-type=web
npm whoami
npm view @livteam/agents-cli version
```

마지막 명령이 버전을 출력하면 같은 버전이나 이름을 다시 공개하지 마세요. `E404`만으로 이름을 쓸 수 있다고 단정할 수는 없습니다. 비공개 패키지에 권한이 없을 때도 같은 결과가 날 수 있으므로, 반드시 조직 권한이 있는 계정으로 확인합니다.

로그인 과정에서 개인 홈 디렉터리의 `.npmrc`에 인증 정보가 생길 수 있습니다. 이 파일, `.env`, npm 토큰은 저장소에 넣거나 커밋하거나 GitHub 비밀값으로 등록하지 마세요.

## 2. 최초 공개 배포

필요한 도구는 `node`, `npm`, `mktemp`입니다. 아래 모든 명령은 저장소 최상위 폴더에서 시작합니다. 먼저 기존 `release.yml`로 GitHub Release를 성공적으로 만들고 서명 검증까지 마치세요. Release 자산에는 `livteam-agents-cli-<version>.tar.gz`가 있어야 합니다. 이 파일은 npm용 독립 묶음이며 과거 자체 갱신용 `agents-cli-<version>.tar.gz`와 다릅니다.

### 준비

Release 태그와 버전은 한 번만 정합니다. `AGENTS_RELEASE_PUBLIC_KEY_BASE64`에는 저장소의 공개키 변수를 넣습니다. 공개키는 npm 토큰이 아니며, 값을 모르면 배포 담당자에게 요청하세요.

```sh
export RELEASE_TAG="v0.1.2"
export RELEASE_VERSION="${RELEASE_TAG#v}"
export AGENTS_RELEASE_PUBLIC_KEY_BASE64='여기에_저장소_공개키_변수값을_붙여_넣으세요'
export PACKAGE_DIRECTORY="$(mktemp -d)/package"
```

따옴표 안의 문구 전체를 저장소 변수 `AGENTS_RELEASE_PUBLIC_KEY_BASE64`에 등록된 실제 Base64 공개키 값으로 바꾸세요. 꺾쇠괄호는 설명에서만 쓰고 명령에는 넣지 않습니다.

### 검증

다음 명령은 서명된 배포 목록에 있는 npm 묶음의 해시, 이름, 버전, 포함 파일과 `agents --help`를 확인한 뒤 검증한 내용을 `PACKAGE_DIRECTORY`에 풉니다. 묶음을 따로 다시 내려받거나 직접 압축 해제하지 마세요.

```sh
node scripts/release/verify.mjs --remote --tag "$RELEASE_TAG" --require-signature --npm-package-directory "$PACKAGE_DIRECTORY"
npm pack --dry-run "$PACKAGE_DIRECTORY"
npm publish --dry-run --access public "$PACKAGE_DIRECTORY"
```

두 `dry-run` 명령은 실제 공개 없이 npm이 담을 파일과 공개 가능 여부를 보여 줍니다. `.npmrc`, `.env`, 개인 설정, 토큰 또는 예상 밖 파일이 보이면 중단하고 원인을 고치세요. `npm publish --dry-run`이 성공하고 패키지 이름이 `@livteam/agents-cli`, 버전이 `RELEASE_VERSION`인지 확인할 때까지 다음 단계로 가지 마세요.

### 실제 공개

아래 명령은 되돌릴 수 없습니다. 같은 npm 이름과 버전은 다시 공개할 수 없으므로, 앞 단계의 출력과 권한을 다른 배포 책임자와 다시 확인한 뒤 한 번만 실행하세요. 범위 패키지의 첫 공개에는 `--access public`이 꼭 필요합니다.

```sh
npm publish --access public "$PACKAGE_DIRECTORY"
```

### 사후 확인

깨끗한 임시 폴더에 설치해 실제 실행 파일을 확인합니다.

```sh
export VERIFY_DIRECTORY="$(mktemp -d)"
cd "$VERIFY_DIRECTORY"
npm install @livteam/agents-cli@"$RELEASE_VERSION"
./node_modules/.bin/agents --help
npm view @livteam/agents-cli version
```

`https://www.npmjs.com/package/@livteam/agents-cli`에서도 공개 상태와 버전을 확인하세요.

## 3. 이후 배포: GitHub Actions 권장 설정

최초 공개 뒤에는 장기 npm 토큰 대신 신뢰할 수 있는 배포를 사용합니다. 이는 GitHub Actions가 실행할 때마다 짧은 인증서를 받아 npm에 자신을 증명하는 방식입니다. npm 토큰을 저장할 필요가 없습니다.

1. npm 웹에서 **Packages → `@livteam/agents-cli` → Settings → Trusted Publisher**로 이동해 GitHub Actions를 선택합니다.
2. 다음 값을 입력하고 허용 동작으로 `npm publish`만 선택합니다. 입력값은 대소문자까지 일치해야 합니다.

| 입력 항목 | 이 저장소에서 가져올 값 |
| --- | --- |
| GitHub 조직 또는 사용자명 | `buYoung` |
| 저장소명 | `agents` |
| workflow 파일명 | `npm-publish.yml` |
| GitHub 환경명 | `npm-publish` |
| 허용 동작 | `npm publish` |

3. GitHub 저장소의 **Settings → Environments → New environment**에서 `npm-publish` 환경을 만듭니다. 신뢰한 배포자 승인, 보호된 기본 브랜치만 허용, 자기 승인 금지를 설정합니다.
4. `.github/workflows/npm-publish.yml`은 수동 실행만 허용합니다. 기본 브랜치에서 시작한 실행만 통과시키고, Release 태그는 입력값으로만 받습니다. 검증 프로그램은 입력 태그의 코드를 실행하지 않고 시작한 기본 브랜치의 커밋을 사용합니다.
5. 이 workflow는 GitHub가 제공하는 실행 환경에서 Node.js `22.14.0`, npm `11.5.1`을 사용합니다. 이는 신뢰할 수 있는 배포에 필요한 최소 버전입니다.
6. workflow에는 `contents: read`와 `id-token: write`만 있습니다. 앞의 권한은 Release 읽기, 뒤의 권한은 짧은 인증서 발급에 씁니다. 다른 저장소 쓰기 권한을 주지 않습니다.
7. `NPM_TOKEN`, `NODE_AUTH_TOKEN`, npm 토큰, 개인 `.npmrc` 또는 npm GitHub Secret을 추가하지 않습니다. GitHub의 기본 `GITHUB_TOKEN`도 npm 인증용이 아닙니다.

## 4. 이후 배포 순서

실제 Release는 GitHub Actions에서만 실행합니다. 로컬 `pnpm release`는 버전 파일을 변경하기 전에 차단됩니다. 로컬에서 배포 산출물만 확인하려면 `pnpm release:build -- --version <버전> --tag v<버전> --output <임시-경로>`를 사용하고, 생성된 서명 없는 결과를 실제 배포에 사용하지 마세요.

1. 버전을 올린 변경을 검토하고 `pnpm test`, `pnpm check-types`, Release 빌드·검증을 통과시킵니다.
2. 기존 `release.yml`을 실행해 새 GitHub Release를 만들고 서명 검증을 확인합니다.
3. 기본 브랜치에서 GitHub Actions의 `npm publish` workflow를 수동 실행하고, 방금 만든 정확한 태그(예: `v0.1.2`)를 입력합니다.
4. `npm-publish` 환경 승인을 마칩니다. workflow는 서명된 Release 목록의 npm 묶음을 검증하고, 검증한 내용만 npm 공개에 사용합니다. 같은 버전이 이미 npm에 있으면 중단합니다.
5. workflow가 성공하면 `npm view @livteam/agents-cli version`과 깨끗한 폴더의 `agents --help`로 다시 확인합니다.

## 5. 실패 확인과 재시도

먼저 입력한 태그의 GitHub Release와 서명, 태그 버전·npm 묶음 버전·공개하려는 버전의 일치를 확인하세요. 이어서 `npm pack --dry-run`과 `npm publish --dry-run`에서 비밀 파일이나 예상 밖 파일이 없는지, npm Trusted Publisher의 조직·저장소·workflow 파일명·환경명이 정확히 같은지 확인합니다.

| 실패 상황 | 처리 방법 |
| --- | --- |
| 환경 승인 누락, 일시적 네트워크 오류, Trusted Publisher 입력값 수정 | 올바른 Release와 서명이 그대로이고 같은 버전이 아직 npm에 없다면, 원인을 고친 뒤 같은 `npm publish` workflow를 다시 실행할 수 있습니다. |
| 묶음 내용·버전·서명 불일치, Release 자산이 바뀜 | 공개를 진행하거나 반복 실행하지 마세요. 배포 책임자와 새 Release 또는 새 버전이 필요한지 확인합니다. |
| 같은 버전이 이미 npm에 공개됨 | 다시 공개할 수 없습니다. npm의 공개 버전과 실제 동작을 확인한 뒤, 수정이 필요하면 새 버전으로 배포합니다. |
| 인증 오류 | GitHub-hosted runner, `id-token: write`, Node.js와 npm 최소 버전, Trusted Publisher의 모든 입력값을 차례로 확인합니다. 장기 토큰으로 우회하지 마세요. |

신뢰할 수 있는 배포 설정이나 Release 자산의 불일치를 고친 뒤에는 반드시 다시 검증하세요.
