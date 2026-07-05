import * as fs from "node:fs";
import * as path from "node:path";

export interface ManagedState {
  pluginVersion: string;
  cliVersion: string;
  catalogVersion: string;
  catalogChecksum: string;
  userConfigSchemaVersion: string;
  lastCommand: string;
  lastUpdatedAt: string;
}

export const USER_CONFIG_SCHEMA_VERSION = "2026.07.03.1";

export function getProjectStatePath(projectDirectory: string): string {
  return path.join(projectDirectory, ".opencode", "agents.state.json");
}

export function readManagedState(
  projectDirectory: string,
): ManagedState | null {
  const statePath = getProjectStatePath(projectDirectory);
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf-8")) as ManagedState;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

export function writeManagedState(
  projectDirectory: string,
  state: ManagedState,
): void {
  const statePath = getProjectStatePath(projectDirectory);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}
