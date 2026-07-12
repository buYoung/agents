import * as path from "node:path";
import { spawnSync } from "node:child_process";
import {
  getCatalogChecksum,
  USER_CONFIG_SCHEMA_VERSION,
  writeManagedState,
} from "opencode/core";
import { applyCliArtifact } from "@cli/artifact";
import { EXIT_BLOCKED, EXIT_VALID } from "@cli/constants";
import { restoreFileSnapshot, snapshotFile } from "@cli/fs-utils";
import { getCurrentPluginVersion, getPackageVersion, isNpmPackageInstallation, resolveProjectDirectory } from "@cli/paths";
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

export async function upgrade(
  args: string[],
  io: Required<CliIO>,
): Promise<number> {
  if (isNpmPackageInstallation()) {
    io.stdout("이 CLI는 npm이 설치와 갱신을 관리합니다.");
    io.stdout("다음 명령으로 최신 CLI를 설치하세요: npm install --global @livteam/agents-cli@latest");
    return EXIT_VALID;
  }
  const projectDirectory = resolveProjectDirectory(args, io.cwd);
  let latest: LatestManifest;
  let cliArtifact: LatestManifestArtifact;
  try {
    latest = await readLatestManifest(io.env);
    assertLatestManifestCompatibility(latest, projectDirectory, "upgrade");
    cliArtifact = requireLatestManifestArtifact(latest, "cli");
    assertArtifactCompatibility(cliArtifact, getPackageVersion());
  } catch (error) {
    if (reportReleaseManifestError(error, io)) return EXIT_BLOCKED;
    throw error;
  }
  const cliArtifactContent = await readLocation(cliArtifact.url, undefined, cliArtifact.size);
  if (cliArtifact.size !== undefined && cliArtifactContent.length !== cliArtifact.size) {
    io.stderr("upgrade-failed: CLI artifact 크기가 배포 목록과 일치하지 않습니다.");
    return EXIT_BLOCKED;
  }
  verifyChecksum(cliArtifactContent, cliArtifact.sha256);
  const cliArtifactApplyResult = applyCliArtifact(cliArtifactContent);
  if (cliArtifactApplyResult.actualVersion !== latest.cliVersion) {
    for (const targetSnapshot of [...cliArtifactApplyResult.targetSnapshots].reverse()) {
      restoreFileSnapshot(targetSnapshot);
    }
    io.stderr(
      `upgrade-failed: artifact 실제 버전 ${cliArtifactApplyResult.actualVersion}이(가) 배포 목록 ${latest.cliVersion}과 일치하지 않습니다.`,
    );
    return EXIT_BLOCKED;
  }
  const managedStatePath = path.join(
    projectDirectory,
    ".opencode",
    "agents.state.json",
  );
  const managedStateSnapshot = snapshotFile(managedStatePath);
  try {
    const executablePath = path.join(cliArtifactApplyResult.packageRoot, "bin", "agents");
    const smoke = spawnSync(executablePath, ["--help"], {
      cwd: cliArtifactApplyResult.packageRoot,
      env: io.env,
      encoding: "utf-8",
    });
    if (smoke.status !== 0) {
      throw new Error(`갱신 후 agents --help 확인 실패: ${smoke.stderr || smoke.error?.message || "알 수 없는 오류"}`);
    }
    writeManagedState(projectDirectory, {
      pluginVersion: getCurrentPluginVersion(),
      cliVersion: latest.cliVersion,
      catalogVersion: latest.catalogVersion,
      catalogChecksum: getCatalogChecksum(projectDirectory),
      userConfigSchemaVersion: USER_CONFIG_SCHEMA_VERSION,
      lastCommand: "upgrade",
      lastUpdatedAt: new Date().toISOString(),
    });
  } catch (error) {
    restoreFileSnapshot(managedStateSnapshot);
    for (const targetSnapshot of [
      ...cliArtifactApplyResult.targetSnapshots,
    ].reverse()) {
      restoreFileSnapshot(targetSnapshot);
    }
    throw error;
  }
  io.stdout(`cliVersion=${latest.cliVersion}`);
  io.stdout(`packagePath=${cliArtifactApplyResult.packageRoot}`);
  io.stdout("upgrade artifact applied.");
  return EXIT_VALID;
}
