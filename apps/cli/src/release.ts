import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { readManagedState, sha256 } from "opencode/core";
import {
  DEFAULT_RELEASE_URL,
  SHA256_HEX_PATTERN,
  VERSION_CHECK_TIMEOUT_MS,
} from "@cli/constants";
import { isJsonObject } from "@cli/fs-utils";
import { getCurrentPluginVersion, getPackageRoot, getPackageVersion } from "@cli/paths";
import type {
  CliIO,
  LatestManifest,
  LatestManifestArtifact,
  LatestManifestArtifactName,
  LatestManifestSigning,
} from "@cli/types";
import { ReleaseManifestError } from "@cli/types";

const VERSION_NOTICE_CACHE_TTL_MS = 60_000;
const MAX_REMOTE_ARTIFACT_BYTES = 50 * 1024 * 1024;
const cachedVersionNoticeByReleaseUrl = new Map<
  string,
  { value: string | null; expiresAt: number }
>();

/** 명시적으로 내장 배포 자원을 사용할 때 원격 배포 목록 조회를 막는다. */
export function usesBundledReleaseSource(env: NodeJS.ProcessEnv): boolean {
  return env.AGENTS_RELEASE_SOURCE === "bundled";
}

export async function readLocation(
  location: string,
  timeoutMs?: number,
  maximumBytes = MAX_REMOTE_ARTIFACT_BYTES,
): Promise<Buffer> {
  if (location.startsWith("file://")) {
    const filePath = fileURLToPath(location);
    if (fs.statSync(filePath).size > maximumBytes) {
      throw new Error(`${location}의 크기가 허용 범위를 벗어났습니다.`);
    }
    return fs.readFileSync(filePath);
  }
  if (!/^https?:\/\//.test(location)) {
    if (fs.statSync(location).size > maximumBytes) {
      throw new Error(`${location}의 크기가 허용 범위를 벗어났습니다.`);
    }
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
  const contentLength = response.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)) {
    throw new Error(`${location}의 응답 크기가 허용 범위를 벗어났습니다.`);
  }
  if (!response.body) throw new Error(`${location}의 응답 본문이 없습니다.`);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new Error(`${location}의 응답 크기가 허용 범위를 벗어났습니다.`);
      }
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
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
  const version = artifact.version;
  const size = artifact.size;
  const compatibility = artifact.compatibility;
  const requiredFiles = artifact.requiredFiles;
  if (version !== undefined && (typeof version !== "string" || version.trim() === "")) {
    throw new ReleaseManifestError(`latest.json의 ${artifactName}.version 필드는 비어 있지 않은 string이어야 합니다.`);
  }
  if (size !== undefined && (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > MAX_REMOTE_ARTIFACT_BYTES)) {
    throw new ReleaseManifestError(`latest.json의 ${artifactName}.size 필드는 허용 범위의 byte 수여야 합니다.`);
  }
  if (compatibility !== undefined) {
    if (!isJsonObject(compatibility) || typeof compatibility.minimumCliVersion !== "string" || typeof compatibility.maximumCliVersion !== "string") {
      throw new ReleaseManifestError(`latest.json의 ${artifactName}.compatibility 필드는 최소/최대 CLI 버전을 가져야 합니다.`);
    }
  }
  if (requiredFiles !== undefined && (!Array.isArray(requiredFiles) || requiredFiles.some((file) => typeof file !== "string" || file === "" || file.includes("..") || file.startsWith("/")))) {
    throw new ReleaseManifestError(`latest.json의 ${artifactName}.requiredFiles 필드가 안전하지 않습니다.`);
  }
  return {
    url,
    sha256: sha256Checksum.toLowerCase(),
    ...(version === undefined ? {} : { version }),
    ...(typeof size !== "number" ? {} : { size }),
    ...(compatibility === undefined ? {} : { compatibility: compatibility as { minimumCliVersion: string; maximumCliVersion: string } }),
    ...(requiredFiles === undefined ? {} : { requiredFiles: requiredFiles as string[] }),
  };
}

function validateSigning(manifest: Record<string, unknown>): LatestManifestSigning | undefined {
  if (manifest.signing === undefined) return undefined;
  if (!isJsonObject(manifest.signing) || manifest.signing.algorithm !== "ed25519" || typeof manifest.signing.keyId !== "string" || !/^[a-f0-9]{16}$/i.test(manifest.signing.keyId) || typeof manifest.signing.signature !== "string") {
    throw new ReleaseManifestError("latest.json의 signing 필드가 올바르지 않습니다.");
  }
  return {
    algorithm: "ed25519",
    keyId: manifest.signing.keyId,
    signature: manifest.signing.signature,
  };
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
  const manifest = {
    ...(parsed.formatVersion === undefined ? {} : { formatVersion: parsed.formatVersion === 2 ? 2 as const : (() => { throw new ReleaseManifestError("지원하지 않는 latest.json formatVersion입니다."); })() }),
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
    opencode: validateLatestManifestArtifact(parsed, "opencode"),
    signing: validateSigning(parsed),
  };
  if (manifest.formatVersion === 2) {
    for (const artifactName of ["catalog", "cli", "opencode", "codexAgents"] as const) {
      const artifact = manifest[artifactName];
      if (!artifact?.version || !artifact.compatibility || !artifact.requiredFiles || artifact.size === undefined) {
        throw new ReleaseManifestError(`latest.json의 ${artifactName} artifact는 v2 계약(version, size, compatibility, requiredFiles)을 모두 가져야 합니다.`);
      }
      if (compareVersions(artifact.compatibility.minimumCliVersion, artifact.compatibility.maximumCliVersion) > 0) {
        throw new ReleaseManifestError(`latest.json의 ${artifactName}.compatibility 버전 범위가 올바르지 않습니다.`);
      }
    }
  }
  return manifest;
}

