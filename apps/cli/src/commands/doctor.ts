import * as fs from "node:fs";
import * as path from "node:path";
import {
  getBundledCatalogPath,
  getCatalogChecksum,
  getCatalogSource,
  getManagedCatalogPath,
  loadCatalogSnapshot,
  loadPluginConfig,
  readManagedState,
  USER_CONFIG_SCHEMA_VERSION,
  validatePluginConfig,
  type ConfigLoadWarning,
} from "opencode/core";
import {
  AGENT_RECORD,
  EXIT_INVALID,
  EXIT_VALID,
  EXIT_WARNING,
} from "@cli/constants";
import {
  accessStatus,
  directoryWriteStatus,
  getCatalogFreshness,
} from "@cli/diagnostics";
import {
  getPackageVersion,
  getProjectConfigPath,
  getUserConfigPath,
  resolveProjectDirectory,
} from "@cli/paths";
import type { CliIO } from "@cli/types";
import { readOpencodeScope, readTargets } from "@cli/lifecycle/args";
import { inspectTargets } from "@cli/lifecycle/orchestrator";

export async function doctor(
  args: string[],
  io: Required<CliIO>,
): Promise<number> {
  const projectDirectory = resolveProjectDirectory(args, io.cwd);
  const targets = readTargets(args);
  if (targets) {
    try {
      const scope = readOpencodeScope(args);
      if (targets.includes("opencode") && !scope) {
        io.stderr("OpenCode 진단에는 --opencode-scope user 또는 project가 필요합니다.");
        return EXIT_INVALID;
      }
      const inspections = inspectTargets(targets, projectDirectory, io.env, scope ?? undefined);
      for (const inspection of inspections) {
        io.stdout(`target=${inspection.target}`);
        io.stdout(`status=${inspection.status}`);
        io.stdout(`installedVersion=${inspection.installedVersion ?? "unknown"}`);
        io.stdout(`availableVersion=${inspection.availableVersion ?? "unknown"}`);
        io.stdout(`userModifiedFiles=${inspection.userModifiedPaths.length}`);
        if (inspection.reason) io.stderr(`${inspection.target}: ${inspection.reason}`);
      }
      return inspections.every((inspection) => inspection.status === "healthy-current" || inspection.status === "ahead")
        ? EXIT_VALID
        : EXIT_INVALID;
    } catch (error) {
      io.stderr(`target-doctor-failed: ${error instanceof Error ? error.message : String(error)}`);
      return EXIT_INVALID;
    }
  }
  let catalogSource = getCatalogSource(projectDirectory);
  const managedCatalogPath = getManagedCatalogPath(projectDirectory);
  const projectConfigPath = getProjectConfigPath(projectDirectory);
  const userConfigPath = getUserConfigPath(io.env);
  const packageVersion = getPackageVersion();
  const state = readManagedState(projectDirectory);
  let catalogChecksum = "unavailable";
  let catalog: ReturnType<typeof loadCatalogSnapshot>["catalog"] | undefined;
  let catalogLoadError: unknown;
  try {
    const catalogSnapshot = loadCatalogSnapshot(projectDirectory);
    catalog = catalogSnapshot.catalog;
    catalogChecksum = catalogSnapshot.checksum;
    catalogSource = catalogSnapshot.source;
  } catch (error) {
    catalogLoadError = error;
    try {
      catalogChecksum = getCatalogChecksum(projectDirectory);
    } catch {
      // catalog validity 진단에서 원인을 별도로 출력한다.
    }
  }

  if (!catalog) {
    const catalogErrorMessage =
      catalogLoadError instanceof Error
        ? catalogLoadError.message
        : String(catalogLoadError);
    io.stdout(`pluginVersion=${packageVersion}`);
    io.stdout(`cliVersion=${packageVersion}`);
    io.stdout("catalogVersion=unknown");
    io.stdout(`userConfigSchemaVersion=${USER_CONFIG_SCHEMA_VERSION}`);
    io.stdout(`catalogChecksum=${catalogChecksum}`);
    io.stdout(`catalogSource=${catalogSource.kind}`);
    io.stdout("catalogValidity=invalid");
    io.stdout("catalogFreshness=invalid");
    io.stdout(`bundledCatalogPath=${getBundledCatalogPath()}`);
    io.stdout(`managedCatalogPath=${managedCatalogPath}`);
    io.stdout(`activeCatalogPath=${catalogSource.path}`);
    io.stdout(`projectConfigPath=${projectConfigPath}`);
    io.stdout(`userConfigPath=${userConfigPath}`);
    io.stdout(
      `managedStatePath=${path.join(projectDirectory, ".opencode", "agents.state.json")}`,
    );
    io.stdout(
      `activeCatalogReadable=${accessStatus(catalogSource.path, fs.constants.R_OK)}`,
    );
    io.stdout(
      `managedCatalogWritable=${directoryWriteStatus(managedCatalogPath)}`,
    );
    io.stdout(
      `projectConfigStatus=${fs.existsSync(projectConfigPath) ? "present" : "missing"}`,
    );
    io.stdout(
      `userConfigStatus=${fs.existsSync(userConfigPath) ? "present" : "missing"}`,
    );
    io.stdout("userConfigValidity=unknown");
    io.stdout("runtimeInjectionReady=unknown");
    io.stdout(`state=${state ? "present" : "missing"}`);
    io.stderr(`catalog-invalid: ${catalogSource.path}: ${catalogErrorMessage}`);
    return EXIT_INVALID;
  }

  const missingEnvironment = catalog.provider.env.filter(
    (name) => !io.env[name],
  );
  const warnings: ConfigLoadWarning[] = [];
  const config = loadPluginConfig(projectDirectory, {
    silent: true,
    catalog,
    agentRecord: AGENT_RECORD,
    onWarning: (warning) => warnings.push(warning),
  });
  const validationMessages = validatePluginConfig(
    config,
    catalog,
    AGENT_RECORD,
  );
  const invalidConfigWarnings = warnings.filter(
    (warning) =>
      warning.kind === "invalid-model" ||
      warning.kind === "invalid-reasoning-effort" ||
      warning.kind === "protected-agent-disabled" ||
      warning.kind === "invalid-schema" ||
      warning.kind === "invalid-toml",
  );
  const invalidValidationMessages = validationMessages.filter(
    (message) =>
      message.kind === "invalid-model" ||
      message.kind === "invalid-reasoning-effort" ||
      message.kind === "protected-agent-disabled",
  );
  io.stdout(`pluginVersion=${packageVersion}`);
  io.stdout(`cliVersion=${packageVersion}`);
  io.stdout(`catalogVersion=${catalog.catalogVersion}`);
  io.stdout(`userConfigSchemaVersion=${USER_CONFIG_SCHEMA_VERSION}`);
  io.stdout(`catalogChecksum=${catalogChecksum}`);
  io.stdout(`catalogSource=${catalogSource.kind}`);
  io.stdout("catalogValidity=valid");
  io.stdout(
    `catalogFreshness=${getCatalogFreshness(state, catalog.catalogVersion, catalogChecksum)}`,
  );
  io.stdout(`bundledCatalogPath=${getBundledCatalogPath()}`);
  io.stdout(`managedCatalogPath=${managedCatalogPath}`);
  io.stdout(`activeCatalogPath=${catalogSource.path}`);
  io.stdout(`projectConfigPath=${projectConfigPath}`);
  io.stdout(`userConfigPath=${userConfigPath}`);
  io.stdout(
    `managedStatePath=${path.join(projectDirectory, ".opencode", "agents.state.json")}`,
  );
  io.stdout(
    `activeCatalogReadable=${accessStatus(catalogSource.path, fs.constants.R_OK)}`,
  );
  io.stdout(
    `managedCatalogWritable=${directoryWriteStatus(managedCatalogPath)}`,
  );
  io.stdout(
    `projectConfigStatus=${fs.existsSync(projectConfigPath) ? "present" : "missing"}`,
  );
  io.stdout(
    `userConfigStatus=${fs.existsSync(userConfigPath) ? "present" : "missing"}`,
  );
  io.stdout(
    `userConfigValidity=${
      invalidConfigWarnings.length === 0 &&
      invalidValidationMessages.length === 0
        ? "valid"
        : "invalid"
    }`,
  );
  io.stdout(
    `runtimeInjectionReady=${missingEnvironment.length === 0 ? "yes" : "unknown"}`,
  );
  io.stdout(`state=${state ? "present" : "missing"}`);
  for (const warning of invalidConfigWarnings) {
    io.stderr(`${warning.kind}: ${warning.filePath}: ${warning.message}`);
  }
  const warningKeys = new Set(
    invalidConfigWarnings.map(
      (warning) => `${warning.kind}:${warning.message}`,
    ),
  );
  for (const message of invalidValidationMessages) {
    if (warningKeys.has(`${message.kind}:${message.message}`)) {
      continue;
    }
    io.stderr(`${message.kind}: ${message.path}: ${message.message}`);
  }
  if (
    invalidConfigWarnings.length > 0 ||
    invalidValidationMessages.length > 0
  ) {
    return EXIT_INVALID;
  }
  if (missingEnvironment.length > 0) {
    io.stderr(`환경 변수 누락: ${missingEnvironment.join(", ")}`);
    return EXIT_WARNING;
  }
  return EXIT_VALID;
}
