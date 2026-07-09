import * as fs from "node:fs";
import * as path from "node:path";
import {
  getManagedCatalogPath,
  invalidateCatalogCache,
  parseCatalog,
  USER_CONFIG_SCHEMA_VERSION,
  writeManagedState,
} from "opencode/core";
import { EXIT_BLOCKED, EXIT_VALID } from "@cli/constants";
import { restoreFileSnapshot, snapshotFile } from "@cli/fs-utils";
import { getPackageVersion, resolveProjectDirectory } from "@cli/paths";
import {
  assertLatestManifestCompatibility,
  readLatestManifest,
  readLocation,
  reportReleaseManifestError,
  requireLatestManifestArtifact,
  verifyChecksum,
} from "@cli/release";
import type { CliIO, LatestManifest, LatestManifestArtifact } from "@cli/types";

export async function update(
  args: string[],
  io: Required<CliIO>,
): Promise<number> {
  const projectDirectory = resolveProjectDirectory(args, io.cwd);
  let latest: LatestManifest;
  let catalogArtifact: LatestManifestArtifact;
  try {
    latest = await readLatestManifest(io.env);
    assertLatestManifestCompatibility(latest, projectDirectory, "update");
    catalogArtifact = requireLatestManifestArtifact(latest, "catalog");
  } catch (error) {
    if (reportReleaseManifestError(error, io)) return EXIT_BLOCKED;
    throw error;
  }
  const catalogContent = await readLocation(catalogArtifact.url);
  verifyChecksum(catalogContent, catalogArtifact.sha256);
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
  try {
    fs.mkdirSync(path.dirname(managedCatalogPath), { recursive: true });
    fs.writeFileSync(managedCatalogPath, catalogContent, "utf-8");
    invalidateCatalogCache(managedCatalogPath);
    writeManagedState(projectDirectory, {
      pluginVersion: getPackageVersion(),
      cliVersion: getPackageVersion(),
      catalogVersion: catalog.catalogVersion,
      catalogChecksum: catalogArtifact.sha256,
      userConfigSchemaVersion: USER_CONFIG_SCHEMA_VERSION,
      lastCommand: "update",
      lastUpdatedAt: new Date().toISOString(),
    });
  } catch (error) {
    for (const fileSnapshot of [...fileSnapshots].reverse()) {
      restoreFileSnapshot(fileSnapshot);
    }
    invalidateCatalogCache(managedCatalogPath);
    throw error;
  }
  io.stdout(`catalogVersion=${catalog.catalogVersion}`);
  io.stdout(`catalogPath=${managedCatalogPath}`);
  return EXIT_VALID;
}
