import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BackupEntry, BackupIndex, BackupMetadata, BackupSummary, LifecycleTarget } from "@cli/types";
import { getLifecycleBackupDirectory } from "@cli/lifecycle/paths";

type BackupTarget = { target: LifecycleTarget; scope?: "user" | "project" };

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

function assertRegularFile(filePath: string, message: string): fs.Stats {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(message);
    throw error;
  }
  if (!stats.isFile()) throw new Error(message);
  return stats;
}

function assertValidCreatedAt(createdAt: unknown): asserts createdAt is string {
  if (typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))) {
    throw new Error("안전 사본 생성 시각 형식이 올바르지 않습니다.");
  }
}

function assertValidTargets(targets: unknown): asserts targets is BackupTarget[] {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("안전 사본 대상이 올바르지 않습니다.");
  }
  const seen = new Set<string>();
  for (const target of targets) {
    if (!target || typeof target !== "object" || !["codex", "opencode"].includes((target as BackupTarget).target)) {
      throw new Error("안전 사본 대상이 올바르지 않습니다.");
    }
    const { scope } = target as BackupTarget;
    if (((target as BackupTarget).target === "codex" && scope !== undefined) ||
      ((target as BackupTarget).target === "opencode" && scope !== "user" && scope !== "project")) {
      throw new Error("안전 사본 대상 범위가 올바르지 않습니다.");
    }
    const key = `${(target as BackupTarget).target}:${scope ?? ""}`;
    if (seen.has(key)) throw new Error("안전 사본 대상이 중복되었습니다.");
    seen.add(key);
  }
}

function areSameTargets(left: BackupTarget[], right: BackupTarget[]): boolean {
  const targetKey = (target: BackupTarget) => `${target.target}:${target.scope ?? ""}`;
  return left.map(targetKey).sort().join(",") === right.map(targetKey).sort().join(",");
}

function assertValidEntry(entry: unknown, backupDirectory: string): asserts entry is BackupEntry {
  if (!entry || typeof entry !== "object") throw new Error("안전 사본 항목 형식이 올바르지 않습니다.");
  const backupEntry = entry as BackupEntry;
  if (
    typeof backupEntry.originalPath !== "string" ||
    typeof backupEntry.canonicalPath !== "string" ||
    typeof backupEntry.relativePath !== "string" ||
    typeof backupEntry.existed !== "boolean" ||
    !["absent", "file", "directory"].includes(backupEntry.kind ?? "") ||
    (backupEntry.mode !== undefined && (!Number.isInteger(backupEntry.mode) || backupEntry.mode < 0 || backupEntry.mode > 0o777))
  ) {
    throw new Error("안전 사본 항목 형식이 올바르지 않습니다.");
  }
  if (backupEntry.relativePath !== safeRelativePath(backupEntry.originalPath)) {
    throw new Error("안전 사본 항목 경로가 원본과 일치하지 않습니다.");
  }
  if (backupEntry.kind === "file") {
    if (!backupEntry.existed || typeof backupEntry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(backupEntry.sha256)) {
      throw new Error("안전 사본 파일 해시가 올바르지 않습니다.");
    }
  } else if (backupEntry.sha256 !== undefined || (backupEntry.kind === "absent" && backupEntry.existed)) {
    throw new Error("안전 사본 항목 상태가 올바르지 않습니다.");
  }
  assertSafeBackupEntry(backupEntry, backupDirectory);
}

