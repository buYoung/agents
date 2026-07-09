import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import type { CliArtifactApplyResult, FileSnapshot } from "@cli/types";
import {
  restoreFileSnapshot,
  snapshotFile,
} from "@cli/fs-utils";
import { getPackageRoot } from "@cli/paths";

function parseOctal(value: Buffer): number {
  const text = value.toString("utf-8").replace(/\0.*$/, "").trim();
  return text ? Number.parseInt(text, 8) : 0;
}

function assertSafeArchivePath(entryName: string): string {
  const normalized = entryName.replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    normalized.includes("../") ||
    normalized === ".." ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new Error(`unsafe archive path: ${entryName}`);
  }
  return normalized;
}

export function unpackTarGz(
  archive: Buffer,
  destinationDirectory: string,
): void {
  const tarContent = zlib.gunzipSync(archive);
  let offset = 0;
  while (offset + 512 <= tarContent.length) {
    const header = tarContent.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = header.subarray(0, 100).toString("utf-8").replace(/\0.*$/, "");
    const prefix = header
      .subarray(345, 500)
      .toString("utf-8")
      .replace(/\0.*$/, "");
    const entryName = assertSafeArchivePath(
      prefix ? `${prefix}/${name}` : name,
    );
    const mode = parseOctal(header.subarray(100, 108)) & 0o777;
    const size = parseOctal(header.subarray(124, 136));
    const typeFlag = header.subarray(156, 157).toString("utf-8") || "0";
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    const destinationPath = path.join(destinationDirectory, entryName);

    if (typeFlag === "5") {
      fs.mkdirSync(destinationPath, { recursive: true });
    } else if (typeFlag === "0" || typeFlag === "\0") {
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.writeFileSync(
        destinationPath,
        tarContent.subarray(contentStart, contentEnd),
      );
      if (mode > 0) {
        fs.chmodSync(destinationPath, mode);
      }
    }

    offset = contentStart + Math.ceil(size / 512) * 512;
  }
}

function atomicCopyFile(sourcePath: string, targetPath: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const sourceMode = fs.statSync(sourcePath).mode & 0o777;
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  fs.copyFileSync(sourcePath, temporaryPath);
  fs.chmodSync(temporaryPath, sourceMode);
  fs.renameSync(temporaryPath, targetPath);
}

function copyDirectoryContents(
  sourceDirectory: string,
  targetDirectory: string,
): void {
  for (const entry of fs.readdirSync(sourceDirectory, {
    withFileTypes: true,
  })) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(targetDirectory, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryContents(sourcePath, targetPath);
    } else if (entry.isFile()) {
      atomicCopyFile(sourcePath, targetPath);
    }
  }
}

function snapshotCliArtifactTargets(
  sourcePath: string,
  targetPath: string,
): FileSnapshot[] {
  const sourceStats = fs.statSync(sourcePath);
  if (sourceStats.isFile()) {
    return [snapshotFile(targetPath)];
  }
  if (!sourceStats.isDirectory()) {
    return [];
  }

  const snapshots: FileSnapshot[] = [];
  for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
    snapshots.push(
      ...snapshotCliArtifactTargets(
        path.join(sourcePath, entry.name),
        path.join(targetPath, entry.name),
      ),
    );
  }
  return snapshots;
}

export function applyCliArtifact(artifact: Buffer): CliArtifactApplyResult {
  const packageRoot = getPackageRoot();
  if (!packageRoot) {
    throw new Error("package root를 찾을 수 없습니다.");
  }

  const stagingDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "agents-upgrade-"),
  );
  try {
    unpackTarGz(artifact, stagingDirectory);
    const allowedPaths = ["package.json", "pnpm-lock.yaml", "bin", "src"];
    const targetSnapshots: FileSnapshot[] = [];
    for (const relativePath of allowedPaths) {
      const sourcePath = path.join(stagingDirectory, relativePath);
      if (!fs.existsSync(sourcePath)) continue;

      const targetPath = path.join(packageRoot, relativePath);
      targetSnapshots.push(
        ...snapshotCliArtifactTargets(sourcePath, targetPath),
      );
    }

    try {
      for (const relativePath of allowedPaths) {
        const sourcePath = path.join(stagingDirectory, relativePath);
        if (!fs.existsSync(sourcePath)) continue;

        const targetPath = path.join(packageRoot, relativePath);
        const sourceStats = fs.statSync(sourcePath);
        if (sourceStats.isDirectory()) {
          copyDirectoryContents(sourcePath, targetPath);
        } else if (sourceStats.isFile()) {
          atomicCopyFile(sourcePath, targetPath);
        }
      }
    } catch (error) {
      for (const targetSnapshot of [...targetSnapshots].reverse()) {
        restoreFileSnapshot(targetSnapshot);
      }
      throw error;
    }

    return { packageRoot, targetSnapshots };
  } finally {
    fs.rmSync(stagingDirectory, { recursive: true, force: true });
  }
}
