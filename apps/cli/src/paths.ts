import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

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

export function getPackageRoot(): string | null {
  const startDirectory = path.dirname(fileURLToPath(import.meta.url));
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
        fs.existsSync(path.resolve(currentDirectory, binPath)) &&
        fs.existsSync(sourceCliPath)
      ) {
        return currentDirectory;
      }
    }
    currentDirectory = path.dirname(currentDirectory);
  }
  return null;
}

export function getCurrentPluginVersion(): string {
  return getPackageVersion();
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
