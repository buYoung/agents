import * as os from "node:os";
import * as path from "node:path";
import type { OpencodeScope } from "@cli/types";
import {
  getNativeOpencodeConfigPath,
  getProjectConfigPath,
  getUserConfigPath,
  resolveUserConfigDirectory,
} from "@cli/paths";

export function getCodexHome(env: NodeJS.ProcessEnv): string {
  return env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
}

export function getCodexLifecycleStatePath(env: NodeJS.ProcessEnv): string {
  return path.join(getCodexHome(env), ".agents-lifecycle", "codex.json");
}

export function getOpencodeLifecycleStatePath(
  scope: OpencodeScope,
  projectDirectory: string,
  env: NodeJS.ProcessEnv,
): string {
  return scope === "project"
    ? path.join(projectDirectory, ".opencode", "agents.lifecycle.json")
    : path.join(resolveUserConfigDirectory(env), "agents.lifecycle.json");
}

export function getLifecycleBackupDirectory(env: NodeJS.ProcessEnv): string {
  const stateHome =
    env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state");
  return path.join(stateHome, "agents", "backups");
}

export function getLifecycleJournalPath(env: NodeJS.ProcessEnv): string {
  const stateHome = env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state");
  return path.join(stateHome, "agents", "lifecycle.journal.json");
}

export function getOpencodeManagedPluginDirectory(
  scope: OpencodeScope,
  projectDirectory: string,
  env: NodeJS.ProcessEnv,
): string {
  return scope === "project"
    ? path.join(projectDirectory, ".opencode", "agents", "plugin")
    : path.join(resolveUserConfigDirectory(env), "agents", "plugin");
}

export function getOpencodeManagedCatalogPath(
  scope: OpencodeScope,
  projectDirectory: string,
  env: NodeJS.ProcessEnv,
): string {
  return scope === "project"
    ? path.join(projectDirectory, ".opencode", "agents", "catalog.toml")
    : path.join(resolveUserConfigDirectory(env), "agents", "catalog.toml");
}

export function getOpencodeConfigPaths(
  scope: OpencodeScope,
  projectDirectory: string,
  env: NodeJS.ProcessEnv,
): { agentsPath: string; nativePath: string } {
  return {
    agentsPath:
      scope === "project"
        ? getProjectConfigPath(projectDirectory)
        : getUserConfigPath(env),
    nativePath: getNativeOpencodeConfigPath(scope, projectDirectory, env),
  };
}
