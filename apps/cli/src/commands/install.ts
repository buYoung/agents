import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXIT_BLOCKED,
  EXIT_VALID,
  EXIT_WARNING,
  OPENCODE_CONFIG_SCHEMA,
  OPENCODE_PLUGIN_ENTRY,
} from "@cli/constants";
import {
  restoreFileSnapshot,
  snapshotFile,
  writeFileBackup,
} from "@cli/fs-utils";
import { readInstallState, writeInstallState } from "@cli/install-state";
import {
  ensurePluginEntry,
  ensureProvider,
  readNativeOpencodeConfig,
  writeNativeOpencodeConfig,
} from "@cli/native-config";
import {
  getInstallStatePath,
  getNativeOpencodeConfigPath,
  getPackageRoot,
  resolveProjectDirectory,
  resolveUserConfigDirectory,
} from "@cli/paths";
import type { CliIO } from "@cli/types";
import { ReleaseManifestError } from "@cli/types";
import { assertLatestManifestCompatibility, readLatestManifest, reportReleaseManifestError } from "@cli/release";
import { readOpencodeScope, readTargets } from "@cli/lifecycle/args";
import { areLifecyclePlansEqual, executeLifecycle, hasInterruptedLifecycle, planLifecycle } from "@cli/lifecycle/orchestrator";
import { createRemoteTargetPlanEnvironment, stageRemoteTargetSources, verifyOpencodeExecutable } from "@cli/lifecycle/targets";
import { confirmLifecyclePlan, selectLifecycleTargets } from "@cli/interactive";

function getAgentsExamplePath(): string {
  const packageRoot = getPackageRoot();
  if (packageRoot) {
    return path.join(
      packageRoot,
      "..",
      "..",
      "packages",
      "opencode",
      "agents.example.toml",
    );
  }
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    "packages",
    "opencode",
    "agents.example.toml",
  );
}