function assertValidMetadata(index: BackupIndex): asserts index is BackupIndex & { metadata: BackupMetadata } {
  const metadata = index.metadata;
  if (!metadata || typeof metadata !== "object" ||
    typeof metadata.reason !== "string" ||
    typeof metadata.fileCount !== "number" || !Number.isSafeInteger(metadata.fileCount) || metadata.fileCount < 0 ||
    typeof metadata.totalSizeBytes !== "number" || !Number.isSafeInteger(metadata.totalSizeBytes) || metadata.totalSizeBytes < 0 ||
    typeof metadata.restorable !== "boolean" ||
    (metadata.restoreFailureReason !== undefined && typeof metadata.restoreFailureReason !== "string")) {
    throw new Error("안전 사본 메타데이터 형식이 올바르지 않습니다.");
  }
  assertValidCreatedAt(metadata.createdAt);
  assertValidTargets(metadata.targets);
  if (metadata.createdAt !== index.createdAt || metadata.reason !== index.reason || !areSameTargets(metadata.targets, index.targets)) {
    throw new Error("안전 사본 메타데이터가 실제 기록과 일치하지 않습니다.");
  }
  for (const target of metadata.targets) {
    if (target.installedVersion !== undefined && typeof target.installedVersion !== "string") {
      throw new Error("안전 사본 설치 버전 형식이 올바르지 않습니다.");
    }
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
  installedVersions: Array<{ target: LifecycleTarget; scope?: "user" | "project"; installedVersion?: string }> = targets,
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
  const createdAt = new Date().toISOString();
  const metadata: BackupMetadata = {
    createdAt,
    targets: installedVersions,
    reason,
    fileCount: entries.filter((entry) => entry.existed && entry.kind === "file").length,
    totalSizeBytes: entries.reduce((total, entry) => total + (entry.existed && entry.kind === "file" ? fs.statSync(path.join(backupDirectory, "files", entry.relativePath)).size : 0), 0),
    restorable: true,
  };
  const index: BackupIndex = {
    schemaVersion: 3,
    id,
    createdAt,
    reason,
    targets,
    entries,
    metadata,
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
  if (!fs.lstatSync(backupDirectory).isDirectory()) throw new Error("안전 사본 디렉터리가 올바르지 않습니다.");
  const indexPath = path.join(backupDirectory, "index.json");
  assertRegularFile(indexPath, "안전 사본 index 파일이 올바르지 않습니다.");
  const parsed = JSON.parse(
    fs.readFileSync(indexPath, "utf-8"),
  ) as BackupIndex;
  if (
    !parsed || typeof parsed !== "object" ||
    (parsed.schemaVersion !== 2 && parsed.schemaVersion !== 3) ||
    parsed.id !== id ||
    typeof parsed.reason !== "string" ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error("안전 사본 형식이 올바르지 않습니다.");
  }
  assertValidCreatedAt(parsed.createdAt);
  assertValidTargets(parsed.targets);
  if (parsed.schemaVersion === 3) assertValidMetadata(parsed);
  if (parsed.schemaVersion === 2 && parsed.metadata !== undefined) throw new Error("이전 형식 안전 사본에 허용되지 않는 메타데이터가 있습니다.");
  const relativePaths = new Set<string>();
  for (const entry of parsed.entries) {
    assertValidEntry(entry, backupDirectory);
    if (relativePaths.has(entry.relativePath)) throw new Error("안전 사본에 중복된 파일 경로가 있습니다.");
    relativePaths.add(entry.relativePath);
  }
  return parsed;
}

function fallbackMetadata(index: BackupIndex): BackupMetadata {
  return {
    createdAt: index.createdAt,
    targets: index.targets,
    reason: index.reason,
    fileCount: index.entries.filter((entry) => entry.existed && entry.kind === "file").length,
    totalSizeBytes: 0,
    restorable: true,
  };
}

interface VerifiedBackupPayload {
  fileCount: number;
  totalSizeBytes: number;
}

function validateBackupPayload(env: NodeJS.ProcessEnv, index: BackupIndex): VerifiedBackupPayload {
  const backupDirectory = path.join(getLifecycleBackupDirectory(env), index.id);
  const expectedPayloadPaths = new Set<string>();
  let fileCount = 0;
  let totalSizeBytes = 0;
  for (const entry of index.entries) {
    assertValidEntry(entry, backupDirectory);
    if (entry.kind !== "file") continue;
    const contentPath = path.join(backupDirectory, "files", entry.relativePath);
    const stats = assertRegularFile(contentPath, `안전 사본 내용 파일이 없거나 올바르지 않습니다: ${entry.originalPath}`);
    const content = fs.readFileSync(contentPath);
    if (entry.sha256 !== sha256(content)) throw new Error(`안전 사본 해시가 일치하지 않습니다: ${entry.originalPath}`);
    expectedPayloadPaths.add(path.resolve(contentPath));
    fileCount += 1;
    totalSizeBytes += stats.size;
  }
  const filesDirectory = path.join(backupDirectory, "files");
  if (expectedPayloadPaths.size > 0) {
    if (!fs.lstatSync(filesDirectory).isDirectory()) throw new Error("안전 사본 내용 디렉터리가 올바르지 않습니다.");
    for (const entry of fs.readdirSync(filesDirectory, { withFileTypes: true })) {
      const payloadPath = path.join(filesDirectory, entry.name);
      if (!entry.isFile() || entry.isSymbolicLink() || !expectedPayloadPaths.has(path.resolve(payloadPath))) {
        throw new Error("안전 사본에 기록되지 않은 내용이 있습니다.");
      }
    }
  } else if (fs.existsSync(filesDirectory)) {
    if (!fs.lstatSync(filesDirectory).isDirectory() || fs.readdirSync(filesDirectory).length > 0) {
      throw new Error("안전 사본에 기록되지 않은 내용이 있습니다.");
    }
  }
  if (index.schemaVersion === 3) {
    assertValidMetadata(index);
    if (index.metadata.fileCount !== fileCount || index.metadata.totalSizeBytes !== totalSizeBytes) {
      throw new Error("안전 사본 메타데이터의 파일 수 또는 크기가 실제 내용과 일치하지 않습니다.");
    }
  }
  return { fileCount, totalSizeBytes };
}

export function getBackupSummary(index: BackupIndex, payload?: VerifiedBackupPayload): BackupSummary {
  const metadata = index.metadata ?? fallbackMetadata(index);
  return {
    id: index.id,
    ...metadata,
    fileCount: payload?.fileCount ?? metadata.fileCount,
    totalSizeBytes: payload?.totalSizeBytes ?? metadata.totalSizeBytes,
  };
}

/** 복원 가능한 항목을 최신 생성 시각 순으로 앞에 두고, 손상된 항목은 뒤로 분리한다. */
export function listBackupSummaries(
  env: NodeJS.ProcessEnv,
  getAllowedRoots?: (backup: BackupIndex) => string[],
): BackupSummary[] {
  const directory = getLifecycleBackupDirectory(env);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        const backup = readBackup(env, entry.name);
        const payload = getAllowedRoots
          ? validateBackupRestore(env, backup, getAllowedRoots(backup))
          : validateBackupPayload(env, backup);
        const summary = getBackupSummary(backup, payload);
        if (!summary.restorable) {
          return { ...summary, restorable: false, restoreFailureReason: summary.restoreFailureReason ?? "기록에서 복원 불가로 표시되었습니다." };
        }
        return summary;
      } catch (error) {
        return {
          id: entry.name,
          createdAt: "알 수 없음",
          targets: [],
          reason: "확인 불가",
          fileCount: 0,
          totalSizeBytes: 0,
          restorable: false,
          restoreFailureReason: error instanceof Error ? error.message : String(error),
        } satisfies BackupSummary;
      }
    })
    .sort((left, right) => Number(right.restorable) - Number(left.restorable)
      || right.createdAt.localeCompare(left.createdAt)
      || left.id.localeCompare(right.id));
}

/** 파일을 변경하기 전 현재 환경·대상에서 복원 가능한지 검사한다. */
export function validateBackupRestore(
  env: NodeJS.ProcessEnv,
  index: BackupIndex,
  allowedRoots: string[],
): VerifiedBackupPayload {
  const backupDirectory = path.join(getLifecycleBackupDirectory(env), index.id);
  const payload = validateBackupPayload(env, index);
  if (index.schemaVersion === 3 && index.metadata && !index.metadata.restorable) {
    throw new Error(index.metadata.restoreFailureReason ?? "안전 사본 기록에서 복원 불가로 표시되었습니다.");
  }
  for (const entry of index.entries) {
    assertSafeBackupEntry(entry, backupDirectory);
    assertRestoreEntryPathSafe(entry, allowedRoots);
  }
  return payload;
}

export function restoreBackup(env: NodeJS.ProcessEnv, index: BackupIndex, allowedRoots: string[]): void {
  const backupDirectory = path.join(getLifecycleBackupDirectory(env), index.id);
  validateBackupRestore(env, index, allowedRoots);
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
