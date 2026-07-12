/**
 * install-uninstall.test.ts — install/uninstall CLI 명령 (user/project scope)
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { runCli, CLI_COMMANDS } from "@cli/cli";
import { buildProviderConfig } from "opencode/core";

const cliEnv = { ...process.env, OLLAMA_API_KEY: "present-for-smoke" };

function writeOpencodeJson(dir: string, config: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(dir, "opencode.json"),
    JSON.stringify(config, null, 2),
    "utf-8",
  );
}

function readOpencodeJson(dir: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(dir, "opencode.json"), "utf-8"),
  ) as Record<string, unknown>;
}

function collectOutput(): {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
  };
}

describe("CLI 명령 라우팅", () => {
  test("CLI_COMMANDS에 수명주기 명령을 포함한다", () => {
    expect(CLI_COMMANDS.join(",")).toBe(
      "install,uninstall,validate,doctor,update,upgrade,backup,restore,status",
    );
    expect(CLI_COMMANDS.includes("generate" as never)).toBe(false);
    expect(CLI_COMMANDS.includes("migrate" as never)).toBe(false);
  });
});

describe("bin 래퍼", () => {
  test("package.json bin.agents → ./bin/agents, 파일 존재, 실행 권한, --help 출력", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8"),
    ) as { bin?: Record<string, string> };
    const binPath = packageJson.bin?.["agents"];
    expect(typeof binPath).toBe("string");
    expect(binPath).not.toContain(".opencode");
    expect(binPath).toBe("./bin/agents");

    const absPath = path.join(process.cwd(), binPath ?? "");
    const stat = fs.statSync(absPath);
    expect(stat.isFile()).toBe(true);
    expect((stat.mode & 0o111) !== 0).toBe(true);

    const help = spawnSync(absPath, ["--help"], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("사용법: agents");
  });
});

describe("install --scope project", () => {
  let projectDir: string;
  let io: ReturnType<typeof collectOutput>;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-install-"));
    writeOpencodeJson(projectDir, {
      mcp: {
        "codemap-search": {
          type: "local",
          command: ["codemap-search", "mcp"],
          enabled: true,
        },
      },
    });
    io = collectOutput();
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test("project 스코프: agents.toml/install state 생성, plugin/provider 주입, mcp 보존", async () => {
    const exit = await runCli(["install", "--scope", "project"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(exit).toBe(0);

    expect(
      fs.existsSync(path.join(projectDir, ".opencode", "agents.toml")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(projectDir, ".opencode", "agents.install.json")),
    ).toBe(true);

    const cfg = readOpencodeJson(projectDir);
    expect(Array.isArray(cfg.plugin) && cfg.plugin.includes("agents")).toBe(
      true,
    );
    const provider = cfg.provider as
      | Record<string, Record<string, unknown>>
      | undefined;
    expect(provider?.["ollama-cloud"]?.npm).toBe("@ai-sdk/openai-compatible");
    expect(typeof cfg.mcp === "object" && cfg.mcp !== null).toBe(true);
  });

  test("기존 native 설정 보존 (plugin 다른 항목, provider 유지)", async () => {
    const userAgentsTomlPath = path.join(projectDir, ".opencode", "agents.toml");
    const userAgentsTomlContent = "# user-owned\n";
    fs.mkdirSync(path.dirname(userAgentsTomlPath), { recursive: true });
    fs.writeFileSync(userAgentsTomlPath, userAgentsTomlContent, "utf-8");
    writeOpencodeJson(projectDir, {
      plugin: ["agents", "other-plugin"],
      provider: { "ollama-cloud": buildProviderConfig() },
      mcp: {
        "codemap-search": {
          type: "local",
          command: ["codemap-search", "mcp"],
          enabled: true,
        },
      },
    });

    const installExit = await runCli(["install", "--scope", "project"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    const uninstallExit = await runCli(["uninstall", "--scope", "project"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(installExit).toBe(0);
    expect(uninstallExit).toBe(0);

    const cfg = readOpencodeJson(projectDir);
    expect(
      Array.isArray(cfg.plugin) &&
        cfg.plugin.includes("agents") &&
        cfg.plugin.includes("other-plugin"),
    ).toBe(true);
    expect(
      typeof cfg.provider === "object" &&
        cfg.provider !== null &&
        "ollama-cloud" in cfg.provider,
    ).toBe(true);
    expect(fs.readFileSync(userAgentsTomlPath, "utf-8")).toBe(
      userAgentsTomlContent,
    );
  });
});

describe("uninstall --scope project", () => {
  let projectDir: string;
  let io: ReturnType<typeof collectOutput>;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-uninstall-"));
    writeOpencodeJson(projectDir, {
      mcp: {
        "codemap-search": {
          type: "local",
          command: ["codemap-search", "mcp"],
          enabled: true,
        },
      },
    });
    io = collectOutput();
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test("install 후 uninstall → agents.toml/install state 삭제, plugin/provider 제거, mcp 보존", async () => {
    await runCli(["install", "--scope", "project"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    const exit = await runCli(["uninstall", "--scope", "project"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(exit).toBe(0);

    expect(
      fs.existsSync(path.join(projectDir, ".opencode", "agents.toml")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(projectDir, ".opencode", "agents.install.json")),
    ).toBe(false);

    const cfg = readOpencodeJson(projectDir);
    expect(!Array.isArray(cfg.plugin) || !cfg.plugin.includes("agents")).toBe(
      true,
    );
    expect(
      !(
        typeof cfg.provider === "object" &&
        cfg.provider !== null &&
        "ollama-cloud" in cfg.provider
      ),
    ).toBe(true);
    expect(typeof cfg.mcp === "object" && cfg.mcp !== null).toBe(true);
  });
});

describe("install/uninstall --scope user", () => {
  let userConfigDir: string;
  let userProjectDir: string;
  let io: ReturnType<typeof collectOutput>;
  const userEnv = () => ({ ...cliEnv, OPENCODE_CONFIG_DIR: userConfigDir });

  beforeEach(() => {
    userConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-user-cfg-"));
    userProjectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "agents-user-proj-"),
    );
    io = collectOutput();
  });

  afterEach(() => {
    fs.rmSync(userConfigDir, { recursive: true, force: true });
    fs.rmSync(userProjectDir, { recursive: true, force: true });
  });

  test("user 스코프: config/install state 생성 → 제거", async () => {
    const installExit = await runCli(["install", "--scope", "user"], {
      cwd: userProjectDir,
      env: userEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(installExit).toBe(0);
    expect(fs.existsSync(path.join(userConfigDir, "agents.toml"))).toBe(true);
    expect(fs.existsSync(path.join(userConfigDir, "agents.install.json"))).toBe(
      true,
    );

    const cfg = readOpencodeJson(userConfigDir);
    expect(
      Array.isArray(cfg.plugin) &&
        cfg.plugin.includes("agents") &&
        typeof cfg.provider === "object" &&
        cfg.provider !== null &&
        "ollama-cloud" in cfg.provider,
    ).toBe(true);

    const uninstallExit = await runCli(["uninstall", "--scope", "user"], {
      cwd: userProjectDir,
      env: userEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(uninstallExit).toBe(0);
    expect(fs.existsSync(path.join(userConfigDir, "agents.toml"))).toBe(false);
    expect(fs.existsSync(path.join(userConfigDir, "agents.install.json"))).toBe(
      false,
    );

    const cfg2 = readOpencodeJson(userConfigDir);
    expect(
      !Array.isArray(cfg2.plugin) &&
        !(
          typeof cfg2.provider === "object" &&
          cfg2.provider !== null &&
          "ollama-cloud" in cfg2.provider
        ),
    ).toBe(true);
  });
});