function canonicalManifest(manifest: LatestManifest): Buffer {
  const { signing: _signing, ...unsigned } = manifest;
  const sortValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortValue);
    if (isJsonObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
    return value;
  };
  return Buffer.from(JSON.stringify(sortValue(unsigned)));
}

function getReleasePublicKey(env: NodeJS.ProcessEnv): string | null {
  if (env.AGENTS_RELEASE_PUBLIC_KEY_BASE64) return Buffer.from(env.AGENTS_RELEASE_PUBLIC_KEY_BASE64, "base64").toString("utf-8");
  if (env.AGENTS_RELEASE_PUBLIC_KEY) return env.AGENTS_RELEASE_PUBLIC_KEY;
  const packageRoot = getPackageRoot();
  const bundledKeyPath = packageRoot ? `${packageRoot}/release-public-key.pem` : "";
  return bundledKeyPath && fs.existsSync(bundledKeyPath) ? fs.readFileSync(bundledKeyPath, "utf-8") : null;
}

function verifyLatestManifestSignature(manifest: LatestManifest, location: string, env: NodeJS.ProcessEnv): void {
  if (location.startsWith("file://") || !/^https?:\/\//.test(location)) return;
  if (!manifest.signing) throw new ReleaseManifestError("원격 latest.json에 서명이 없습니다.");
  const publicKey = getReleasePublicKey(env);
  if (!publicKey) throw new ReleaseManifestError("원격 latest.json 검증 공개키가 설정되지 않았습니다.");
  try {
    if (!crypto.verify(null, canonicalManifest(manifest), crypto.createPublicKey(publicKey), Buffer.from(manifest.signing.signature, "base64"))) {
      throw new Error("signature mismatch");
    }
  } catch {
    throw new ReleaseManifestError("원격 latest.json 서명 검증에 실패했습니다.");
  }
}

export async function readLatestManifest(
  env: NodeJS.ProcessEnv,
  options: { timeoutMs?: number } = {},
): Promise<LatestManifest> {
  const releaseUrl = env.AGENTS_RELEASE_URL ?? DEFAULT_RELEASE_URL;
  try {
    const content = await readLocation(releaseUrl, options.timeoutMs);
    const manifest = parseLatestManifest(content.toString("utf-8"));
    verifyLatestManifestSignature(manifest, releaseUrl, env);
    return manifest;
  } catch (error) {
    if (error instanceof ReleaseManifestError) throw error;
    throw new ReleaseManifestError(`배포 주소 확인 실패: ${releaseUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function compareVersions(left: string, right: string): number {
  const parseVersion = (value: string) => {
    const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
    if (!match) throw new ReleaseManifestError(`올바른 버전 규칙이 아닙니다: ${value}`);
    return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4]?.split(".") ?? [] };
  };
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftVersion.core[index] > rightVersion.core[index]) return 1;
    if (leftVersion.core[index] < rightVersion.core[index]) return -1;
  }
  if (leftVersion.prerelease.length === 0 && rightVersion.prerelease.length > 0) return 1;
  if (leftVersion.prerelease.length > 0 && rightVersion.prerelease.length === 0) return -1;
  const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function compareCatalogVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number(part));
  const rightParts = right.split(".").map((part) => Number(part));
  if (leftParts.some(Number.isNaN) || rightParts.some(Number.isNaN)) {
    throw new ReleaseManifestError(`catalog 버전이 올바르지 않습니다: ${left}, ${right}`);
  }
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    if ((leftParts[index] ?? 0) > (rightParts[index] ?? 0)) return 1;
    if ((leftParts[index] ?? 0) < (rightParts[index] ?? 0)) return -1;
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
    compareCatalogVersions(manifest.catalogVersion, state.catalogVersion) < 0
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

export function assertArtifactCompatibility(
  artifact: LatestManifestArtifact,
  currentCliVersion: string,
): void {
  if (!artifact.compatibility) return;
  if (compareVersions(currentCliVersion, artifact.compatibility.minimumCliVersion) < 0 ||
    compareVersions(currentCliVersion, artifact.compatibility.maximumCliVersion) > 0) {
    throw new ReleaseManifestError(
      `artifact는 agents CLI ${artifact.compatibility.minimumCliVersion}부터 ${artifact.compatibility.maximumCliVersion}까지만 지원합니다. 현재 버전: ${currentCliVersion}`,
    );
  }
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
  if (usesBundledReleaseSource(env)) return null;
  const releaseUrl = env.AGENTS_RELEASE_URL ?? DEFAULT_RELEASE_URL;
  const cachedVersionNotice = cachedVersionNoticeByReleaseUrl.get(releaseUrl);
  if (cachedVersionNotice && cachedVersionNotice.expiresAt > Date.now()) {
    return cachedVersionNotice.value;
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
    cachedVersionNoticeByReleaseUrl.set(releaseUrl, { value: notice, expiresAt: Date.now() + VERSION_NOTICE_CACHE_TTL_MS });
    return notice;
  } catch {
    // 일시 네트워크 실패를 영구 캐시하지 않아 다음 명령에서 다시 확인할 수 있다.
    cachedVersionNoticeByReleaseUrl.set(releaseUrl, { value: null, expiresAt: Date.now() + VERSION_NOTICE_CACHE_TTL_MS });
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
