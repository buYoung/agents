import * as fs from "node:fs";
import type { InstallState } from "@cli/types";
import { isJsonObject, writeJsonFile } from "@cli/fs-utils";

export function readInstallState(statePath: string): InstallState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf-8")) as unknown;
    if (!isJsonObject(parsed)) return null;
    return {
      pluginAdded: parsed.pluginAdded === true,
      providerAdded: parsed.providerAdded === true,
      nativeConfigPath:
        typeof parsed.nativeConfigPath === "string"
          ? parsed.nativeConfigPath
          : "",
      agentsConfigManaged: parsed.agentsConfigManaged === true,
      installedAt:
        typeof parsed.installedAt === "string" ? parsed.installedAt : "",
    };
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

export function writeInstallState(statePath: string, state: InstallState): void {
  writeJsonFile(statePath, state);
}
