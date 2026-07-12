import * as fs from "node:fs";
import * as path from "node:path";
import {
  getManagedCatalogPath,
  invalidateCatalogCache,
  parseCatalog,
  USER_CONFIG_SCHEMA_VERSION,
  writeManagedState,
} from "opencode/core";
import { EXIT_BLOCKED, EXIT_VALID, EXIT_WARNING } from "@cli/constants";
import { restoreFileSnapshot, snapshotFile } from "@cli/fs-utils";
import {
  getCodexAgentsDirectory,
  getCurrentPluginVersion,
  getPackageVersion,
  resolveProjectDirectory,
} from "@cli/paths";
import {
  assertArtifactCompatibility,
  assertLatestManifestCompatibility,
  readLatestManifest,
  readLocation,
  reportReleaseManifestError,
  requireLatestManifestArtifact,
  verifyChecksum,
} from "@cli/release";
import type { CliIO, LatestManifest, LatestManifestArtifact } from "@cli/types";
import { ReleaseManifestError } from "@cli/types";
import { applyCodexAgentsArtifact } from "@cli/artifact";
import { readOpencodeScope, readTargets } from "@cli/lifecycle/args";
import { areLifecyclePlansEqual, executeLifecycle, hasInterruptedLifecycle, planLifecycle } from "@cli/lifecycle/orchestrator";
import { createRemoteTargetPlanEnvironment, stageRemoteTargetSources, verifyOpencodeExecutable } from "@cli/lifecycle/targets";
import { confirmLifecyclePlan, selectLifecycleTargets } from "@cli/interactive";
import { finishCancelled } from "@cli/tui";

