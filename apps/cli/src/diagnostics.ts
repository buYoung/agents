import * as fs from "node:fs";
import * as path from "node:path";
import { readManagedState } from "opencode/core";

export function accessStatus(filePath: string, mode: number): string {
  try {
    fs.accessSync(filePath, mode);
    return "yes";
  } catch {
    return "no";
  }
}

export function directoryWriteStatus(filePath: string): string {
  let directory = path.dirname(filePath);
  while (!fs.existsSync(directory) && directory !== path.dirname(directory)) {
    directory = path.dirname(directory);
  }
  return accessStatus(directory, fs.constants.W_OK);
}

export function getCatalogFreshness(
  state: ReturnType<typeof readManagedState>,
  catalogVersion: string,
  catalogChecksum: string,
): string {
  if (!state) return "unknown";
  if (
    state.catalogVersion === catalogVersion &&
    state.catalogChecksum === catalogChecksum
  ) {
    return "current";
  }
  return "state-mismatch";
}