export async function install(
  args: string[],
  io: Required<CliIO>,
): Promise<number> {
  let targets = readTargets(args);
  let interactiveSelection: Awaited<ReturnType<typeof selectLifecycleTargets>> | undefined;
  if (!targets && io.isInteractive) {
    interactiveSelection = await selectLifecycleTargets(io);
    if (!interactiveSelection) {
      io.stdout("작업을 취소했습니다. 파일은 변경하지 않았습니다.");
      return EXIT_VALID;
    }
    targets = interactiveSelection.targets;
  }
  if (targets) {
    const scope = interactiveSelection?.scope ?? readOpencodeScope(args);
    if (targets.includes("opencode") && !scope) {
      io.stderr("OpenCode 설치에는 --opencode-scope user 또는 project를 명시해야 합니다. 기존 --scope도 사용할 수 있습니다.");
      return EXIT_BLOCKED;
    }
    const projectDirectory = resolveProjectDirectory(args, io.cwd);
    let stagedSources: Awaited<ReturnType<typeof stageRemoteTargetSources>> | undefined;
    let sourceEnv = io.env;
    try {
      const adopt = args.includes("--adopt") || interactiveSelection?.adopt === true;
      if (interactiveSelection) {
        if (hasInterruptedLifecycle(io.env)) {
          io.stderr("이전 수명주기 복구가 필요합니다. 자동 복구가 표시한 계획을 바꾸지 않도록 현재 상태를 다시 검토하세요.");
          return EXIT_BLOCKED;
        }
        let latest: Awaited<ReturnType<typeof readLatestManifest>> | undefined;
        try {
          latest = await readLatestManifest(io.env);
          assertLatestManifestCompatibility(latest, projectDirectory, "update");
          sourceEnv = createRemoteTargetPlanEnvironment(latest, targets, io.env);
        } catch (error) {
          if (io.env.AGENTS_RELEASE_URL || !(error instanceof ReleaseManifestError) || !error.message.startsWith("배포 주소 확인 실패:")) throw error;
        }
        const plan = planLifecycle(
          targets,
          "install",
          projectDirectory,
          sourceEnv,
          { scope: scope ?? undefined, adopt, allowDowngrade: args.includes("--allow-downgrade") },
        );
        if (!await confirmLifecyclePlan(io, "install", plan)) {
          io.stdout("작업을 취소했습니다. 파일은 변경하지 않았습니다.");
          return EXIT_VALID;
        }
        const confirmedPlan = planLifecycle(
          targets,
          "install",
          projectDirectory,
          sourceEnv,
          { scope: scope ?? undefined, adopt, allowDowngrade: args.includes("--allow-downgrade") },
        );
        if (!areLifecyclePlansEqual(plan, confirmedPlan)) {
          io.stderr("확인 후 대상 상태, 관리 파일 또는 배포 버전이 바뀌어 원격 artifact를 받거나 표시한 계획을 실행하지 않았습니다. 현재 상태를 다시 검토하세요.");
          return EXIT_BLOCKED;
        }
        if (latest) {
          stagedSources = await stageRemoteTargetSources(latest, targets, io.env);
          sourceEnv = stagedSources.env;
          const stagedPlan = planLifecycle(
            targets,
            "install",
            projectDirectory,
            sourceEnv,
            { scope: scope ?? undefined, adopt, allowDowngrade: args.includes("--allow-downgrade") },
          );
          if (!areLifecyclePlansEqual(plan, stagedPlan)) {
            io.stderr("배포 artifact 또는 대상 상태가 확인 화면과 달라 표시한 계획을 실행하지 않았습니다. 현재 상태를 다시 검토하세요.");
            return EXIT_BLOCKED;
          }
        }
        const results = executeLifecycle(
          targets,
          "install",
          projectDirectory,
          sourceEnv,
          { scope: scope ?? undefined, adopt, allowDowngrade: args.includes("--allow-downgrade"), expectedPlan: plan },
        );
        return reportLifecycleResults(results, targets, sourceEnv, io);
      }
      try {
        const latest = await readLatestManifest(io.env);
        assertLatestManifestCompatibility(latest, projectDirectory, "update");
        const staged = await stageRemoteTargetSources(latest, targets, io.env);
        stagedSources = staged;
        sourceEnv = staged.env;
      } catch (error) {
        if (io.env.AGENTS_RELEASE_URL || !(error instanceof ReleaseManifestError) || !error.message.startsWith("배포 주소 확인 실패:")) throw error;
      }
      const results = executeLifecycle(
        targets,
        "install",
        projectDirectory,
        sourceEnv,
        { scope: scope ?? undefined, adopt, allowDowngrade: args.includes("--allow-downgrade") },
      );
      return reportLifecycleResults(results, targets, sourceEnv, io);
    } catch (error) {
      if (reportReleaseManifestError(error, io)) return EXIT_BLOCKED;
      io.stderr(`install-failed: ${error instanceof Error ? error.message : String(error)}`);
      return EXIT_BLOCKED;
    } finally {
      stagedSources?.cleanup();
    }
  }
  const scopeIndex = args.indexOf("--scope");
  const scope = scopeIndex >= 0 ? args[scopeIndex + 1] : undefined;
  if (scope !== "user" && scope !== "project") {
    io.stderr("install에는 --target codex, opencode 또는 all이 필요합니다. 대화형 터미널에서는 대상 선택 화면이 표시됩니다.");
    return EXIT_BLOCKED;
  }

  const projectDirectory = resolveProjectDirectory(args, io.cwd);
  const targetDirectory =
    scope === "user"
      ? resolveUserConfigDirectory(io.env)
      : path.join(projectDirectory, ".opencode");
  const targetPath = path.join(targetDirectory, "agents.toml");
  const nativeConfigPath = getNativeOpencodeConfigPath(
    scope,
    projectDirectory,
    io.env,
  );
  const installStatePath = getInstallStatePath(scope, projectDirectory, io.env);
  const fileSnapshots = [
    snapshotFile(targetPath),
    snapshotFile(nativeConfigPath),
    snapshotFile(installStatePath),
  ];

  try {
    const existingInstallState = readInstallState(installStatePath);
    const nativeConfig = readNativeOpencodeConfig(nativeConfigPath);
    let agentsConfigManaged = false;

    if (fs.existsSync(targetPath) && !args.includes("--force")) {
      io.stdout(`agents.toml 유지: ${targetPath}`);
    } else {
      fs.mkdirSync(targetDirectory, { recursive: true });
      const examplePath = getAgentsExamplePath();
      if (fs.existsSync(examplePath)) {
        writeFileBackup(targetPath);
        fs.copyFileSync(examplePath, targetPath);
        agentsConfigManaged = true;
        io.stdout(`agents.toml 생성: ${targetPath}`);
      } else {
        io.stdout(
          `agents.example.toml 없음: ${examplePath} — agents.toml을 생성하지 않습니다.`,
        );
      }
    }

    if (!nativeConfig.$schema) {
      nativeConfig.$schema = OPENCODE_CONFIG_SCHEMA;
    }
    const pluginAdded = ensurePluginEntry(nativeConfig);
    const providerAdded = ensureProvider(nativeConfig, projectDirectory, scope);
    writeNativeOpencodeConfig(nativeConfigPath, nativeConfig);
    writeInstallState(installStatePath, {
      pluginAdded: existingInstallState?.pluginAdded === true || pluginAdded,
      providerAdded:
        existingInstallState?.providerAdded === true || providerAdded,
      nativeConfigPath,
      agentsConfigManaged:
        existingInstallState?.agentsConfigManaged === true ||
        agentsConfigManaged,
      installedAt: existingInstallState?.installedAt || new Date().toISOString(),
    });
    io.stdout(`opencode.json 경로: ${nativeConfigPath}`);
    io.stdout(
      pluginAdded
        ? `opencode plugin 설정 추가: ${OPENCODE_PLUGIN_ENTRY}`
        : `opencode plugin 설정 유지: ${OPENCODE_PLUGIN_ENTRY}`,
    );
    io.stdout(
      providerAdded
        ? "opencode provider 설정 추가"
        : "opencode provider 설정 유지",
    );
  } catch (error) {
    for (const fileSnapshot of [...fileSnapshots].reverse()) {
      restoreFileSnapshot(fileSnapshot);
    }
    throw error;
  }
  return EXIT_VALID;
}

function reportLifecycleResults(
  results: ReturnType<typeof executeLifecycle>,
  targets: ReturnType<typeof readTargets>,
  sourceEnv: NodeJS.ProcessEnv,
  io: Required<CliIO>,
): number {
  for (const result of results) {
    io.stdout(`target=${result.target}`);
    io.stdout(`requestedOperation=${result.requestedOperation}`);
    io.stdout(`resolvedOperation=${result.resolvedOperation}`);
    io.stdout(`status=${result.status}`);
    if (result.backupId) io.stdout(`backupId=${result.backupId}`);
    io.stdout(result.message);
  }
  if (targets?.includes("opencode")) {
    const runtime = verifyOpencodeExecutable(sourceEnv);
    io.stdout(`opencodeRuntimeVerification=${runtime}`);
    if (runtime !== "available") {
      io.stderr("OpenCode 실행 파일을 찾지 못해 실제 기동 확인은 완료되지 않았습니다. local plugin과 설정의 정적 검증만 통과했습니다.");
      return EXIT_WARNING;
    }
  }
  return EXIT_VALID;
}