export async function update(
  args: string[],
  io: Required<CliIO>,
): Promise<number> {
  let targets = readTargets(args);
  let interactiveSelection: Awaited<ReturnType<typeof selectLifecycleTargets>> | undefined;
  if (!targets && io.isInteractive) {
    io.tui.intro("agents 업데이트");
    interactiveSelection = await selectLifecycleTargets(io.tui);
    if (!interactiveSelection) {
      finishCancelled(io.tui);
      return EXIT_VALID;
    }
    targets = interactiveSelection.targets;
  }
  if (targets) {
    const scope = interactiveSelection?.scope ?? readOpencodeScope(args);
    if (targets.includes("opencode") && !scope) {
      io.stderr("OpenCode 업데이트에는 --opencode-scope user 또는 project를 명시해야 합니다.");
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
        let latest: LatestManifest | undefined;
        try {
          latest = await readLatestManifest(io.env);
          assertLatestManifestCompatibility(latest, projectDirectory, "update");
          sourceEnv = createRemoteTargetPlanEnvironment(latest, targets, io.env);
        } catch (error) {
          if (io.env.AGENTS_RELEASE_URL || !(error instanceof ReleaseManifestError) || !error.message.startsWith("배포 주소 확인 실패:")) throw error;
        }
        const plan = planLifecycle(
          targets,
          "update",
          projectDirectory,
          sourceEnv,
          { scope: scope ?? undefined, adopt, allowDowngrade: args.includes("--allow-downgrade") },
        );
        const approved = await confirmLifecyclePlan(io.tui, "update", plan);
        if (approved !== true) {
          finishCancelled(io.tui);
          return EXIT_VALID;
        }
        const confirmedPlan = planLifecycle(
          targets,
          "update",
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
            "update",
            projectDirectory,
            sourceEnv,
            { scope: scope ?? undefined, adopt, allowDowngrade: args.includes("--allow-downgrade") },
          );
          if (!areLifecyclePlansEqual(plan, stagedPlan)) {
            io.stderr("배포 artifact 또는 대상 상태가 확인 화면과 달라 표시한 계획을 실행하지 않았습니다. 현재 상태를 다시 검토하세요.");
            return EXIT_BLOCKED;
          }
        }
        const progress = io.tui.spinner();
        progress.start("업데이트 계획을 적용하는 중");
        try {
          const results = executeLifecycle(
            targets,
            "update",
            projectDirectory,
            sourceEnv,
            { scope: scope ?? undefined, adopt, allowDowngrade: args.includes("--allow-downgrade"), expectedPlan: plan },
          );
          const exit = reportLifecycleResults(results, targets, sourceEnv, io, io.tui);
          progress.stop(exit === EXIT_VALID ? "업데이트를 완료했습니다." : "업데이트는 완료됐지만 경고가 있습니다.");
          io.tui.outro(exit === EXIT_VALID ? "업데이트 성공" : "업데이트 경고");
          return exit;
        } catch (error) {
          progress.stop("업데이트에 실패했습니다.");
          throw error;
        }
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
        "update",
        projectDirectory,
        sourceEnv,
        { scope: scope ?? undefined, adopt, allowDowngrade: args.includes("--allow-downgrade") },
      );
      return reportLifecycleResults(results, targets, sourceEnv, io);
    } catch (error) {
      if (reportReleaseManifestError(error, io)) return EXIT_BLOCKED;
      io.stderr(`update-failed: ${error instanceof Error ? error.message : String(error)}`);
      return EXIT_BLOCKED;
    } finally {
      stagedSources?.cleanup();
    }
  }
  if (!io.env.AGENTS_RELEASE_URL) {
    io.stderr("update에는 --target codex, opencode 또는 all이 필요합니다. 대화형 터미널에서는 대상 선택 화면이 표시됩니다.");
    return EXIT_BLOCKED;
  }
  const projectDirectory = resolveProjectDirectory(args, io.cwd);
  let latest: LatestManifest;
  let catalogArtifact: LatestManifestArtifact;
  let codexAgentsArtifact: LatestManifestArtifact | undefined;
  try {
    latest = await readLatestManifest(io.env);
    assertLatestManifestCompatibility(latest, projectDirectory, "update");
    catalogArtifact = requireLatestManifestArtifact(latest, "catalog");
    codexAgentsArtifact = latest.codexAgents;
    assertArtifactCompatibility(catalogArtifact, getPackageVersion());
    if (codexAgentsArtifact) assertArtifactCompatibility(codexAgentsArtifact, getPackageVersion());
  } catch (error) {
    if (reportReleaseManifestError(error, io)) return EXIT_BLOCKED;
    throw error;
  }
  const catalogContent = await readLocation(catalogArtifact.url, undefined, catalogArtifact.size);
  if (catalogArtifact.size !== undefined && catalogContent.length !== catalogArtifact.size) {
    io.stderr("update-failed: catalog artifact 크기가 배포 목록과 일치하지 않습니다.");
    return EXIT_BLOCKED;
  }
  verifyChecksum(catalogContent, catalogArtifact.sha256);
  const codexAgentsContent = codexAgentsArtifact
    ? await readLocation(codexAgentsArtifact.url, undefined, codexAgentsArtifact.size)
    : null;
  if (codexAgentsArtifact && codexAgentsContent) {
    if (codexAgentsArtifact.size !== undefined && codexAgentsContent.length !== codexAgentsArtifact.size) {
      io.stderr("update-failed: Codex artifact 크기가 배포 목록과 일치하지 않습니다.");
      return EXIT_BLOCKED;
    }
    verifyChecksum(codexAgentsContent, codexAgentsArtifact.sha256);
  }
  const catalog = parseCatalog(catalogContent.toString("utf-8"));
  const managedCatalogPath = getManagedCatalogPath(projectDirectory);
  const managedStatePath = path.join(
    projectDirectory,
    ".opencode",
    "agents.state.json",
  );
  const fileSnapshots = [
    snapshotFile(managedCatalogPath),
    snapshotFile(managedStatePath),
  ];
  let codexAgentsApplyResult:
    | ReturnType<typeof applyCodexAgentsArtifact>
    | undefined;
  try {
    fs.mkdirSync(path.dirname(managedCatalogPath), { recursive: true });
    fs.writeFileSync(managedCatalogPath, catalogContent, "utf-8");
    invalidateCatalogCache(managedCatalogPath);
    if (codexAgentsContent) {
      codexAgentsApplyResult = applyCodexAgentsArtifact(
        codexAgentsContent,
        getCodexAgentsDirectory(io.env),
      );
    }
    writeManagedState(projectDirectory, {
      pluginVersion: getCurrentPluginVersion(),
      cliVersion: getPackageVersion(),
      catalogVersion: catalog.catalogVersion,
      catalogChecksum: catalogArtifact.sha256,
      userConfigSchemaVersion: USER_CONFIG_SCHEMA_VERSION,
      lastCommand: "update",
      lastUpdatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (codexAgentsApplyResult) {
      for (const targetSnapshot of [
        ...codexAgentsApplyResult.targetSnapshots,
      ].reverse()) {
        restoreFileSnapshot(targetSnapshot);
      }
    }
    for (const fileSnapshot of [...fileSnapshots].reverse()) {
      restoreFileSnapshot(fileSnapshot);
    }
    invalidateCatalogCache(managedCatalogPath);
    throw error;
  }
  io.stdout(`catalogVersion=${catalog.catalogVersion}`);
  io.stdout(`catalogPath=${managedCatalogPath}`);
  if (codexAgentsApplyResult) {
    io.stdout(`codexAgentsPath=${codexAgentsApplyResult.targetDirectory}`);
    io.stdout(
      `codexAgentsUpdated=${codexAgentsApplyResult.updatedAgents.length}`,
    );
    io.stdout(
      `codexAgentsSkipped=${codexAgentsApplyResult.skippedAgents.length}`,
    );
  }
  return EXIT_VALID;
}

function reportLifecycleResults(
  results: ReturnType<typeof executeLifecycle>,
  targets: ReturnType<typeof readTargets>,
  sourceEnv: NodeJS.ProcessEnv,
  io: Required<CliIO>,
  tui?: Required<CliIO>["tui"],
): number {
  for (const result of results) {
    io.stdout(`target=${result.target}`);
    io.stdout(`requestedOperation=${result.requestedOperation}`);
    io.stdout(`resolvedOperation=${result.resolvedOperation}`);
    io.stdout(`status=${result.status}`);
    if (result.backupId) io.stdout(`backupId=${result.backupId}`);
    io.stdout(result.message);
  }
  if (tui) tui.note(results.map((result) => `${result.target}${result.scope ? ` (${result.scope})` : ""}: ${result.message}`).join("\n"), "실행 결과");
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
