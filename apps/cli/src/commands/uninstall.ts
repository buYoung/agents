import * as fs from "node:fs";
import { EXIT_BLOCKED, EXIT_VALID, OPENCODE_PLUGIN_ENTRY } from "@cli/constants";
import {
  isJsonObject,
  removeFileIfExists,
  restoreFileSnapshot,
  snapshotFile,
} from "@cli/fs-utils";
import { readInstallState } from "@cli/install-state";
import {
  readNativeOpencodeConfig,
  removePluginEntry,
  removeProvider,
  writeNativeOpencodeConfig,
} from "@cli/native-config";
import {
  getInstallStatePath,
  getNativeOpencodeConfigPath,
  getProjectConfigPath,
  getUserConfigPath,
  resolveProjectDirectory,
} from "@cli/paths";
import type { CliIO } from "@cli/types";

export async function uninstall(
  args: string[],
  io: Required<CliIO>,
): Promise<number> {
  const scopeIndex = args.indexOf("--scope");
  const scope = scopeIndex >= 0 ? args[scopeIndex + 1] : undefined;
  if (scope !== "user" && scope !== "project") {
    io.stderr(
      "uninstall은 --scope user 또는 --scope project를 명시해야 합니다.",
    );
    return EXIT_BLOCKED;
  }

  const projectDirectory = resolveProjectDirectory(args, io.cwd);
  const targetPath =
    scope === "user"
      ? getUserConfigPath(io.env)
      : getProjectConfigPath(projectDirectory);
  const nativeConfigPath = getNativeOpencodeConfigPath(
    scope,
    projectDirectory,
    io.env,
  );
  const installStatePath = getInstallStatePath(scope, projectDirectory, io.env);
  const installState = readInstallState(installStatePath);
  const fileSnapshots = [
    snapshotFile(targetPath),
    snapshotFile(nativeConfigPath),
    snapshotFile(installStatePath),
  ];

  try {
    if (installState?.agentsConfigManaged === true) {
      if (removeFileIfExists(targetPath)) {
        io.stdout(`agents.toml 삭제: ${targetPath}`);
      } else {
        io.stdout(`agents.toml 없음: ${targetPath}`);
      }
    } else if (installState) {
      io.stdout(`agents.toml 사용자 설정 유지: ${targetPath}`);
    } else if (fs.existsSync(targetPath)) {
      io.stdout(`agents.toml 사용자 설정 유지: ${targetPath}`);
    } else {
      io.stdout(`agents.toml 없음: ${targetPath}`);
    }

    if (!fs.existsSync(nativeConfigPath)) {
      if (installState) {
        removeFileIfExists(installStatePath);
      }
      io.stdout(`opencode.json 없음: ${nativeConfigPath}`);
      return EXIT_VALID;
    }
    const nativeConfig = readNativeOpencodeConfig(nativeConfigPath);
    const pluginStatus =
      installState?.pluginAdded === true
        ? removePluginEntry(nativeConfig)
          ? "removed"
          : "missing"
        : "kept-custom";
    const providerStatus =
      installState?.providerAdded === true
        ? removeProvider(nativeConfig, projectDirectory, scope)
        : isJsonObject(nativeConfig.provider) &&
            isJsonObject(nativeConfig.provider["ollama-cloud"])
          ? "kept-custom"
          : "missing";
    writeNativeOpencodeConfig(nativeConfigPath, nativeConfig);
    removeFileIfExists(installStatePath);
    io.stdout(`opencode.json 경로: ${nativeConfigPath}`);
    if (pluginStatus === "removed") {
      io.stdout(`opencode plugin 설정 삭제: ${OPENCODE_PLUGIN_ENTRY}`);
    } else if (pluginStatus === "kept-custom") {
      io.stdout(`opencode plugin 사용자 설정 유지: ${OPENCODE_PLUGIN_ENTRY}`);
    } else {
      io.stdout(`opencode plugin 설정 없음: ${OPENCODE_PLUGIN_ENTRY}`);
    }
    if (providerStatus === "removed") {
      io.stdout("opencode provider 설정 삭제");
    } else if (providerStatus === "kept-custom") {
      io.stdout("opencode provider 사용자 설정 유지");
    } else {
      io.stdout("opencode provider 설정 없음");
    }
  } catch (error) {
    for (const fileSnapshot of [...fileSnapshots].reverse()) {
      restoreFileSnapshot(fileSnapshot);
    }
    throw error;
  }
  return EXIT_VALID;
}
