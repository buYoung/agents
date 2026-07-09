import * as fs from "node:fs";
import * as path from "node:path";
import type { FileSnapshot } from "@cli/types";

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function ensureParentDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function writeTextFile(filePath: string, content: string | Buffer): void {
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, content, "utf-8");
}

export function writeJsonFile(filePath: string, value: unknown): void {
  writeTextFile(filePath, JSON.stringify(value, null, 2) + "\n");
}

export function snapshotFile(filePath: string): FileSnapshot {
  if (!fs.existsSync(filePath)) {
    return { filePath, existed: false };
  }
  return {
    filePath,
    existed: true,
    content: fs.readFileSync(filePath),
    mode: fs.statSync(filePath).mode & 0o777,
  };
}

export function restoreFileSnapshot(snapshot: FileSnapshot): void {
  if (!snapshot.existed) {
    fs.rmSync(snapshot.filePath, { force: true });
    return;
  }
  if (!snapshot.content) {
    throw new Error(`${snapshot.filePath} snapshot content missing`);
  }
  writeTextFile(snapshot.filePath, snapshot.content);
  if (snapshot.mode !== undefined) {
    fs.chmodSync(snapshot.filePath, snapshot.mode);
  }
}

export function getBackupPath(filePath: string, createdAt = new Date()): string {
  const timestamp = createdAt
    .toISOString()
    .replaceAll(":", "")
    .replaceAll(".", "");
  return `${filePath}.${timestamp}.bak`;
}

export function writeFileBackup(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  let backupPath = getBackupPath(filePath);
  let backupIndex = 1;
  while (fs.existsSync(backupPath)) {
    backupPath = `${getBackupPath(filePath)}.${backupIndex}`;
    backupIndex += 1;
  }
  ensureParentDirectory(backupPath);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

export function removeFileIfExists(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  fs.rmSync(filePath);
  return true;
}
