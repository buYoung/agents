import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { parse } from "smol-toml";
import type {
  CliArtifactApplyResult,
  CodexAgentsArtifactApplyResult,
  FileSnapshot,
} from "@cli/types";
import {
  restoreFileSnapshot,
  snapshotFile,
} from "@cli/fs-utils";
import { getPackageRoot } from "@cli/paths";
import { compareVersions } from "@cli/release";

const CODEX_AGENT_VERSIONS_FILE = "versions.json";

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

function listTomlFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTomlFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".toml")) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

function readTomlStringField(filePath: string, fieldName: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const parsed = parse(fs.readFileSync(filePath, "utf-8")) as Record<
    string,
    unknown
  >;
  const value = parsed[fieldName];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readCodexAgentVersions(directory: string): Record<string, string> {
  const versionsPath = path.join(directory, CODEX_AGENT_VERSIONS_FILE);
  if (!fs.existsSync(versionsPath)) return {};
  const parsed = JSON.parse(fs.readFileSync(versionsPath, "utf-8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${versionsPath} must be a JSON object`);
  }

  const versions: Record<string, string> = {};
  for (const [agentName, version] of Object.entries(parsed)) {
    if (typeof version === "string" && version.trim() !== "") {
      versions[agentName] = version;
    }
  }
  return versions;
}

function writeCodexAgentVersions(
  directory: string,
  versions: Record<string, string>,
): void {
  const sortedVersions = Object.fromEntries(
    Object.entries(versions).sort(([leftName], [rightName]) =>
      leftName.localeCompare(rightName),
    ),
  );
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, CODEX_AGENT_VERSIONS_FILE),
    JSON.stringify(sortedVersions, null, 2) + "\n",
    "utf-8",
  );
}

export function applyCodexAgentsArtifact(
  artifact: Buffer,
  targetDirectory: string,
): CodexAgentsArtifactApplyResult {
  const stagingDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "agents-codex-agents-"),
  );
  try {
    unpackTarGz(artifact, stagingDirectory);
    const sourceFiles = listTomlFiles(stagingDirectory);
    const sourceVersions = readCodexAgentVersions(stagingDirectory);
    let targetVersions: Record<string, string> = {};
    try {
      targetVersions = readCodexAgentVersions(targetDirectory);
    } catch {
      targetVersions = {};
    }
    const updates: Array<{
      agentName: string;
      sourceVersion: string;
      sourcePath: string;
      targetPath: string;
    }> = [];
    const skippedAgents: string[] = [];
    const seenAgentNames = new Set<string>();

    for (const sourcePath of sourceFiles) {
      const agentName = readTomlStringField(sourcePath, "name");
      if (!agentName) {
        throw new Error(`${sourcePath} missing Codex agent name`);
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(agentName)) {
        throw new Error(`${sourcePath} has unsafe Codex agent name`);
      }
      if (seenAgentNames.has(agentName)) {
        throw new Error(`${sourcePath} duplicates Codex agent name ${agentName}`);
      }
      seenAgentNames.add(agentName);
      const sourceVersion = sourceVersions[agentName];
      if (!sourceVersion) {
        throw new Error(`${sourcePath} missing Codex agent version metadata`);
      }

      const targetPath = path.join(targetDirectory, `${agentName}.toml`);
      const targetVersion = targetVersions[agentName] ?? null;
      if (targetVersion && compareVersions(sourceVersion, targetVersion) <= 0) {
        skippedAgents.push(agentName);
      } else {
        updates.push({ agentName, sourceVersion, sourcePath, targetPath });
      }
    }

    const versionsPath = path.join(targetDirectory, CODEX_AGENT_VERSIONS_FILE);
    const targetSnapshots = [
      ...updates.map((update) => snapshotFile(update.targetPath)),
      ...(updates.length > 0 ? [snapshotFile(versionsPath)] : []),
    ];

    try {
      for (const update of updates) {
        atomicCopyFile(update.sourcePath, update.targetPath);
        targetVersions[update.agentName] = update.sourceVersion;
      }
      if (updates.length > 0) {
        writeCodexAgentVersions(targetDirectory, targetVersions);
      }
    } catch (error) {
      for (const targetSnapshot of [...targetSnapshots].reverse()) {
        restoreFileSnapshot(targetSnapshot);
      }
      throw error;
    }

    return {
      targetDirectory,
      updatedAgents: updates.map((update) => update.agentName).sort(),
      skippedAgents: skippedAgents.sort(),
      targetSnapshots,
    };
  } finally {
    fs.rmSync(stagingDirectory, { recursive: true, force: true });
  }
}
