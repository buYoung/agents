import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

export function resolveProjectDirectory(args: string[], cwd: string): string {
  const projectIndex = args.indexOf("--project");
  if (projectIndex >= 0 && args[projectIndex + 1]) {
    return path.resolve(cwd, args[projectIndex + 1]);
  }
  return cwd;
}

export function resolveUserConfigDirectory(env: NodeJS.ProcessEnv): string {
  if (env.OPENCODE_CONFIG_DIR) return env.OPENCODE_CONFIG_DIR;
  const configHome = env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(configHome, "opencode");
}

export function getPackageVersion(): string {
  return readPackageManifest()?.version ?? "0.0.0";
}

type CliPackageManifest = {
  name?: string;
  version?: string;
  private?: boolean;
  bin?: string | Record<string, string>;
};

const CLI_PACKAGE_NAMES = new Set(["cli", "@livteam/agents-cli"]);

function readPackageManifest(): CliPackageManifest | null {
  const packageRoot = getPackageRoot();
  if (!packageRoot) return null;
  return JSON.parse(
    fs.readFileSync(path.join(packageRoot, "package.json"), "utf-8"),
  ) as CliPackageManifest;
}

export function isNpmPackageInstallation(): boolean {
  const packageManifest = readPackageManifest();
  return (
    packageManifest?.name === "@livteam/agents-cli" &&
    packageManifest.private !== true
  );
}

export function getPackageRoot(): string | null {
  const startDirectory = path.dirname(fileURLToPath(import.meta.url));
  let currentDirectory = startDirectory;
  while (currentDirectory !== path.dirname(currentDirectory)) {
    const packagePath = path.join(currentDirectory, "package.json");
    if (fs.existsSync(packagePath)) {
      const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8")) as CliPackageManifest;
      const binPath =
        typeof packageJson.bin === "string"
          ? packageJson.bin
          : packageJson.bin?.["agents"];
      const sourceCliPath = path.join(currentDirectory, "src", "cli.ts");
      const bundledCliPath = path.join(currentDirectory, "dist", "cli.mjs");
      if (
        binPath &&
        CLI_PACKAGE_NAMES.has(packageJson.name ?? "") &&
        fs.existsSync(path.resolve(currentDirectory, binPath)) &&
        (fs.existsSync(sourceCliPath) || fs.existsSync(bundledCliPath))
      ) {
        return currentDirectory;
      }
    }
    currentDirectory = path.dirname(currentDirectory);
  }
  return null;
}

export function getCurrentPluginVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const packagePath = require.resolve("opencode/package.json");
    const parsed = JSON.parse(fs.readFileSync(packagePath, "utf-8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    const packageRoot = getPackageRoot();
    const bundledMetadataPath = packageRoot
      ? path.join(packageRoot, "release-metadata.json")
      : "";
    if (bundledMetadataPath && fs.existsSync(bundledMetadataPath)) {
      const metadata = JSON.parse(fs.readFileSync(bundledMetadataPath, "utf-8")) as {
        pluginVersion?: unknown;
      };
      if (typeof metadata.pluginVersion === "string") return metadata.pluginVersion;
    }
    const workspacePackagePath = packageRoot
      ? path.resolve(packageRoot, "..", "..", "packages", "opencode", "package.json")
      : "";
    if (workspacePackagePath && fs.existsSync(workspacePackagePath)) {
      const parsed = JSON.parse(fs.readFileSync(workspacePackagePath, "utf-8")) as {
        version?: unknown;
      };
      if (typeof parsed.version === "string") return parsed.version;
    }
    return "0.0.0";
  }
}

/** 독립 CLI 묶음에 포함된 배포 대상 파일의 루트다. */
export function getBundledResourceRoot(target: "claude-code" | "codex" | "opencode"): string | null {
  const packageRoot = getPackageRoot();
  if (!packageRoot) return null;
  const resourceRoot = path.join(packageRoot, "resources", target);
  return fs.existsSync(resourceRoot) ? resourceRoot : null;
}

export function getProjectConfigPath(projectDirectory: string): string {
  return path.join(projectDirectory, ".opencode", "agents.toml");
}

export function getUserConfigPath(env: NodeJS.ProcessEnv): string {
  return path.join(resolveUserConfigDirectory(env), "agents.toml");
}

export function getNativeOpencodeConfigPath(
  scope: "user" | "project",
  projectDirectory: string,
  env: NodeJS.ProcessEnv,
): string {
  return scope === "user"
    ? path.join(resolveUserConfigDirectory(env), "opencode.json")
    : path.join(projectDirectory, "opencode.json");
}

export function getInstallStatePath(
  scope: "user" | "project",
  projectDirectory: string,
  env: NodeJS.ProcessEnv,
): string {
  return scope === "user"
    ? path.join(resolveUserConfigDirectory(env), "agents.install.json")
    : path.join(projectDirectory, ".opencode", "agents.install.json");
}

export function getCodexAgentsDirectory(env: NodeJS.ProcessEnv): string {
  return path.join(
    env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
    "agents",
  );
}
