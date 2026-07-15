import * as crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse } from "smol-toml";
import { buildProviderConfig, loadCatalog } from "opencode/core";
import { addNativeConfigEntries, readNativeOpencodeConfig, removeNativeConfigEntries } from "@cli/native-config";
import { isJsonObject } from "@cli/fs-utils";
import { readInstallState } from "@cli/install-state";
import {
  getBundledResourceRoot,
  getPackageRoot,
  getPackageVersion,
  getInstallStatePath,
} from "@cli/paths";
import { compareVersions, usesBundledReleaseSource } from "@cli/release";
import {
  assertArtifactCompatibility,
  readLocation,
  requireLatestManifestArtifact,
  verifyChecksum,
} from "@cli/release";
import { unpackTarGz } from "@cli/artifact";
import {
  getCodexHome,
  getCodexLifecycleStatePath,
  getClaudeCodeHome,
  getClaudeCodeLifecycleStatePath,
  getOpencodeConfigPaths,
  getOpencodeLifecycleStatePath,
  getOpencodeManagedCatalogPath,
  getOpencodeManagedPluginDirectory,
} from "@cli/lifecycle/paths";
import type {
  LifecycleFile,
  LifecycleInspection,
  LifecycleState,
  LifecycleStatus,
  LifecycleTarget,
  LatestManifest,
  OpencodeScope,
} from "@cli/types";

const CODEX_AGENT_NAMES = [
  "adversarial-review",
  "code-explorer",
  "constructive-feedback",
  "idea-generator",
  "intent-checker",
  "planner",
  "research",
  "worker",
] as const;

const CLAUDE_CODE_AGENT_NAMES = CODEX_AGENT_NAMES;

function getTargetArtifactName(target: LifecycleTarget): "claudeCodeAgents" | "codexAgents" | "opencode" {
  return target === "codex" ? "codexAgents" : target === "claude-code" ? "claudeCodeAgents" : "opencode";
}

function digest(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function getWorkspacePackagesRoot(): string | null {
  const packageRoot = getPackageRoot();
  if (!packageRoot) return null;
  const root = path.resolve(packageRoot, "..", "..", "packages");
  return fs.existsSync(root) ? root : null;
}

function readPackageVersion(packagePath: string): string {
  const parsed = JSON.parse(fs.readFileSync(packagePath, "utf-8")) as {
    version?: unknown;
  };
  if (typeof parsed.version !== "string" || !/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(parsed.version)) {
    throw new Error(`${packagePath}의 version이 올바른 버전 규칙이 아닙니다.`);
  }
  return parsed.version.replace(/^v/, "");
}

function listFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files.sort();
}

