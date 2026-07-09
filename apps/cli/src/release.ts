import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { readManagedState, sha256 } from "opencode/core";
import {
  DEFAULT_RELEASE_URL,
  SHA256_HEX_PATTERN,
  VERSION_CHECK_TIMEOUT_MS,
} from "@cli/constants";
import { isJsonObject } from "@cli/fs-utils";
import {
  getCurrentPluginVersion,
  getPackageVersion,
} from "@cli/paths";
import type {
  CliIO,
  LatestManifest,
  LatestManifestArtifact,
  LatestManifestArtifactName,
} from "@cli/types";
import { ReleaseManifestError } from "@cli/types";

const cachedVersionNoticeByReleaseUrl = new Map<string, string | null>();

export async function readLocation(
  location: string,
  timeoutMs?: number,
): Promise<Buffer> {
  if (location.startsWith("file://")) {
    return fs.readFileSync(fileURLToPath(location));
  }
  if (!/^https?:\/\//.test(location)) {
    return fs.readFileSync(location);
  }
  const abortController = timeoutMs ? new AbortController() : undefined;
  const timeout = abortController
    ? setTimeout(() => abortController.abort(), timeoutMs)
    : undefined;
  let response: Response;
  try {
    response = await fetch(location, {
      signal: abortController?.signal,
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`${location} 응답 실패: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function getLatestManifestArtifact(
  manifest: LatestManifest,
  artifactName: LatestManifestArtifactName,
): LatestManifestArtifact | null {
  return manifest[artifactName] ?? null;
}

function assertLatestManifestStringField(
  manifest: Record<string, unknown>,
  fieldName: keyof LatestManifest,
): string {
  const value = manifest[fieldName];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ReleaseManifestError(
      `latest.json의 ${String(fieldName)} 필드는 비어 있지 않은 string이어야 합니다.`,
    );
  }
  return value;
}

function assertArtifactLocation(location: string, fieldPath: string): void {
  if (location.trim() === "" || location.includes("\0")) {
    throw new ReleaseManifestError(
      `latest.json의 ${fieldPath} 필드는 유효한 artifact 위치여야 합니다.`,
    );
  }
  if (location.startsWith("file://")) {
    try {
      fileURLToPath(location);
      return;
    } catch {
      throw new ReleaseManifestError(
        `latest.json의 ${fieldPath} 필드는 유효한 file URL이어야 합니다.`,
      );
    }
  }
  if (/^https?:\/\//.test(location)) {
    try {
      new URL(location);
      return;
    } catch {
      throw new ReleaseManifestError(
        `latest.json의 ${fieldPath} 필드는 유효한 HTTP URL이어야 합니다.`,
      );
    }
  }
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(location)) {
    throw new ReleaseManifestError(
      `latest.json의 ${fieldPath} 필드는 file, http, https 또는 로컬 파일 경로만 지원합니다.`,
    );
  }
}

function validateLatestManifestArtifact(
  manifest: Record<string, unknown>,
  artifactName: LatestManifestArtifactName,
): LatestManifestArtifact | undefined {
  const artifact = manifest[artifactName];
  if (artifact === undefined) return undefined;
  if (!isJsonObject(artifact)) {
    throw new ReleaseManifestError(
      `latest.json의 ${artifactName} artifact는 object여야 합니다.`,
    );
  }
  const url = artifact.url;
  if (typeof url !== "string") {
    throw new ReleaseManifestError(
      `latest.json의 ${artifactName}.url 필드는 string이어야 합니다.`,
    );
  }
  assertArtifactLocation(url, `${artifactName}.url`);

  const sha256Checksum = artifact.sha256;
  if (
    typeof sha256Checksum !== "string" ||
    !SHA256_HEX_PATTERN.test(sha256Checksum)
  ) {
    throw new ReleaseManifestError(
      `latest.json의 ${artifactName}.sha256 필드는 64자리 sha256 hex string이어야 합니다.`,
    );
  }
  return { url, sha256: sha256Checksum.toLowerCase() };
}

export function parseLatestManifest(content: string): LatestManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ReleaseManifestError(`latest.json 파싱 실패: ${message}`);
  }
  if (!isJsonObject(parsed)) {
    throw new ReleaseManifestError("latest.json은 JSON object여야 합니다.");
  }
  return {
    cliVersion: assertLatestManifestStringField(parsed, "cliVersion"),
    catalogVersion: assertLatestManifestStringField(parsed, "catalogVersion"),
    minimumCliVersion: assertLatestManifestStringField(
      parsed,
      "minimumCliVersion",
    ),
    minimumPluginVersion: assertLatestManifestStringField(
      parsed,
      "minimumPluginVersion",
    ),
    publishedAt: assertLatestManifestStringField(parsed, "publishedAt"),
    catalog: validateLatestManifestArtifact(parsed, "catalog"),
    codexAgents: validateLatestManifestArtifact(parsed, "codexAgents"),
    cli: validateLatestManifestArtifact(parsed, "cli"),
  };
}

export async function readLatestManifest(
  env: NodeJS.ProcessEnv,
  options: { timeoutMs?: number } = {},
): Promise<LatestManifest> {
  const releaseUrl = env.AGENTS_RELEASE_URL ?? DEFAULT_RELEASE_URL;
  const content = await readLocation(releaseUrl, options.timeoutMs);
  return parseLatestManifest(content.toString("utf-8"));
}

export function compareVersions(left: string, right: string): number {
  const leftParts = left.replace(/^v/, "").split(/[.-]/);
  const rightParts = right.replace(/^v/, "").split(/[.-]/);
  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < maxLength; index++) {
    const leftValue = Number.parseInt(leftParts[index] ?? "0", 10);
    const rightValue = Number.parseInt(rightParts[index] ?? "0", 10);
    const safeLeftValue = Number.isNaN(leftValue) ? 0 : leftValue;
    const safeRightValue = Number.isNaN(rightValue) ? 0 : rightValue;
    if (safeLeftValue > safeRightValue) return 1;
    if (safeLeftValue < safeRightValue) return -1;
  }
  return 0;
}

export function assertLatestManifestCompatibility(
  manifest: LatestManifest,
  projectDirectory: string,
  commandName: "update" | "upgrade",
): void {
  const currentCliVersion = getPackageVersion();
  const currentPluginVersion = getCurrentPluginVersion();
  if (compareVersions(manifest.minimumCliVersion, currentCliVersion) > 0) {
    throw new ReleaseManifestError(
      `latest.json은 agents CLI ${manifest.minimumCliVersion} 이상이 필요합니다. 현재 버전: ${currentCliVersion}`,
    );
  }
  if (
    compareVersions(manifest.minimumPluginVersion, currentPluginVersion) > 0
  ) {
    throw new ReleaseManifestError(
      `latest.json은 agents plugin ${manifest.minimumPluginVersion} 이상이 필요합니다. 현재 버전: ${currentPluginVersion}`,
    );
  }

  if (
    commandName === "upgrade" &&
    compareVersions(manifest.cliVersion, currentCliVersion) < 0
  ) {
    throw new ReleaseManifestError(
      `downgrade는 지원하지 않습니다. 현재 CLI 버전: ${currentCliVersion}, manifest CLI 버전: ${manifest.cliVersion}`,
    );
  }

  const state = readManagedState(projectDirectory);
  if (
    commandName === "update" &&
    state?.catalogVersion &&
    compareVersions(manifest.catalogVersion, state.catalogVersion) < 0
  ) {
    throw new ReleaseManifestError(
      `catalog downgrade는 지원하지 않습니다. 현재 catalog 버전: ${state.catalogVersion}, manifest catalog 버전: ${manifest.catalogVersion}`,
    );
  }
}

export function requireLatestManifestArtifact(
  manifest: LatestManifest,
  artifactName: LatestManifestArtifactName,
): LatestManifestArtifact {
  const artifact = getLatestManifestArtifact(manifest, artifactName);
  if (!artifact) {
    throw new ReleaseManifestError(
      `latest.json에 ${artifactName} artifact 정보가 없습니다.`,
    );
  }
  return artifact;
}

export function reportReleaseManifestError(
  error: unknown,
  io: Required<CliIO>,
): boolean {
  if (!(error instanceof ReleaseManifestError)) return false;
  io.stderr(`release-manifest-invalid: ${error.message}`);
  return true;
}

async function getVersionNotice(
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const releaseUrl = env.AGENTS_RELEASE_URL ?? DEFAULT_RELEASE_URL;
  const cachedVersionNotice = cachedVersionNoticeByReleaseUrl.get(releaseUrl);
  if (cachedVersionNotice !== undefined) {
    return cachedVersionNotice;
  }
  try {
    const currentVersion = getPackageVersion();
    const latest = await readLatestManifest(env, {
      timeoutMs: VERSION_CHECK_TIMEOUT_MS,
    });
    const notice =
      compareVersions(latest.cliVersion, currentVersion) > 0
        ? `upgrade-available: agents ${currentVersion} -> ${latest.cliVersion}. 실행: agents upgrade`
        : null;
    cachedVersionNoticeByReleaseUrl.set(releaseUrl, notice);
    return notice;
  } catch {
    cachedVersionNoticeByReleaseUrl.set(releaseUrl, null);
    return null;
  }
}

export async function notifyUpgradeIfAvailable(
  io: Required<CliIO>,
): Promise<void> {
  const notice = await getVersionNotice(io.env);
  if (notice) {
    io.stderr(notice);
  }
}

export function verifyChecksum(
  content: Buffer,
  expectedChecksum: string,
): void {
  const actualChecksum = sha256(content);
  if (actualChecksum !== expectedChecksum) {
    throw new Error(
      `checksum mismatch: expected ${expectedChecksum}, actual ${actualChecksum}`,
    );
  }
}
