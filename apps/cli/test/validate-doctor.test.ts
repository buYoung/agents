/**
 * validate-doctor.test.ts — validate/doctor CLI 명령
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runCli } from "@cli/cli";
import { getManagedCatalogPath } from "opencode/core";

const cliEnv = { ...process.env, OLLAMA_API_KEY: "present-for-smoke" };

function writeOpencodeJson(dir: string, config: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(dir, "opencode.json"),
    JSON.stringify(config, null, 2),
    "utf-8",
  );
}

function writeAgentsToml(dir: string, content: string): void {
  const opencodeDir = path.join(dir, ".opencode");
  fs.mkdirSync(opencodeDir, { recursive: true });
  fs.writeFileSync(path.join(opencodeDir, "agents.toml"), content, "utf-8");
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

describe("install + validate + doctor 기본", () => {
  let projectDir: string;
  let io: ReturnType<typeof collectOutput>;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-vd-"));
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

  test("install → validate → doctor 모두 성공, doctor가 catalogVersion/cliVersion 보고", async () => {
    const installExit = await runCli(["install", "--scope", "project"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(installExit).toBe(0);

    const validateExit = await runCli(["validate"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(validateExit).toBe(0);

    const doctorExit = await runCli(["doctor"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(doctorExit).toBe(0);
    expect(io.out.some((l) => l.startsWith("catalogVersion="))).toBe(true);
    expect(io.out.some((l) => l.startsWith("cliVersion="))).toBe(true);
  });
});

describe("reasoning_effort 미지원 값 진단", () => {
  let projectDir: string;
  let io: ReturnType<typeof collectOutput>;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-vd-re-"));
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

  test("validate: invalid 설정 → exit 2 + invalid kind 보고", async () => {
    await runCli(["install", "--scope", "project"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    writeAgentsToml(
      projectDir,
      [
        "[agents.worker]",
        'model = "ollama-cloud/kimi-k2.6"',
        'reasoning_effort = "high"',
      ].join("\n"),
    );

    const validateExit = await runCli(["validate"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(validateExit).toBe(2);
    expect(io.err.some((l) => l.includes("invalid-reasoning-effort"))).toBe(
      true,
    );

    io.err.length = 0;
    writeAgentsToml(
      projectDir,
      ["[agents.orchestrator]", "enable = false"].join("\n"),
    );
    const protectedAgentExit = await runCli(["validate"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(protectedAgentExit).toBe(2);
    expect(io.err.some((l) => l.includes("protected-agent-disabled"))).toBe(
      true,
    );
  });

  test("doctor: invalid 설정 → userConfigValidity=invalid", async () => {
    await runCli(["install", "--scope", "project"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    writeAgentsToml(
      projectDir,
      [
        "[agents.worker]",
        'model = "ollama-cloud/kimi-k2.6"',
        'reasoning_effort = "high"',
      ].join("\n"),
    );

    const doctorOut: string[] = [];
    const doctorErr: string[] = [];
    const exit = await runCli(["doctor"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: (l) => doctorOut.push(l),
      stderr: (l) => doctorErr.push(l),
    });
    expect(exit).toBe(2);
    expect(doctorOut).toContain("userConfigValidity=invalid");
    expect(doctorErr.some((l) => l.includes("invalid-reasoning-effort"))).toBe(
      true,
    );

    writeAgentsToml(
      projectDir,
      ["[agents.orchestrator]", "enable = false"].join("\n"),
    );
    const protectedDoctorOut: string[] = [];
    const protectedDoctorErr: string[] = [];
    const protectedDoctorExit = await runCli(["doctor"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: (l) => protectedDoctorOut.push(l),
      stderr: (l) => protectedDoctorErr.push(l),
    });
    expect(protectedDoctorExit).toBe(2);
    expect(protectedDoctorOut).toContain("userConfigValidity=invalid");
    expect(
      protectedDoctorErr.some((l) => l.includes("protected-agent-disabled")),
    ).toBe(true);
  });
});

describe("손상된 managed catalog 진단", () => {
  test("doctor: 손상된 catalog → invalid 종료, source/validity/path 보고", async () => {
    const projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "agents-vd-corrupt-"),
    );
    const corruptCatalogPath = getManagedCatalogPath(projectDir);
    fs.mkdirSync(path.dirname(corruptCatalogPath), { recursive: true });
    fs.writeFileSync(
      corruptCatalogPath,
      'catalogVersion = "broken"\nmodels = "not-an-array"\n',
      "utf-8",
    );

    const out: string[] = [];
    const err: string[] = [];
    const exit = await runCli(["doctor"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });
    expect(exit).toBe(2);
    expect(out).toContain("catalogSource=managed");
    expect(out).toContain("catalogValidity=invalid");
    expect(
      out.some((l) => l.includes(`activeCatalogPath=${corruptCatalogPath}`)),
    ).toBe(true);
    expect(
      err.some((l) => l.startsWith(`catalog-invalid: ${corruptCatalogPath}:`)),
    ).toBe(true);
    expect(err.some((l) => l.startsWith("internal-error:"))).toBe(false);

    fs.rmSync(projectDir, { recursive: true, force: true });
  });
});
