import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BackupEntry, BackupIndex, LifecycleTarget } from "@cli/types";
import { getLifecycleBackupDirectory } from "@cli/lifecycle/paths";

function sha256(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function safeRelativePath(filePath: string): string {
  return `entry-${sha256(Buffer.from(filePath, "utf-8"))}`;
}

function getCanonicalPath(filePath: string): string {
  const missingSegments: string[] = [];
  let existingPath = path.resolve(filePath);
  while (!fs.existsSync(existingPath)) {
    const parentPath = path.dirname(existingPath);
    if (parentPath === existingPath) throw new Error(`안전 사본 경로를 확인할 수 없습니다: ${filePath}`);
    missingSegments.unshift(path.basename(existingPath));
    existingPath = parentPath;
  }
  return path.join(fs.realpathSync(existingPath), ...missingSegments);
}

function listFiles(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [filePath];
  const stats = fs.lstatSync(filePath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) return [filePath];
  const files: string[] = [filePath];
  for (const entry of fs.readdirSync(filePath, { withFileTypes: true })) {
    files.push(...listFiles(path.join(filePath, entry.name)));
  }
  return files;
}

function assertSafeBackupEntry(entry: BackupEntry, backupDirectory: string): void {
  if (
    path.isAbsolute(entry.relativePath) ||
    entry.relativePath.split(path.sep).includes("..") ||
    entry.relativePath.includes("\0")
  ) {
    throw new Error("안전 사본에 허용되지 않는 경로가 있습니다.");
  }
  const contentPath = path.resolve(backupDirectory, "files", entry.relativePath);
  const filesRoot = path.resolve(backupDirectory, "files") + path.sep;
  if (!contentPath.startsWith(filesRoot)) {
    throw new Error("안전 사본 경로가 허용 범위를 벗어났습니다.");
  }
  if (
    !path.isAbsolute(entry.canonicalPath) ||
    entry.canonicalPath.includes("\0")
  ) {
    throw new Error("안전 사본의 물리 복원 경로가 올바르지 않습니다.");
  }
}

function getMatchingRestoreRoot(originalPath: string, allowedRoots: string[]): string {
  const resolvedPath = path.resolve(originalPath);
  const matchingRoot = allowedRoots
    .map((root) => path.resolve(root))
    .filter((root) => resolvedPath === root || resolvedPath.startsWith(`${root}${path.sep}`))
    .sort((left, right) => right.length - left.length)[0];
  if (!matchingRoot) throw new Error(`안전 사본이 허용되지 않은 경로를 복원하려고 합니다: ${originalPath}`);
  return matchingRoot;
}

function assertNoSymbolicLinkInRestorePath(restorePath: string, allowedRoot: string): void {
  let currentPath = path.resolve(restorePath);
  const resolvedRoot = path.resolve(allowedRoot);
  while (currentPath !== resolvedRoot) {
    if (fs.existsSync(currentPath) && fs.lstatSync(currentPath).isSymbolicLink()) {
      throw new Error(`심볼릭 링크를 포함한 복원 경로는 허용되지 않습니다: ${restorePath}`);
    }
    const parentPath = path.dirname(currentPath);
    currentPath = parentPath;
  }
  if (fs.existsSync(currentPath) && fs.lstatSync(currentPath).isSymbolicLink()) {
    throw new Error(`심볼릭 링크를 포함한 복원 경로는 허용되지 않습니다: ${restorePath}`);
  }
}

function assertCanonicalPathWithinAllowedRoot(canonicalPath: string, allowedRoot: string): void {
  const canonicalRoot = getCanonicalPath(allowedRoot);
  if (canonicalPath !== canonicalRoot && !canonicalPath.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error(`안전 사본이 허용되지 않은 경로를 복원하려고 합니다: ${canonicalPath}`);
  }
}

function assertRestoreEntryPathSafe(entry: BackupEntry, allowedRoots: string[]): void {
  const matchingRoot = getMatchingRestoreRoot(entry.originalPath, allowedRoots);
  assertNoSymbolicLinkInRestorePath(entry.originalPath, matchingRoot);
  const expectedCanonicalPath = getCanonicalPath(entry.originalPath);
  if (path.resolve(entry.canonicalPath) !== expectedCanonicalPath) {
    throw new Error(`안전 사본의 물리 복원 경로가 현재 허용 대상과 일치하지 않습니다: ${entry.originalPath}`);
  }
  assertCanonicalPathWithinAllowedRoot(expectedCanonicalPath, matchingRoot);
}

export function createBackup(
  env: NodeJS.ProcessEnv,
  reason: string,
  targets: Array<{ target: LifecycleTarget; scope?: "user" | "project" }>,
  sourcePaths: string[],
): BackupIndex {
  const id = `${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${crypto.randomBytes(4).toString("hex")}`;
  const backupDirectory = path.join(getLifecycleBackupDirectory(env), id);
  const entries: BackupEntry[] = [];
  const seen = new Set<string>();
  const backupPathOwners = new Map<string, string>();
  for (const sourcePath of sourcePaths) {
    for (const filePath of listFiles(sourcePath)) {
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      const relativePath = safeRelativePath(filePath);
      const previousOwner = backupPathOwners.get(relativePath);
      if (previousOwner && previousOwner !== filePath) {
        throw new Error(`안전 사본 경로가 서로 다른 파일과 충돌합니다: ${filePath}`);
      }
      backupPathOwners.set(relativePath, filePath);
      const canonicalPath = getCanonicalPath(filePath);
      if (!fs.existsSync(filePath)) {
        entries.push({ originalPath: filePath, canonicalPath, relativePath, existed: false, kind: "absent" });
        continue;
      }
      const stats = fs.lstatSync(filePath);
      if (stats.isSymbolicLink()) {
        throw new Error(`심볼릭 링크는 안전 사본에 포함할 수 없습니다: ${filePath}`);
      }
      if (stats.isDirectory()) {
        entries.push({ originalPath: filePath, canonicalPath, relativePath, existed: true, kind: "directory", mode: stats.mode & 0o777 });
        continue;
      }
      const content = fs.readFileSync(filePath);
      const mode = fs.statSync(filePath).mode & 0o777;
      const outputPath = path.join(backupDirectory, "files", relativePath);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(outputPath, content, { mode });
      entries.push({
        originalPath: filePath,
        canonicalPath,
        relativePath,
        existed: true,
        kind: "file",
        mode,
        sha256: sha256(content),
      });
    }
  }
  const index: BackupIndex = {
    schemaVersion: 2,
    id,
    createdAt: new Date().toISOString(),
    reason,
    targets,
    entries,
  };
  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(backupDirectory, "index.json"),
    JSON.stringify(index, null, 2) + "\n",
    { mode: 0o600 },
  );
  return index;
}

