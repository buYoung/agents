#!/usr/bin/env node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  buildProviderConfig,
  getCatalogSource,
  getBundledCatalogPath,
  getCatalogChecksum,
  getManagedCatalogPath,
  invalidateCatalogCache,
  loadCatalog,
  parseCatalog,
  sha256,
} from "opencode/core";
import {
  loadPluginConfig,
  validatePluginConfig,
  type ConfigLoadWarning,
} from "opencode/core";
import {
  USER_CONFIG_SCHEMA_VERSION,
  readManagedState,
  writeManagedState,
} from "opencode/core";
import type { AgentDefinition } from "opencode/core";
import { orchestratorAgent } from "opencode";
import { workerAgent } from "opencode";
import { plannerAgent } from "opencode";
import { researchAgent } from "opencode";
import { exploreAgent } from "opencode";
import { ideatorAgent } from "opencode";
import { adversarialReviewAgent } from "opencode";
import { constructiveFeedbackAgent } from "opencode";

const GITHUB_RELEASE_BASE =
  "https://github.com/buYoung/agents/releases/latest/download/";
const DEFAULT_RELEASE_URL = `${GITHUB_RELEASE_BASE}latest.json`;
const VERSION_CHECK_TIMEOUT_MS = 1500;
const OPENCODE_PLUGIN_ENTRY = "agents";
const OPENCODE_CONFIG_SCHEMA = "https://opencode.ai/config.json";
const EXIT_VALID = 0;
const EXIT_WARNING = 1;
const EXIT_INVALID = 2;
const EXIT_BLOCKED = 3;
const EXIT_INTERNAL = 4;
const AGENT_RECORD: Record<string, AgentDefinition> = Object.fromEntries(
  [
    orchestratorAgent,
    workerAgent,
    plannerAgent,
    researchAgent,
    exploreAgent,
    ideatorAgent,
    adversarialReviewAgent,
    constructiveFeedbackAgent,
  ].map((agent) => [agent.name, agent]),
);

interface CliIO {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

interface LatestManifest {
  cliVersion: string;
  catalogVersion: string;
  minimumCliVersion: string;
  minimumPluginVersion: string;
  publishedAt: string;
  catalog?: {
    url: string;
    sha256: string;
  };
  cli?: {
    url: string;
    sha256: string;
  };
}

interface InstallState {
  pluginAdded: boolean;
  providerAdded: boolean;
  nativeConfigPath: string;
  installedAt: string;
}

const cachedVersionNoticeByReleaseUrl = new Map<string, string | null>();

function printHelp(stdout: (line: string) => void): void {
  stdout(
    "사용법: agents <install|uninstall|validate|doctor|update|upgrade> [options]",
  );
  stdout("명령: install, uninstall, validate, doctor, update, upgrade");
}

function resolveProjectDirectory(args: string[], cwd: string): string {
  const projectIndex = args.indexOf("--project");
  if (projectIndex >= 0 && args[projectIndex + 1]) {
    return path.resolve(cwd, args[projectIndex + 1]);
  }
  return cwd;
}

function resolveUserConfigDirectory(env: NodeJS.ProcessEnv): string {
  if (env.OPENCODE_CONFIG_DIR) return env.OPENCODE_CONFIG_DIR;
  const configHome = env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(configHome, "opencode");
}

function getPackageVersion(): string {
  const packageRoot = getPackageRoot();
  if (!packageRoot) return "0.0.0";
  return (
    (
      JSON.parse(
        fs.readFileSync(path.join(packageRoot, "package.json"), "utf-8"),
      ) as { version?: string }
    ).version ?? "0.0.0"
  );
}

function getPackageRoot(): string | null {
  const startDirectory = path.dirname(fileURLToPath(import.meta.url));
  const cliPath = fileURLToPath(import.meta.url);
  let currentDirectory = startDirectory;
  while (currentDirectory !== path.dirname(currentDirectory)) {
    const packagePath = path.join(currentDirectory, "package.json");
    if (fs.existsSync(packagePath)) {
      const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8")) as {
        name?: string;
        bin?: string | Record<string, string>;
      };
      const binPath =
        typeof packageJson.bin === "string"
          ? packageJson.bin
          : packageJson.bin?.["agents"];
      const sourceCliPath = path.join(currentDirectory, "src", "cli.ts");
      if (
        binPath &&
        packageJson.name === "cli" &&
        (path.resolve(currentDirectory, binPath) === cliPath ||
          sourceCliPath === cliPath)
      ) {
        return currentDirectory;
      }
    }
    currentDirectory = path.dirname(currentDirectory);
  }
  return null;
}