function copyFile(sourcePath: string, targetPath: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.tmp`,
  );
  fs.copyFileSync(sourcePath, temporaryPath);
  fs.chmodSync(temporaryPath, fs.statSync(sourcePath).mode & 0o777);
  fs.renameSync(temporaryPath, targetPath);
}

function copyDirectory(sourceDirectory: string, targetDirectory: string): void {
  for (const sourcePath of listFiles(sourceDirectory)) {
    copyFile(sourcePath, path.join(targetDirectory, path.relative(sourceDirectory, sourcePath)));
  }
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedRoot = path.resolve(rootPath);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function readLifecycleState(statePath: string): LifecycleState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const state = parsed as Partial<LifecycleState>;
    if (
      state.schemaVersion !== 2 ||
      (state.target !== "codex" && state.target !== "claude-code" && state.target !== "opencode") ||
      typeof state.version !== "string" ||
      !Array.isArray(state.files) ||
      !Array.isArray(state.managedPaths) ||
      !Array.isArray(state.userPaths)
    ) {
      return null;
    }
    return state as LifecycleState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function writeLifecycleState(statePath: string, state: LifecycleState): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

function inspectState(
  target: LifecycleTarget,
  scope: OpencodeScope | undefined,
  state: LifecycleState | null,
  availableVersion: string,
): LifecycleInspection {
  if (!state) {
    return { target, scope, status: "absent", state: null, availableVersion, userModifiedPaths: [] };
  }
  if (state.target !== target || state.scope !== scope) {
    return { target, scope, status: "unknown", state, availableVersion, userModifiedPaths: [], reason: "대상 상태 기록의 대상 또는 범위가 일치하지 않습니다." };
  }
  const userModifiedPaths: string[] = [];
  for (const file of state.files) {
    if (!fs.existsSync(file.path)) {
      return { target, scope, status: "damaged", state, availableVersion, userModifiedPaths, reason: `필수 파일이 없습니다: ${file.path}` };
    }
    if (digest(fs.readFileSync(file.path)) !== file.sha256) userModifiedPaths.push(file.path);
  }
  if (userModifiedPaths.length > 0) {
    return { target, scope, status: "damaged", state, availableVersion, userModifiedPaths, reason: "관리 파일의 내용이 마지막 적용 기록과 다릅니다." };
  }
  const comparison = compareVersions(state.version, availableVersion);
  const status: LifecycleStatus = comparison > 0 ? "ahead" : comparison === 0 ? "healthy-current" : "healthy-updatable";
  return { target, scope, status, state, installedVersion: state.version, availableVersion, userModifiedPaths };
}

function getArtifactSource(
  env: NodeJS.ProcessEnv,
  environmentVariable:
    | "AGENTS_CODEX_ARTIFACT_ROOT"
    | "AGENTS_CLAUDE_CODE_ARTIFACT_ROOT"
    | "AGENTS_OPENCODE_ARTIFACT_ROOT",
  targetName: string,
  requiredPaths: string[],
): { root: string; version: string } | null {
  const root = env[environmentVariable];
  if (!root) return null;
  if (requiredPaths.some((relativePath) => !fs.existsSync(path.join(root, relativePath)))) {
    throw new Error(`원격 ${targetName} 배포 묶음이 손상되었습니다.`);
  }
  return { root, version: readPackageVersion(path.join(root, "package.json")) };
}

function getCodexSource(env: NodeJS.ProcessEnv): { root: string; version: string } {
  const requiredRelativePaths = [
    "agents/versions.json",
    "skills/codex-orchestrator/SKILL.md",
    "skills/codex-orchestrator/agents/openai.yaml",
  ];
  if (!usesBundledReleaseSource(env)) {
    const artifactSource = getArtifactSource(env, "AGENTS_CODEX_ARTIFACT_ROOT", "Codex", requiredRelativePaths);
    if (artifactSource) return artifactSource;
  }
  const bundledRoot = getBundledResourceRoot("codex");
  if (bundledRoot) {
    const required = [
      path.join(bundledRoot, "agents", "versions.json"),
      path.join(bundledRoot, "skills", "codex-orchestrator", "SKILL.md"),
      path.join(bundledRoot, "skills", "codex-orchestrator", "agents", "openai.yaml"),
    ];
    if (required.every((filePath) => fs.existsSync(filePath))) {
      return { root: bundledRoot, version: env.AGENTS_CODEX_ARTIFACT_VERSION ?? readPackageVersion(path.join(bundledRoot, "package.json")) };
    }
    throw new Error("독립 CLI의 Codex 배포 묶음이 손상되었습니다.");
  }
  const packagesRoot = getWorkspacePackagesRoot();
  const root = packagesRoot ? path.join(packagesRoot, "codex") : "";
  const required = [
    path.join(root, "agents", "versions.json"),
    path.join(root, "skills", "codex-orchestrator", "SKILL.md"),
    path.join(root, "skills", "codex-orchestrator", "agents", "openai.yaml"),
  ];
  if (!root || required.some((filePath) => !fs.existsSync(filePath))) {
    throw new Error("Codex 배포 파일을 찾을 수 없습니다. 검증된 Codex 대상 묶음을 포함한 CLI를 사용하세요.");
  }
  return { root, version: env.AGENTS_CODEX_ARTIFACT_VERSION ?? readPackageVersion(path.join(root, "package.json")) };
}

function getClaudeCodeSource(env: NodeJS.ProcessEnv): { root: string; version: string } {
  const requiredRelativePaths = ["agents/versions.json", "skills/claude-code-orchestrator/SKILL.md"];
  if (!usesBundledReleaseSource(env)) {
    const artifactSource = getArtifactSource(env, "AGENTS_CLAUDE_CODE_ARTIFACT_ROOT", "Claude Code", requiredRelativePaths);
    if (artifactSource) return artifactSource;
  }
  const bundledRoot = getBundledResourceRoot("claude-code");
  if (bundledRoot) {
    if (requiredRelativePaths.every((relativePath) => fs.existsSync(path.join(bundledRoot, relativePath)))) {
      return { root: bundledRoot, version: env.AGENTS_CLAUDE_CODE_ARTIFACT_VERSION ?? readPackageVersion(path.join(bundledRoot, "package.json")) };
    }
    throw new Error("독립 CLI의 Claude Code 배포 묶음이 손상되었습니다.");
  }
  const packagesRoot = getWorkspacePackagesRoot();
  const root = packagesRoot ? path.join(packagesRoot, "claude-code") : "";
  if (!root || requiredRelativePaths.some((relativePath) => !fs.existsSync(path.join(root, relativePath)))) {
    throw new Error("Claude Code 배포 파일을 찾을 수 없습니다. 검증된 Claude Code 대상 묶음을 포함한 CLI를 사용하세요.");
  }
  return { root, version: env.AGENTS_CLAUDE_CODE_ARTIFACT_VERSION ?? readPackageVersion(path.join(root, "package.json")) };
}

function getOpencodeSource(env: NodeJS.ProcessEnv): { root: string; version: string } {
  const requiredRelativePaths = ["agents.example.toml", "plugin.mjs", "catalog.toml"];
  if (!usesBundledReleaseSource(env)) {
    const artifactSource = getArtifactSource(env, "AGENTS_OPENCODE_ARTIFACT_ROOT", "OpenCode", requiredRelativePaths);
    if (artifactSource) return artifactSource;
  }
  const bundledRoot = getBundledResourceRoot("opencode");
  if (bundledRoot) {
    const required = [
      path.join(bundledRoot, "agents.example.toml"),
      path.join(bundledRoot, "plugin.mjs"),
      path.join(bundledRoot, "catalog.toml"),
    ];
    if (required.every((filePath) => fs.existsSync(filePath))) {
      return { root: bundledRoot, version: env.AGENTS_OPENCODE_ARTIFACT_VERSION ?? readPackageVersion(path.join(bundledRoot, "package.json")) };
    }
    throw new Error("독립 CLI의 OpenCode 배포 묶음이 손상되었습니다.");
  }
  const packagesRoot = getWorkspacePackagesRoot();
  const root = packagesRoot ? path.join(packagesRoot, "opencode") : "";
  const required = [
    path.join(root, "agents.example.toml"),
    path.join(root, "src", "index.ts"),
    path.join(root, "src", "core", "catalog", "catalog.toml"),
  ];
  if (!root || required.some((filePath) => !fs.existsSync(filePath))) {
    throw new Error("OpenCode plugin 배포 파일을 찾을 수 없습니다. 검증된 OpenCode 대상 묶음을 포함한 CLI를 사용하세요.");
  }
  return { root, version: env.AGENTS_OPENCODE_ARTIFACT_VERSION ?? readPackageVersion(path.join(root, "package.json")) };
}

function readCodexSourceFiles(sourceRoot: string): string[] {
  const versions = JSON.parse(
    fs.readFileSync(path.join(sourceRoot, "agents", "versions.json"), "utf-8"),
  ) as Record<string, unknown>;
  if (Object.keys(versions).sort().join(",") !== [...CODEX_AGENT_NAMES].sort().join(",")) {
    throw new Error("Codex agent 버전 목록이 등록된 8개 agent와 일치하지 않습니다.");
  }
  const files = [path.join(sourceRoot, "agents", "versions.json")];
  for (const name of CODEX_AGENT_NAMES) {
    const agentPath = path.join(sourceRoot, "agents", `${name}.toml`);
    const agent = parse(fs.readFileSync(agentPath, "utf-8")) as Record<string, unknown>;
    if (agent.name !== name || typeof versions[name] !== "string") {
      throw new Error(`Codex agent 묶음이 올바르지 않습니다: ${name}`);
    }
    files.push(agentPath);
  }
  files.push(
    path.join(sourceRoot, "skills", "codex-orchestrator", "SKILL.md"),
    path.join(sourceRoot, "skills", "codex-orchestrator", "agents", "openai.yaml"),
  );
  return files;
}

function readClaudeCodeAgentFrontmatter(agentPath: string): { name: string; description: string } {
  const lines = fs.readFileSync(agentPath, "utf-8").split(/\r?\n/);
  if (lines[0] !== "---") throw new Error(`${agentPath}에 Claude Code frontmatter 시작 구분자가 없습니다.`);
  const closingIndex = lines.indexOf("---", 1);
  if (closingIndex < 2) throw new Error(`${agentPath}에 Claude Code frontmatter 종료 구분자가 없습니다.`);
  let name: string | undefined;
  let description: string | undefined;
  for (const line of lines.slice(1, closingIndex)) {
    const field = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*?)\s*$/.exec(line);
    if (!field || (field[1] !== "name" && field[1] !== "description")) continue;
    if (field[1] === "name") {
      if (name !== undefined || !/^[a-z0-9-]+$/.test(field[2])) throw new Error(`${agentPath}의 Claude Code frontmatter name이 올바르지 않습니다.`);
      name = field[2];
    } else {
      if (description !== undefined || field[2].length === 0) throw new Error(`${agentPath}의 Claude Code frontmatter description이 올바르지 않습니다.`);
      description = field[2];
    }
  }
  if (!name || !description) throw new Error(`${agentPath}의 Claude Code frontmatter에 name과 description이 필요합니다.`);
  return { name, description };
}

function readClaudeCodeSourceFiles(sourceRoot: string): string[] {
  const versions = JSON.parse(fs.readFileSync(path.join(sourceRoot, "agents", "versions.json"), "utf-8")) as Record<string, unknown>;
  if (Object.keys(versions).sort().join(",") !== [...CLAUDE_CODE_AGENT_NAMES].sort().join(",")) {
    throw new Error("Claude Code agent 버전 목록이 등록된 8개 agent와 일치하지 않습니다.");
  }
  const files = [path.join(sourceRoot, "agents", "versions.json")];
  for (const name of CLAUDE_CODE_AGENT_NAMES) {
    const agentPath = path.join(sourceRoot, "agents", `${name}.md`);
    if (readClaudeCodeAgentFrontmatter(agentPath).name !== name || typeof versions[name] !== "string") {
      throw new Error(`Claude Code agent 묶음이 올바르지 않습니다: ${name}`);
    }
    files.push(agentPath);
  }
  files.push(path.join(sourceRoot, "skills", "claude-code-orchestrator", "SKILL.md"));
  return files;
}

export interface LifecycleTargetHandler {
  target: LifecycleTarget;
  inspect(projectDirectory: string, env: NodeJS.ProcessEnv, scope?: OpencodeScope): LifecycleInspection;
  getBackupPaths(projectDirectory: string, env: NodeJS.ProcessEnv, scope?: OpencodeScope): string[];
  apply(projectDirectory: string, env: NodeJS.ProcessEnv, scope?: OpencodeScope): LifecycleState;
  uninstall(projectDirectory: string, env: NodeJS.ProcessEnv, scope?: OpencodeScope): void;
  verify(projectDirectory: string, env: NodeJS.ProcessEnv, scope?: OpencodeScope): LifecycleInspection;
}

export interface StagedTargetSources {
  env: NodeJS.ProcessEnv;
  cleanup(): void;
}

/** artifact를 받기 전, 배포 목록의 버전만 사용해 대화형 실행 계획을 계산한다. */
export function createRemoteTargetPlanEnvironment(
  manifest: LatestManifest,
  targets: LifecycleTarget[],
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const plannedEnv = { ...env };
  for (const target of targets) {
    const artifactName = getTargetArtifactName(target);
    const artifact = requireLatestManifestArtifact(manifest, artifactName);
    assertArtifactCompatibility(artifact, getPackageVersion());
    if (!artifact.version) {
      throw new Error(`원격 ${target} artifact에 계획에 필요한 버전이 없습니다.`);
    }
    if (target === "codex") plannedEnv.AGENTS_CODEX_ARTIFACT_VERSION = artifact.version;
    else if (target === "claude-code") plannedEnv.AGENTS_CLAUDE_CODE_ARTIFACT_VERSION = artifact.version;
    else plannedEnv.AGENTS_OPENCODE_ARTIFACT_VERSION = artifact.version;
  }
  return plannedEnv;
}

function assertArtifactFiles(root: string, requiredFiles: string[], targetName: string): void {
  for (const relativePath of requiredFiles) {
    if (!fs.existsSync(path.join(root, relativePath))) {
      throw new Error(`원격 ${targetName} artifact의 필수 파일이 없습니다: ${relativePath}`);
    }
  }
}

/** 원격 배포 목록의 대상 artifact를 임시 경로에 검증·해제해 현재 수명주기 실행에만 사용한다. */
export async function stageRemoteTargetSources(
  manifest: LatestManifest,
  targets: LifecycleTarget[],
  env: NodeJS.ProcessEnv,
): Promise<StagedTargetSources> {
  const stageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "agents-target-release-"));
  const stagedEnv = { ...env };
  try {
    for (const target of targets) {
      const artifactName = getTargetArtifactName(target);
      const artifact = requireLatestManifestArtifact(manifest, artifactName);
      assertArtifactCompatibility(artifact, getPackageVersion());
      if (artifact.size === undefined || !artifact.version || !artifact.requiredFiles) {
        throw new Error(`원격 ${target} artifact가 v2 배포 계약을 충족하지 않습니다.`);
      }
      const content = await readLocation(artifact.url, undefined, artifact.size);
      if (content.length !== artifact.size) {
        throw new Error(`원격 ${target} artifact 크기가 배포 목록과 일치하지 않습니다.`);
      }
      verifyChecksum(content, artifact.sha256);
      const sourceRoot = path.join(stageDirectory, target);
      fs.mkdirSync(sourceRoot, { recursive: true });
      unpackTarGz(content, sourceRoot);
      assertArtifactFiles(sourceRoot, artifact.requiredFiles, target);
      const actualVersion = readPackageVersion(path.join(sourceRoot, "package.json"));
      if (actualVersion !== artifact.version) {
        throw new Error(`원격 ${target} artifact 실제 버전 ${actualVersion}이(가) 배포 목록 ${artifact.version}과 일치하지 않습니다.`);
      }
      if (target === "codex") stagedEnv.AGENTS_CODEX_ARTIFACT_ROOT = sourceRoot;
      else if (target === "claude-code") stagedEnv.AGENTS_CLAUDE_CODE_ARTIFACT_ROOT = sourceRoot;
      else stagedEnv.AGENTS_OPENCODE_ARTIFACT_ROOT = sourceRoot;
    }
    return { env: stagedEnv, cleanup: () => fs.rmSync(stageDirectory, { recursive: true, force: true }) };
  } catch (error) {
    fs.rmSync(stageDirectory, { recursive: true, force: true });
    throw error;
  }
}

export const codexTarget: LifecycleTargetHandler = {
  target: "codex",
  inspect(_projectDirectory, env) {
    const source = getCodexSource(env);
    const statePath = getCodexLifecycleStatePath(env);
    const state = readLifecycleState(statePath);
    if (state) {
      const inspection = inspectState("codex", undefined, state, source.version);
      if (inspection.status === "healthy-current" || inspection.status === "healthy-updatable" || inspection.status === "ahead") {
        const allowed = new Set([...CODEX_AGENT_NAMES.map((name) => `${name}.toml`), "versions.json"]);
        const present = fs.existsSync(path.join(getCodexHome(env), "agents"))
          ? fs.readdirSync(path.join(getCodexHome(env), "agents")).filter((name) => name.endsWith(".toml") || name === "versions.json")
          : [];
        if ([...allowed].some((name) => !present.includes(name))) {
          return { ...inspection, status: "damaged", reason: "Codex agent 파일 목록이 배포 묶음의 허용 목록과 일치하지 않습니다." };
        }
      }
      return inspection;
    }
    const home = getCodexHome(env);
    const agentsDirectory = path.join(home, "agents");
    const skillPath = path.join(home, "skills", "codex-orchestrator", "SKILL.md");
    const hasManagedCandidate =
      fs.existsSync(path.join(agentsDirectory, "versions.json")) ||
      (fs.existsSync(agentsDirectory) && fs.readdirSync(agentsDirectory).some((name) => name.endsWith(".toml"))) ||
      fs.existsSync(skillPath);
    if (hasManagedCandidate) {
      return { target: "codex", status: "unmanaged", state: null, availableVersion: source.version, userModifiedPaths: [], reason: "관리 기록 없는 Codex 파일이 있습니다. --adopt로 가져오세요." };
    }
    return inspectState("codex", undefined, null, source.version);
  },
  getBackupPaths(_projectDirectory, env) {
    const home = getCodexHome(env);
    return [path.join(home, "agents"), path.join(home, "skills", "codex-orchestrator"), getCodexLifecycleStatePath(env)];
  },
  apply(_projectDirectory, env) {
    const source = getCodexSource(env);
    const sourceFiles = readCodexSourceFiles(source.root);
    const home = getCodexHome(env);
    const files: LifecycleFile[] = [];
    for (const sourcePath of sourceFiles) {
      const relative = path.relative(source.root, sourcePath);
      const targetPath = path.join(home, relative);
      copyFile(sourcePath, targetPath);
      files.push({ path: targetPath, sha256: digest(fs.readFileSync(targetPath)) });
    }
    const now = new Date().toISOString();
    const state: LifecycleState = { schemaVersion: 2, target: "codex", version: source.version, installedAt: now, updatedAt: now, files, managedPaths: files.map((file) => file.path), userPaths: [] };
    writeLifecycleState(getCodexLifecycleStatePath(env), state);
    return state;
  },
  uninstall(_projectDirectory, env) {
    const statePath = getCodexLifecycleStatePath(env);
    const state = readLifecycleState(statePath);
    if (!state) return;
    if (state.target !== "codex" || state.scope !== undefined) throw new Error("Codex 상태 기록의 소유권이 일치하지 않아 삭제하지 않았습니다.");
    const home = getCodexHome(env);
    const allowedFiles = new Set([
      ...CODEX_AGENT_NAMES.map((name) => path.join(home, "agents", `${name}.toml`)),
      path.join(home, "agents", "versions.json"),
      path.join(home, "skills", "codex-orchestrator", "SKILL.md"),
      path.join(home, "skills", "codex-orchestrator", "agents", "openai.yaml"),
    ].map((filePath) => path.resolve(filePath)));
    for (const file of state.files) {
      if (!allowedFiles.has(path.resolve(file.path)) || !isWithinRoot(file.path, home)) {
        throw new Error(`Codex 상태 기록에 허용되지 않은 관리 파일이 있습니다: ${file.path}`);
      }
      if (fs.existsSync(file.path) && fs.lstatSync(file.path).isFile() && digest(fs.readFileSync(file.path)) === file.sha256) fs.rmSync(file.path, { force: true });
    }
    fs.rmSync(statePath, { force: true });
  },
  verify(projectDirectory, env) {
    return this.inspect(projectDirectory, env);
  },
};

export const claudeCodeTarget: LifecycleTargetHandler = {
  target: "claude-code",
  inspect(_projectDirectory, env) {
    const source = getClaudeCodeSource(env);
    const statePath = getClaudeCodeLifecycleStatePath(env);
    const state = readLifecycleState(statePath);
    if (state) return inspectState("claude-code", undefined, state, source.version);
    const home = getClaudeCodeHome(env);
    const agentsDirectory = path.join(home, "agents");
    const skillPath = path.join(home, "skills", "claude-code-orchestrator", "SKILL.md");
    const hasManagedCandidate = fs.existsSync(path.join(agentsDirectory, "versions.json")) ||
      (fs.existsSync(agentsDirectory) && fs.readdirSync(agentsDirectory).some((fileName) =>
        CLAUDE_CODE_AGENT_NAMES.some((agentName) => fileName === `${agentName}.md`),
      )) ||
      fs.existsSync(skillPath);
    if (hasManagedCandidate) {
      return { target: "claude-code", status: "unmanaged", state: null, availableVersion: source.version, userModifiedPaths: [], reason: "관리 기록 없는 Claude Code 파일이 있습니다. --adopt로 가져오세요." };
    }
    return inspectState("claude-code", undefined, null, source.version);
  },
  getBackupPaths(_projectDirectory, env) {
    const home = getClaudeCodeHome(env);
    return [path.join(home, "agents"), path.join(home, "skills", "claude-code-orchestrator"), getClaudeCodeLifecycleStatePath(env)];
  },
  apply(_projectDirectory, env) {
    const source = getClaudeCodeSource(env);
    const sourceFiles = readClaudeCodeSourceFiles(source.root);
    const home = getClaudeCodeHome(env);
    const statePath = getClaudeCodeLifecycleStatePath(env);
    const previousState = readLifecycleState(statePath);
    const files: LifecycleFile[] = [];
    for (const sourcePath of sourceFiles) {
      const targetPath = path.join(home, path.relative(source.root, sourcePath));
      copyFile(sourcePath, targetPath);
      files.push({ path: targetPath, sha256: digest(fs.readFileSync(targetPath)) });
    }
    const now = new Date().toISOString();
    const state: LifecycleState = { schemaVersion: 2, target: "claude-code", version: source.version, installedAt: previousState?.installedAt ?? now, updatedAt: now, files, managedPaths: files.map((file) => file.path), userPaths: [] };
    writeLifecycleState(statePath, state);
    return state;
  },
  uninstall(_projectDirectory, env) {
    const statePath = getClaudeCodeLifecycleStatePath(env);
    const state = readLifecycleState(statePath);
    if (!state) return;
    if (state.target !== "claude-code" || state.scope !== undefined) throw new Error("Claude Code 상태 기록의 소유권이 일치하지 않아 삭제하지 않았습니다.");
    const home = getClaudeCodeHome(env);
    const allowedFiles = new Set([
      ...CLAUDE_CODE_AGENT_NAMES.map((name) => path.join(home, "agents", `${name}.md`)),
      path.join(home, "agents", "versions.json"),
      path.join(home, "skills", "claude-code-orchestrator", "SKILL.md"),
    ].map((filePath) => path.resolve(filePath)));
    for (const file of state.files) {
      if (!allowedFiles.has(path.resolve(file.path)) || !isWithinRoot(file.path, home)) throw new Error(`Claude Code 상태 기록에 허용되지 않은 관리 파일이 있습니다: ${file.path}`);
      if (fs.existsSync(file.path) && fs.lstatSync(file.path).isFile() && digest(fs.readFileSync(file.path)) === file.sha256) fs.rmSync(file.path, { force: true });
    }
    fs.rmSync(statePath, { force: true });
  },
  verify(projectDirectory, env) {
    return this.inspect(projectDirectory, env);
  },
};

export const opencodeTarget: LifecycleTargetHandler = {
  target: "opencode",
  inspect(projectDirectory, env, scope) {
    if (!scope) throw new Error("OpenCode 대상에는 --opencode-scope user 또는 project가 필요합니다.");
    const source = getOpencodeSource(env);
    const statePath = getOpencodeLifecycleStatePath(scope, projectDirectory, env);
    const state = readLifecycleState(statePath);
    if (state) {
      const inspection = inspectState("opencode", scope, state, source.version);
      if (inspection.status !== "healthy-current" && inspection.status !== "healthy-updatable" && inspection.status !== "ahead") return inspection;
      const paths = getOpencodeConfigPaths(scope, projectDirectory, env);
      try {
        const config = readNativeOpencodeConfig(paths.nativePath);
        const pluginEntry = `file://${path.join(getOpencodeManagedPluginDirectory(scope, projectDirectory, env), "plugin.ts")}`;
        if (!Array.isArray(config.plugin) || !config.plugin.includes(pluginEntry)) {
          return { ...inspection, status: "damaged", reason: "opencode.json에 CLI 관리 local plugin 등록이 없습니다." };
        }
        const provider = buildProviderConfig(loadCatalog(scope === "project" ? projectDirectory : undefined));
        const existingProvider = isJsonObject(config.provider) ? config.provider[provider.id] : undefined;
        const options = isJsonObject(existingProvider) && isJsonObject(existingProvider.options) ? existingProvider.options : null;
        if (!isJsonObject(existingProvider) || existingProvider.npm !== provider.npm || existingProvider.api !== provider.api || options?.baseURL !== provider.options.baseURL) {
          return { ...inspection, status: "damaged", reason: "opencode.json provider 등록이 실제 plugin 요구와 일치하지 않습니다." };
        }
        if (!fs.existsSync(paths.agentsPath)) {
          return { ...inspection, status: "damaged", reason: "OpenCode agents.toml이 없습니다." };
        }
        parse(fs.readFileSync(paths.agentsPath, "utf-8"));
      } catch (error) {
        return { ...inspection, status: "unknown", reason: error instanceof Error ? error.message : String(error) };
      }
      return inspection;
    }
    const legacyState = readInstallState(getInstallStatePath(scope, projectDirectory, env));
    if (legacyState) return { target: "opencode", scope, status: "legacy-rebuild", state: null, availableVersion: source.version, userModifiedPaths: [], reason: "이전 설치 기록을 새 관리 형식으로 바꿉니다." };
    const pluginDirectory = getOpencodeManagedPluginDirectory(scope, projectDirectory, env);
    const paths = getOpencodeConfigPaths(scope, projectDirectory, env);
    const pluginEntry = `file://${path.join(pluginDirectory, "plugin.ts")}`;
    try {
      const config = readNativeOpencodeConfig(paths.nativePath);
      const hasManagedPluginEntry = Array.isArray(config.plugin) && config.plugin.includes(pluginEntry);
      if (hasManagedPluginEntry && !fs.existsSync(pluginDirectory)) {
        return { target: "opencode", scope, status: "damaged", state: null, availableVersion: source.version, userModifiedPaths: [], reason: "관리 plugin 파일 없이 opencode.json에 dangling local plugin 등록이 남아 있습니다." };
      }
      if (fs.existsSync(pluginDirectory) && hasManagedPluginEntry) {
        return { target: "opencode", scope, status: "unmanaged", state: null, availableVersion: source.version, userModifiedPaths: [], reason: "관리 기록 없는 OpenCode plugin 파일이 있습니다. --adopt로 가져오세요." };
      }
    } catch (error) {
      return { target: "opencode", scope, status: "unknown", state: null, availableVersion: source.version, userModifiedPaths: [], reason: error instanceof Error ? error.message : String(error) };
    }
    return inspectState("opencode", scope, null, source.version);
  },
  getBackupPaths(projectDirectory, env, scope) {
    if (!scope) throw new Error("OpenCode 범위가 필요합니다.");
    const paths = getOpencodeConfigPaths(scope, projectDirectory, env);
    return [
      paths.agentsPath,
      paths.nativePath,
      getOpencodeManagedPluginDirectory(scope, projectDirectory, env),
      getOpencodeManagedCatalogPath(scope, projectDirectory, env),
      getOpencodeLifecycleStatePath(scope, projectDirectory, env),
      getInstallStatePath(scope, projectDirectory, env),
    ];
  },
  apply(projectDirectory, env, scope) {
    if (!scope) throw new Error("OpenCode 범위가 필요합니다.");
    const source = getOpencodeSource(env);
    const paths = getOpencodeConfigPaths(scope, projectDirectory, env);
    const statePath = getOpencodeLifecycleStatePath(scope, projectDirectory, env);
    const previousState = readLifecycleState(statePath);
    const pluginDirectory = getOpencodeManagedPluginDirectory(scope, projectDirectory, env);
    const pluginEntryPath = path.join(pluginDirectory, "plugin.ts");
    const persistentPluginPath = path.join(pluginDirectory, "plugin.mjs");
    const catalogPath = getOpencodeManagedCatalogPath(scope, projectDirectory, env);
    fs.mkdirSync(pluginDirectory, { recursive: true });
    const sourcePluginPath = path.join(source.root, "plugin.mjs");
    if (fs.existsSync(sourcePluginPath)) {
      const previouslyManagedPlugin = previousState?.files.some(
        (file) => path.resolve(file.path) === path.resolve(persistentPluginPath),
      ) ?? false;
      if (fs.existsSync(persistentPluginPath) && !previouslyManagedPlugin) {
        throw new Error(`OpenCode 관리 plugin 경로에 사용자 파일이 있어 덮어쓰지 않았습니다: ${persistentPluginPath}`);
      }
      copyFile(sourcePluginPath, persistentPluginPath);
      // 원격 artifact의 임시 해제 경로가 아니라 대상·범위별 영구 관리 사본만 참조한다.
      fs.writeFileSync(pluginEntryPath, 'export { default } from "./plugin.mjs";\n', "utf-8");
    } else {
      const workspacePluginPath = path.join(source.root, "src", "index.ts");
      // 개발 워크스페이스 source만 TypeScript entry를 직접 참조한다.
      fs.writeFileSync(pluginEntryPath, `export { default } from ${JSON.stringify(workspacePluginPath)};\n`, "utf-8");
    }
    // agents.toml은 사용자가 수정할 수 있는 설정이므로 없을 때만 기본값을 둔다.
    if (!fs.existsSync(paths.agentsPath)) {
      copyFile(path.join(source.root, "agents.example.toml"), paths.agentsPath);
    }
    copyFile(
      fs.existsSync(path.join(source.root, "catalog.toml"))
        ? path.join(source.root, "catalog.toml")
        : path.join(source.root, "src", "core", "catalog", "catalog.toml"),
      catalogPath,
    );
    const provider = buildProviderConfig(loadCatalog(scope === "project" ? projectDirectory : undefined));
    const existingNative = readNativeOpencodeConfig(paths.nativePath);
    const existingProvider = isJsonObject(existingNative.provider)
      ? existingNative.provider[provider.id]
      : undefined;
    if (existingProvider !== undefined) {
      const options = isJsonObject(existingProvider) && isJsonObject(existingProvider.options)
        ? existingProvider.options
        : null;
      if (
        !isJsonObject(existingProvider) ||
        existingProvider.npm !== provider.npm ||
        existingProvider.api !== provider.api ||
        options?.baseURL !== provider.options.baseURL
      ) {
        throw new Error(`사용자 OpenCode provider ${provider.id}가 필요한 npm/api/baseURL 설정과 호환되지 않습니다. 사용자 설정은 변경하지 않았습니다.`);
      }
    }
    const native = addNativeConfigEntries(
      paths.nativePath,
      `file://${pluginEntryPath}`,
      provider.id,
      provider,
    );
    const pluginEntry = `file://${pluginEntryPath}`;
    const previousNativeConfig = previousState?.target === "opencode" &&
      previousState.scope === scope &&
      previousState.nativeConfig?.path === paths.nativePath &&
      previousState.nativeConfig.pluginEntry === pluginEntry &&
      previousState.nativeConfig.providerId === provider.id
      ? previousState.nativeConfig
      : undefined;
    const pluginAdded = native.pluginAdded || previousNativeConfig?.pluginAdded === true;
    const providerAdded = native.providerAdded || previousNativeConfig?.providerAdded === true;
    const managedFilePaths = [
      pluginEntryPath,
      ...(fs.existsSync(sourcePluginPath) ? [persistentPluginPath] : []),
      catalogPath,
    ];
    const files = managedFilePaths.map((filePath) => ({ path: filePath, sha256: digest(fs.readFileSync(filePath)) }));
    const now = new Date().toISOString();
    const state: LifecycleState = {
      schemaVersion: 2,
      target: "opencode",
      scope,
      version: source.version,
      installedAt: now,
      updatedAt: now,
      files,
      managedPaths: [pluginDirectory, catalogPath, ...(pluginAdded || providerAdded ? [paths.nativePath] : [])],
      userPaths: [paths.agentsPath],
      nativeConfig: {
        path: paths.nativePath,
        pluginEntry,
        providerId: provider.id,
        pluginAdded,
        providerAdded,
      },
    };
    writeLifecycleState(getOpencodeLifecycleStatePath(scope, projectDirectory, env), state);
    fs.rmSync(getInstallStatePath(scope, projectDirectory, env), { force: true });
    return state;
  },
  uninstall(projectDirectory, env, scope) {
    if (!scope) throw new Error("OpenCode 범위가 필요합니다.");
    const statePath = getOpencodeLifecycleStatePath(scope, projectDirectory, env);
    const state = readLifecycleState(statePath);
    if (!state) return;
    if (state.target !== "opencode" || state.scope !== scope) throw new Error("OpenCode 상태 기록의 소유권이 일치하지 않아 삭제하지 않았습니다.");
    const paths = getOpencodeConfigPaths(scope, projectDirectory, env);
    const pluginDirectory = getOpencodeManagedPluginDirectory(scope, projectDirectory, env);
    const pluginEntryPath = path.join(pluginDirectory, "plugin.ts");
    const persistentPluginPath = path.join(pluginDirectory, "plugin.mjs");
    const catalogPath = getOpencodeManagedCatalogPath(scope, projectDirectory, env);
    if (!isWithinRoot(pluginDirectory, scope === "project" ? projectDirectory : path.dirname(paths.nativePath)) || !isWithinRoot(catalogPath, scope === "project" ? projectDirectory : path.dirname(paths.nativePath))) {
      throw new Error("OpenCode 관리 경로가 허용 범위를 벗어나 삭제하지 않았습니다.");
    }
    if (state.nativeConfig) {
      if (state.nativeConfig.path !== paths.nativePath || state.nativeConfig.pluginEntry !== `file://${path.join(pluginDirectory, "plugin.ts")}`) {
        throw new Error("OpenCode native 설정 소유권 기록이 현재 범위와 일치하지 않습니다.");
      }
      const provider = buildProviderConfig(loadCatalog(scope === "project" ? projectDirectory : undefined));
      const currentNative = readNativeOpencodeConfig(paths.nativePath);
      const currentProvider = isJsonObject(currentNative.provider) ? currentNative.provider[state.nativeConfig.providerId] : undefined;
      const currentOptions = isJsonObject(currentProvider) && isJsonObject(currentProvider.options) ? currentProvider.options : null;
      const providerStillMatchesManagedValue = isJsonObject(currentProvider) &&
        currentProvider.npm === provider.npm &&
        currentProvider.api === provider.api &&
        currentOptions?.baseURL === provider.options.baseURL;
      removeNativeConfigEntries(
        paths.nativePath,
        state.nativeConfig.pluginEntry,
        state.nativeConfig.providerId,
        state.nativeConfig.pluginAdded,
        state.nativeConfig.providerAdded && providerStillMatchesManagedValue,
      );
    }
    const allowedManagedFiles = new Set([
      pluginEntryPath,
      persistentPluginPath,
      catalogPath,
    ].map((filePath) => path.resolve(filePath)));
    for (const file of state.files) {
      const managedPath = path.resolve(file.path);
      if (!allowedManagedFiles.has(managedPath)) {
        throw new Error(`OpenCode 상태 기록에 허용되지 않은 관리 파일이 있습니다: ${file.path}`);
      }
      if (fs.existsSync(file.path) && fs.lstatSync(file.path).isFile() && digest(fs.readFileSync(file.path)) === file.sha256) {
        fs.rmSync(file.path, { force: true });
      }
    }
    try {
      fs.rmdirSync(pluginDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOTEMPTY" && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    fs.rmSync(statePath, { force: true });
    fs.rmSync(getInstallStatePath(scope, projectDirectory, env), { force: true });
  },
  verify(projectDirectory, env, scope) {
    return this.inspect(projectDirectory, env, scope);
  },
};

export const TARGET_REGISTRY: Record<LifecycleTarget, LifecycleTargetHandler> = {
  codex: codexTarget,
  "claude-code": claudeCodeTarget,
  opencode: opencodeTarget,
};

/** OpenCode 실행 파일의 존재만 확인한다. plugin 로드 성공과 혼동하지 않는다. */
export function verifyOpencodeExecutable(env: NodeJS.ProcessEnv): "available" | "unavailable" {
  const executable = env.OPENCODE_EXECUTABLE ?? "opencode";
  const result = spawnSync(executable, ["--version"], {
    env,
    stdio: "ignore",
  });
  return result.status === 0 ? "available" : "unavailable";
}