export function readBackup(env: NodeJS.ProcessEnv, id: string): BackupIndex {
  if (!/^[A-Za-z0-9-]+$/.test(id)) {
    throw new Error("안전 사본 ID가 올바르지 않습니다.");
  }
  const backupDirectory = path.join(getLifecycleBackupDirectory(env), id);
  const parsed = JSON.parse(
    fs.readFileSync(path.join(backupDirectory, "index.json"), "utf-8"),
  ) as BackupIndex;
  if (parsed.schemaVersion !== 2 || parsed.id !== id || !Array.isArray(parsed.entries)) {
    throw new Error("안전 사본 형식이 올바르지 않습니다.");
  }
  const relativePaths = new Set<string>();
  for (const entry of parsed.entries) {
    assertSafeBackupEntry(entry, backupDirectory);
    if (relativePaths.has(entry.relativePath)) throw new Error("안전 사본에 중복된 파일 경로가 있습니다.");
    relativePaths.add(entry.relativePath);
  }
  return parsed;
}

export function restoreBackup(env: NodeJS.ProcessEnv, index: BackupIndex, allowedRoots: string[]): void {
  const backupDirectory = path.join(getLifecycleBackupDirectory(env), index.id);
  for (const entry of index.entries) {
    assertSafeBackupEntry(entry, backupDirectory);
    assertRestoreEntryPathSafe(entry, allowedRoots);
  }
  const absentEntries = index.entries.filter((entry) => entry.kind === "absent" || !entry.existed);
  for (const entry of [...absentEntries].sort((left, right) => right.originalPath.length - left.originalPath.length)) {
    fs.rmSync(entry.canonicalPath, { force: true, recursive: true });
  }
  const directoryEntries = index.entries.filter((entry) => entry.kind === "directory");
  for (const entry of directoryEntries.sort((left, right) => left.originalPath.length - right.originalPath.length)) {
    fs.rmSync(entry.canonicalPath, { force: true, recursive: true });
    fs.mkdirSync(entry.canonicalPath, { recursive: true, mode: entry.mode });
    if (entry.mode !== undefined) fs.chmodSync(entry.canonicalPath, entry.mode);
  }
  for (const entry of index.entries.filter((entry) => entry.kind !== "directory" && entry.kind !== "absent" && entry.existed)) {
    assertSafeBackupEntry(entry, backupDirectory);
    assertRestoreEntryPathSafe(entry, allowedRoots);
    if (!entry.existed) {
      fs.rmSync(entry.canonicalPath, { force: true, recursive: true });
      continue;
    }
    const contentPath = path.join(backupDirectory, "files", entry.relativePath);
    const content = fs.readFileSync(contentPath);
    if (entry.sha256 !== sha256(content)) {
      throw new Error(`안전 사본 해시가 일치하지 않습니다: ${entry.originalPath}`);
    }
    fs.mkdirSync(path.dirname(entry.canonicalPath), { recursive: true });
    fs.writeFileSync(entry.canonicalPath, content);
    if (entry.mode !== undefined) fs.chmodSync(entry.canonicalPath, entry.mode);
  }
}

export function listBackups(env: NodeJS.ProcessEnv): string[] {
  const directory = getLifecycleBackupDirectory(env);
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
