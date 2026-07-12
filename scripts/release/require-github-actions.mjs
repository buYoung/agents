const isGitHubActions = process.env.GITHUB_ACTIONS === "true";

if (!isGitHubActions) {
  console.error(
    "Release는 로컬에서 실행할 수 없습니다. GitHub Actions의 Release workflow를 사용하세요. 로컬 산출물 검증은 pnpm release:build를 사용하세요.",
  );
  process.exit(1);
}

const requiredEnvironmentVariables = [
  "GITHUB_TOKEN",
  "AGENTS_RELEASE_SIGNING_KEY",
  "AGENTS_RELEASE_PUBLIC_KEY_BASE64",
];
const missingEnvironmentVariables = requiredEnvironmentVariables.filter(
  (variableName) => !process.env[variableName],
);

if (missingEnvironmentVariables.length > 0) {
  console.error(
    `Release에 필요한 GitHub Actions 환경변수가 없습니다: ${missingEnvironmentVariables.join(", ")}`,
  );
  process.exit(1);
}