async function readLocation(
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

async function readLatestManifest(
  env: NodeJS.ProcessEnv,
  options: { timeoutMs?: number } = {},
): Promise<LatestManifest> {
  const releaseUrl = env.AGENTS_RELEASE_URL ?? DEFAULT_RELEASE_URL;
  const content = await readLocation(releaseUrl, options.timeoutMs);
  return JSON.parse(content.toString("utf-8")) as LatestManifest;
}

function compareVersions(left: string, right: string): number {
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

async function notifyUpgradeIfAvailable(io: Required<CliIO>): Promise<void> {
  const notice = await getVersionNotice(io.env);
  if (notice) {
    io.stderr(notice);
  }
}

function verifyChecksum(content: Buffer, expectedChecksum: string): void {
  const actualChecksum = sha256(content);
  if (actualChecksum !== expectedChecksum) {
    throw new Error(
      `checksum mismatch: expected ${expectedChecksum}, actual ${actualChecksum}`,
    );
  }
}

function getProjectConfigPath(projectDirectory: string): string {
  return path.join(projectDirectory, ".opencode", "agents.toml");
}

function getUserConfigPath(env: NodeJS.ProcessEnv): string {
  return path.join(resolveUserConfigDirectory(env), "agents.toml");
}

function getNativeOpencodeConfigPath(
  scope: "user" | "project",
  projectDirectory: string,
  env: NodeJS.ProcessEnv,
): string {
  return scope === "user"
    ? path.join(resolveUserConfigDirectory(env), "opencode.json")
    : path.join(projectDirectory, "opencode.json");
}

function getInstallStatePath(
  scope: "user" | "project",
  projectDirectory: string,
  env: NodeJS.ProcessEnv,
): string {
  return scope === "user"
    ? path.join(resolveUserConfigDirectory(env), "agents.install.json")
    : path.join(projectDirectory, ".opencode", "agents.install.json");
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNativeOpencodeConfig(configPath: string): Record<string, unknown> {
  if (!fs.existsSync(configPath)) return {};
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as unknown;
  if (!isJsonObject(parsed)) {
    throw new Error(`${configPath}는 JSON object여야 합니다.`);
  }
  return parsed;
}

function writeNativeOpencodeConfig(
  configPath: string,
  config: Record<string, unknown>,
): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

function readInstallState(statePath: string): InstallState | null {
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

function writeInstallState(statePath: string, state: InstallState): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

function ensurePluginEntry(config: Record<string, unknown>): boolean {
  if (config.plugin !== undefined && !Array.isArray(config.plugin)) {
    throw new Error("opencode.json의 plugin 설정은 배열이어야 합니다.");
  }
  const pluginEntries = config.plugin ? [...config.plugin] : [];
  if (pluginEntries.includes(OPENCODE_PLUGIN_ENTRY)) return false;
  pluginEntries.push(OPENCODE_PLUGIN_ENTRY);
  config.plugin = pluginEntries;
  return true;
}

function removePluginEntry(config: Record<string, unknown>): boolean {
  if (!Array.isArray(config.plugin)) return false;
  const remainingPluginEntries = config.plugin.filter(
    (entry) => entry !== OPENCODE_PLUGIN_ENTRY,
  );
  if (remainingPluginEntries.length === config.plugin.length) return false;
  if (remainingPluginEntries.length === 0) {
    delete config.plugin;
  } else {
    config.plugin = remainingPluginEntries;
  }
  return true;
}

function ensureProvider(
  config: Record<string, unknown>,
  projectDirectory: string,
  scope: "user" | "project",
): boolean {
  const providerConfig = buildProviderConfig(
    scope === "project" ? loadCatalog(projectDirectory) : loadCatalog(),
  );
  if (config.provider !== undefined && !isJsonObject(config.provider)) {
    throw new Error("opencode.json의 provider 설정은 object여야 합니다.");
  }
  const providerMap = isJsonObject(config.provider) ? config.provider : {};
  if (isJsonObject(providerMap[providerConfig.id])) {
    return false;
  }
  config.provider = {
    ...providerMap,
    [providerConfig.id]: providerConfig,
  };
  return true;
}

function removeProvider(
  config: Record<string, unknown>,
  projectDirectory: string,
  scope: "user" | "project",
): "removed" | "missing" | "kept-custom" {
  if (!isJsonObject(config.provider)) return "missing";
  const providerConfig = buildProviderConfig(
    scope === "project" ? loadCatalog(projectDirectory) : loadCatalog(),
  );
  const currentProvider = config.provider[providerConfig.id];
  if (!isJsonObject(currentProvider)) return "missing";
  const currentOptions = isJsonObject(currentProvider.options)
    ? currentProvider.options
    : {};
  if (
    currentProvider.id !== providerConfig.id ||
    currentProvider.npm !== providerConfig.npm ||
    currentProvider.api !== providerConfig.api ||
    currentOptions.baseURL !== providerConfig.options.baseURL
  ) {
    return "kept-custom";
  }
  delete config.provider[providerConfig.id];
  if (Object.keys(config.provider).length === 0) {
    delete config.provider;
  }
  return "removed";
}

function accessStatus(filePath: string, mode: number): string {
  try {
    fs.accessSync(filePath, mode);
    return "yes";
  } catch {
    return "no";
  }
}

function directoryWriteStatus(filePath: string): string {
  let directory = path.dirname(filePath);
  while (!fs.existsSync(directory) && directory !== path.dirname(directory)) {
    directory = path.dirname(directory);
  }
  return accessStatus(directory, fs.constants.W_OK);
}

function getCatalogFreshness(
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

function unpackTarGz(archive: Buffer, destinationDirectory: string): void {
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

function applyCliArtifact(artifact: Buffer): string {
  const packageRoot = getPackageRoot();
  if (!packageRoot) {
    throw new Error("package root를 찾을 수 없습니다.");
  }

  const stagingDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "agents-upgrade-"),
  );
  try {
    unpackTarGz(artifact, stagingDirectory);
    const allowedPaths = [
      "package.json",
      "pnpm-lock.yaml",
      "bin",
      path.join("src", "cli.ts"),
    ];
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
    return packageRoot;
  } finally {
    fs.rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

async function install(args: string[], io: Required<CliIO>): Promise<number> {
  const scopeIndex = args.indexOf("--scope");
  const scope = scopeIndex >= 0 ? args[scopeIndex + 1] : undefined;
  if (scope !== "user" && scope !== "project") {
    io.stderr("install은 --scope user 또는 --scope project를 명시해야 합니다.");
    return EXIT_BLOCKED;
  }

  const projectDirectory = resolveProjectDirectory(args, io.cwd);
  const targetDirectory =
    scope === "user"
      ? resolveUserConfigDirectory(io.env)
      : path.join(projectDirectory, ".opencode");
  const targetPath = path.join(targetDirectory, "agents.toml");
  if (fs.existsSync(targetPath) && !args.includes("--force")) {
    io.stdout(`agents.toml 유지: ${targetPath}`);
  } else {
    fs.mkdirSync(targetDirectory, { recursive: true });
    const examplePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "packages",
      "opencode",
      "agents.example.toml",
    );
    if (fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, targetPath);
      io.stdout(`agents.toml 생성: ${targetPath}`);
    } else {
      io.stdout(
        `agents.example.toml 없음: ${examplePath} — agents.toml을 생성하지 않습니다.`,
      );
    }
  }

  const nativeConfigPath = getNativeOpencodeConfigPath(
    scope,
    projectDirectory,
    io.env,
  );
  const installStatePath = getInstallStatePath(scope, projectDirectory, io.env);
  const existingInstallState = readInstallState(installStatePath);
  const nativeConfig = readNativeOpencodeConfig(nativeConfigPath);
  if (!nativeConfig.$schema) {
    nativeConfig.$schema = OPENCODE_CONFIG_SCHEMA;
  }
  const pluginAdded = ensurePluginEntry(nativeConfig);
  const providerAdded = ensureProvider(nativeConfig, projectDirectory, scope);
  writeNativeOpencodeConfig(nativeConfigPath, nativeConfig);
  writeInstallState(installStatePath, {
    pluginAdded: existingInstallState?.pluginAdded === true || pluginAdded,
    providerAdded:
      existingInstallState?.providerAdded === true || providerAdded,
    nativeConfigPath,
    installedAt: existingInstallState?.installedAt || new Date().toISOString(),
  });
  io.stdout(`opencode.json 경로: ${nativeConfigPath}`);
  io.stdout(
    pluginAdded
      ? `opencode plugin 설정 추가: ${OPENCODE_PLUGIN_ENTRY}`
      : `opencode plugin 설정 유지: ${OPENCODE_PLUGIN_ENTRY}`,
  );
  io.stdout(
    providerAdded
      ? "opencode provider 설정 추가"
      : "opencode provider 설정 유지",
  );
  return EXIT_VALID;
}

async function uninstall(args: string[], io: Required<CliIO>): Promise<number> {
  const scopeIndex = args.indexOf("--scope");
  const scope = scopeIndex >= 0 ? args[scopeIndex + 1] : undefined;
  if (scope !== "user" && scope !== "project") {
    io.stderr(
      "uninstall은 --scope user 또는 --scope project를 명시해야 합니다.",
    );
    return EXIT_BLOCKED;
  }

  const projectDirectory = resolveProjectDirectory(args, io.cwd);
  const targetPath =
    scope === "user"
      ? getUserConfigPath(io.env)
      : getProjectConfigPath(projectDirectory);
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath);
    io.stdout(`agents.toml 삭제: ${targetPath}`);
  } else {
    io.stdout(`agents.toml 없음: ${targetPath}`);
  }

  const nativeConfigPath = getNativeOpencodeConfigPath(
    scope,
    projectDirectory,
    io.env,
  );
  const installStatePath = getInstallStatePath(scope, projectDirectory, io.env);
  if (!fs.existsSync(nativeConfigPath)) {
    if (fs.existsSync(installStatePath)) {
      fs.rmSync(installStatePath);
    }
    io.stdout(`opencode.json 없음: ${nativeConfigPath}`);
    return EXIT_VALID;
  }
  const nativeConfig = readNativeOpencodeConfig(nativeConfigPath);
  const installState = readInstallState(installStatePath);
  const pluginStatus =
    installState?.pluginAdded === true
      ? removePluginEntry(nativeConfig)
        ? "removed"
        : "missing"
      : "kept-custom";
  const providerStatus =
    installState?.providerAdded === true
      ? removeProvider(nativeConfig, projectDirectory, scope)
      : isJsonObject(nativeConfig.provider) &&
          isJsonObject(nativeConfig.provider["ollama-cloud"])
        ? "kept-custom"
        : "missing";
  writeNativeOpencodeConfig(nativeConfigPath, nativeConfig);
  if (fs.existsSync(installStatePath)) {
    fs.rmSync(installStatePath);
  }
  io.stdout(`opencode.json 경로: ${nativeConfigPath}`);
  if (pluginStatus === "removed") {
    io.stdout(`opencode plugin 설정 삭제: ${OPENCODE_PLUGIN_ENTRY}`);
  } else if (pluginStatus === "kept-custom") {
    io.stdout(`opencode plugin 사용자 설정 유지: ${OPENCODE_PLUGIN_ENTRY}`);
  } else {
    io.stdout(`opencode plugin 설정 없음: ${OPENCODE_PLUGIN_ENTRY}`);
  }
  if (providerStatus === "removed") {
    io.stdout("opencode provider 설정 삭제");
  } else if (providerStatus === "kept-custom") {
    io.stdout("opencode provider 사용자 설정 유지");
  } else {
    io.stdout("opencode provider 설정 없음");
  }
  return EXIT_VALID;
}

async function validate(args: string[], io: Required<CliIO>): Promise<number> {
  const projectDirectory = resolveProjectDirectory(args, io.cwd);
  const catalog = loadCatalog(projectDirectory);
  const warnings: ConfigLoadWarning[] = [];
  const config = loadPluginConfig(projectDirectory, {
    silent: true,
    catalog,
    agentRecord: AGENT_RECORD,
    onWarning: (warning) => warnings.push(warning),
  });
  const validationMessages = validatePluginConfig(
    config,
    catalog,
    AGENT_RECORD,
  );
  for (const warning of warnings) {
    io.stderr(`${warning.kind}: ${warning.message}`);
  }
  const warningKeys = new Set(
    warnings.map((warning) => `${warning.kind}:${warning.message}`),
  );
  for (const message of validationMessages) {
    if (warningKeys.has(`${message.kind}:${message.message}`)) {
      continue;
    }
    io.stderr(`${message.kind}: ${message.message}`);
  }
  if (
    warnings.some(
      (warning) =>
        warning.kind === "invalid-model" ||
        warning.kind === "invalid-reasoning-effort" ||
        warning.kind === "invalid-schema" ||
        warning.kind === "invalid-toml",
    )
  ) {
    return EXIT_INVALID;
  }
  if (
    validationMessages.some(
      (message) =>
        message.kind === "invalid-model" ||
        message.kind === "invalid-reasoning-effort",
    )
  ) {
    return EXIT_INVALID;
  }
  if (warnings.length > 0 || validationMessages.length > 0) {
    return EXIT_WARNING;
  }
  io.stdout("valid: agents.toml 설정이 유효합니다.");
  return EXIT_VALID;
}

async function doctor(args: string[], io: Required<CliIO>): Promise<number> {
  const projectDirectory = resolveProjectDirectory(args, io.cwd);
  const catalogSource = getCatalogSource(projectDirectory);
  const managedCatalogPath = getManagedCatalogPath(projectDirectory);
  const projectConfigPath = getProjectConfigPath(projectDirectory);
  const userConfigPath = getUserConfigPath(io.env);
  const packageVersion = getPackageVersion();
  const state = readManagedState(projectDirectory);
  let catalogChecksum = "unavailable";
  try {
    catalogChecksum = getCatalogChecksum(projectDirectory);
  } catch {
    // catalog validity 진단에서 원인을 별도로 출력한다.
  }

  let catalog: ReturnType<typeof loadCatalog> | undefined;
  let catalogLoadError: unknown;
  try {
    catalog = loadCatalog(projectDirectory);
  } catch (error) {
    catalogLoadError = error;
  }

  if (!catalog) {
    const catalogErrorMessage =
      catalogLoadError instanceof Error
        ? catalogLoadError.message
        : String(catalogLoadError);
    io.stdout(`pluginVersion=${packageVersion}`);
    io.stdout(`cliVersion=${packageVersion}`);
    io.stdout("catalogVersion=unknown");
    io.stdout(`userConfigSchemaVersion=${USER_CONFIG_SCHEMA_VERSION}`);
    io.stdout(`catalogChecksum=${catalogChecksum}`);
    io.stdout(`catalogSource=${catalogSource.kind}`);
    io.stdout("catalogValidity=invalid");
    io.stdout("catalogFreshness=invalid");
    io.stdout(`bundledCatalogPath=${getBundledCatalogPath()}`);
    io.stdout(`managedCatalogPath=${managedCatalogPath}`);
    io.stdout(`activeCatalogPath=${catalogSource.path}`);
    io.stdout(`projectConfigPath=${projectConfigPath}`);
    io.stdout(`userConfigPath=${userConfigPath}`);
    io.stdout(
      `managedStatePath=${path.join(projectDirectory, ".opencode", "agents.state.json")}`,
    );
    io.stdout(
      `activeCatalogReadable=${accessStatus(catalogSource.path, fs.constants.R_OK)}`,
    );
    io.stdout(
      `managedCatalogWritable=${directoryWriteStatus(managedCatalogPath)}`,
    );
    io.stdout(
      `projectConfigStatus=${fs.existsSync(projectConfigPath) ? "present" : "missing"}`,
    );
    io.stdout(
      `userConfigStatus=${fs.existsSync(userConfigPath) ? "present" : "missing"}`,
    );
    io.stdout("userConfigValidity=unknown");
    io.stdout("runtimeInjectionReady=unknown");
    io.stdout(`state=${state ? "present" : "missing"}`);
    io.stderr(`catalog-invalid: ${catalogSource.path}: ${catalogErrorMessage}`);
    return EXIT_INVALID;
  }

  const missingEnvironment = catalog.provider.env.filter(
    (name) => !io.env[name],
  );
  const warnings: ConfigLoadWarning[] = [];
  const config = loadPluginConfig(projectDirectory, {
    silent: true,
    catalog,
    agentRecord: AGENT_RECORD,
    onWarning: (warning) => warnings.push(warning),
  });
  const validationMessages = validatePluginConfig(
    config,
    catalog,
    AGENT_RECORD,
  );
  const invalidConfigWarnings = warnings.filter(
    (warning) =>
      warning.kind === "invalid-model" ||
      warning.kind === "invalid-reasoning-effort" ||
      warning.kind === "invalid-schema" ||
      warning.kind === "invalid-toml",
  );
  const invalidValidationMessages = validationMessages.filter(
    (message) =>
      message.kind === "invalid-model" ||
      message.kind === "invalid-reasoning-effort",
  );
  io.stdout(`pluginVersion=${packageVersion}`);
  io.stdout(`cliVersion=${packageVersion}`);
  io.stdout(`catalogVersion=${catalog.catalogVersion}`);
  io.stdout(`userConfigSchemaVersion=${USER_CONFIG_SCHEMA_VERSION}`);
  io.stdout(`catalogChecksum=${catalogChecksum}`);
  io.stdout(`catalogSource=${catalogSource.kind}`);
  io.stdout("catalogValidity=valid");
  io.stdout(
    `catalogFreshness=${getCatalogFreshness(state, catalog.catalogVersion, catalogChecksum)}`,
  );
  io.stdout(`bundledCatalogPath=${getBundledCatalogPath()}`);
  io.stdout(`managedCatalogPath=${managedCatalogPath}`);
  io.stdout(`activeCatalogPath=${catalogSource.path}`);
  io.stdout(`projectConfigPath=${projectConfigPath}`);
  io.stdout(`userConfigPath=${userConfigPath}`);
  io.stdout(
    `managedStatePath=${path.join(projectDirectory, ".opencode", "agents.state.json")}`,
  );
  io.stdout(
    `activeCatalogReadable=${accessStatus(catalogSource.path, fs.constants.R_OK)}`,
  );
  io.stdout(
    `managedCatalogWritable=${directoryWriteStatus(managedCatalogPath)}`,
  );
  io.stdout(
    `projectConfigStatus=${fs.existsSync(projectConfigPath) ? "present" : "missing"}`,
  );
  io.stdout(
    `userConfigStatus=${fs.existsSync(userConfigPath) ? "present" : "missing"}`,
  );
  io.stdout(
    `userConfigValidity=${
      invalidConfigWarnings.length === 0 &&
      invalidValidationMessages.length === 0
        ? "valid"
        : "invalid"
    }`,
  );
  io.stdout(
    `runtimeInjectionReady=${missingEnvironment.length === 0 ? "yes" : "unknown"}`,
  );
  io.stdout(`state=${state ? "present" : "missing"}`);
  for (const warning of invalidConfigWarnings) {
    io.stderr(`${warning.kind}: ${warning.filePath}: ${warning.message}`);
  }
  const warningKeys = new Set(
    invalidConfigWarnings.map(
      (warning) => `${warning.kind}:${warning.message}`,
    ),
  );
  for (const message of invalidValidationMessages) {
    if (warningKeys.has(`${message.kind}:${message.message}`)) {
      continue;
    }
    io.stderr(`${message.kind}: ${message.path}: ${message.message}`);
  }
  if (
    invalidConfigWarnings.length > 0 ||
    invalidValidationMessages.length > 0
  ) {
    return EXIT_INVALID;
  }
  if (missingEnvironment.length > 0) {
    io.stderr(`환경 변수 누락: ${missingEnvironment.join(", ")}`);
    return EXIT_WARNING;
  }
  return EXIT_VALID;
}

async function update(args: string[], io: Required<CliIO>): Promise<number> {
  const projectDirectory = resolveProjectDirectory(args, io.cwd);
  const latest = await readLatestManifest(io.env);
  if (!latest.catalog) {
    io.stderr("latest.json에 catalog artifact 정보가 없습니다.");
    return EXIT_BLOCKED;
  }
  const catalogContent = await readLocation(latest.catalog.url);
  verifyChecksum(catalogContent, latest.catalog.sha256);
  const catalog = parseCatalog(catalogContent.toString("utf-8"));
  const managedCatalogPath = getManagedCatalogPath(projectDirectory);
  fs.mkdirSync(path.dirname(managedCatalogPath), { recursive: true });
  fs.writeFileSync(managedCatalogPath, catalogContent, "utf-8");
  invalidateCatalogCache(managedCatalogPath);
  writeManagedState(projectDirectory, {
    pluginVersion: getPackageVersion(),
    cliVersion: getPackageVersion(),
    catalogVersion: catalog.catalogVersion,
    catalogChecksum: latest.catalog.sha256,
    userConfigSchemaVersion: USER_CONFIG_SCHEMA_VERSION,
    lastCommand: "update",
    lastUpdatedAt: new Date().toISOString(),
  });
  io.stdout(`catalogVersion=${catalog.catalogVersion}`);
  io.stdout(`catalogPath=${managedCatalogPath}`);
  return EXIT_VALID;
}

async function upgrade(args: string[], io: Required<CliIO>): Promise<number> {
  const projectDirectory = resolveProjectDirectory(args, io.cwd);
  const latest = await readLatestManifest(io.env);
  if (!latest.cli) {
    io.stderr("latest.json에 cli artifact 정보가 없습니다.");
    return EXIT_BLOCKED;
  }
  const cliArtifact = await readLocation(latest.cli.url);
  verifyChecksum(cliArtifact, latest.cli.sha256);
  const packageRoot = applyCliArtifact(cliArtifact);
  writeManagedState(projectDirectory, {
    pluginVersion: latest.cliVersion,
    cliVersion: latest.cliVersion,
    catalogVersion: latest.catalogVersion,
    catalogChecksum: getCatalogChecksum(projectDirectory),
    userConfigSchemaVersion: USER_CONFIG_SCHEMA_VERSION,
    lastCommand: "upgrade",
    lastUpdatedAt: new Date().toISOString(),
  });
  io.stdout(`cliVersion=${latest.cliVersion}`);
  io.stdout(`packagePath=${packageRoot}`);
  io.stdout("upgrade artifact applied.");
  return EXIT_VALID;
}

export async function runCli(argv: string[], io: CliIO = {}): Promise<number> {
  const resolvedIO: Required<CliIO> = {
    cwd: io.cwd ?? process.cwd(),
    env: io.env ?? process.env,
    stdout: io.stdout ?? ((line) => console.log(line)),
    stderr: io.stderr ?? ((line) => console.error(line)),
  };
  const [command, ...args] = argv;
  try {
    if (!command || command === "--help" || command === "-h") {
      printHelp(resolvedIO.stdout);
      await notifyUpgradeIfAvailable(resolvedIO);
      return command ? EXIT_VALID : EXIT_BLOCKED;
    }
    await notifyUpgradeIfAvailable(resolvedIO);
    switch (command) {
      case "install":
        return await install(args, resolvedIO);
      case "uninstall":
        return await uninstall(args, resolvedIO);
      case "validate":
        return await validate(args, resolvedIO);
      case "doctor":
        return await doctor(args, resolvedIO);
      case "update":
        return await update(args, resolvedIO);
      case "upgrade":
        return await upgrade(args, resolvedIO);
      default:
        resolvedIO.stderr(`알 수 없는 명령: ${command}`);
        printHelp(resolvedIO.stderr);
        return EXIT_BLOCKED;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    resolvedIO.stderr(`internal-error: ${message}`);
    return EXIT_INTERNAL;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}

export const CLI_COMMANDS = [
  "install",
  "uninstall",
  "validate",
  "doctor",
  "update",
  "upgrade",
] as const;
export const RELEASE_BASE_PREFIX = GITHUB_RELEASE_BASE;
export const BUNDLED_CATALOG_PATH = getBundledCatalogPath();
