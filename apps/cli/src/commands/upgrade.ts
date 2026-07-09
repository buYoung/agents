import * as path from "node:path";
import {
  getCatalogChecksum,
  USER_CONFIG_SCHEMA_VERSION,
  writeManagedState,
} from "opencode/core";
import { applyCliArtifact } from "@cli/artifact";
import { EXIT_BLOCKED, EXIT_VALID } from "@cli/constants";
import { restoreFileSnapshot, snapshotFile } from "@cli/fs-utils";
import { resolveProjectDirectory } from "@cli/paths";
import {
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
  const projectDirectory = resolveProjectDirectory(args, io.cwd);
  let latest: LatestManifest;
  let cliArtifact: LatestManifestArtifact;
  try {
    latest = await readLatestManifest(io.env);
    assertLatestManifestCompatibility(latest, projectDirectory, "upgrade");
    cliArtifact = requireLatestManifestArtifact(latest, "cli");
  } catch (error) {
    if (reportReleaseManifestError(error, io)) return EXIT_BLOCKED;
    throw error;
  }
  const cliArtifactContent = await readLocation(cliArtifact.url);
  verifyChecksum(cliArtifactContent, cliArtifact.sha256);
  const cliArtifactApplyResult = applyCliArtifact(cliArtifactContent);
  const managedStatePath = path.join(
    projectDirectory,
    ".opencode",
    "agents.state.json",
  );
  const managedStateSnapshot = snapshotFile(managedStatePath);
  try {
    writeManagedState(projectDirectory, {
      pluginVersion: latest.cliVersion,
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
