import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXIT_BLOCKED,
  EXIT_VALID,
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
  const scopeIndex = args.indexOf("--scope");
  const scope = scopeIndex >= 0 ? args[scopeIndex + 1] : undefined;
  if (scope !== "user" && scope !== "project") {
    io.stderr("install은 --scope user 또는 --scope project를 명시해야 합니다.");
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
