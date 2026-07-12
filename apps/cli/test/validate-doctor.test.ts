/**
 * validate-doctor.test.ts — validate/doctor CLI 명령
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runCli } from "@cli/cli";
import { getBundledCatalogPath, getManagedCatalogPath } from "opencode/core";
import { TUI_CANCEL, type TuiAdapter } from "@cli/types";

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

  test("install → validate 후 doctor가 전체 상태와 catalogVersion/cliVersion을 보고", async () => {
    const isolatedEnv = { ...cliEnv, CODEX_HOME: path.join(projectDir, "codex"), XDG_CONFIG_HOME: path.join(projectDir, "config"), XDG_STATE_HOME: path.join(projectDir, "state") };
    const installExit = await runCli(["install", "--scope", "project"], {
      cwd: projectDir,
      env: isolatedEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(installExit).toBe(0);

    const validateExit = await runCli(["validate"], {
      cwd: projectDir,
      env: isolatedEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(validateExit).toBe(0);

    const doctorExit = await runCli(["doctor"], {
      cwd: projectDir,
      env: isolatedEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(doctorExit).toBe(2);
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

describe("통합 진단 출력 계약", () => {
  test("doctor --json은 안정된 보고서 구조를 출력하고 --format=kv는 TTY에서도 기계 형식을 유지한다", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-diagnostic-format-"));
    const isolatedEnv = { ...cliEnv, CODEX_HOME: path.join(projectDir, "codex"), XDG_CONFIG_HOME: path.join(projectDir, "config"), XDG_STATE_HOME: path.join(projectDir, "state") };
    const json = collectOutput();
    expect(await runCli(["doctor", "--json"], { cwd: projectDir, env: isolatedEnv, ...json })).toBe(1);
    const report = JSON.parse(json.out.join("\n")) as { schemaVersion: number; summary: unknown; checks: unknown[]; nextActions: unknown[] };
    expect(report.schemaVersion).toBe(1);
    expect(report.summary).toBeTruthy();
    expect(Array.isArray(report.checks)).toBe(true);
    expect(Array.isArray(report.nextActions)).toBe(true);

    const calls: string[] = [];
    const tui: TuiAdapter = {
      intro: () => calls.push("intro"), outro: () => calls.push("outro"), cancel: () => calls.push("cancel"), note: () => calls.push("note"),
      select: async <T extends string>(): Promise<T | typeof TUI_CANCEL> => "codex" as T,
      multiselect: async <T extends string>() => ["codex"] as T[],
      confirm: async () => true,
      spinner: () => ({ start: () => calls.push("start"), stop: () => calls.push("stop") }),
    };
    const kv = collectOutput();
    expect(await runCli(["doctor", "--format=kv"], { cwd: projectDir, env: isolatedEnv, isInteractive: true, tui, ...kv })).toBe(1);
    expect(kv.out.some((line) => line.startsWith("catalogVersion="))).toBe(true);
    expect(calls).toEqual([]);
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test("TTY doctor는 Clack 화면 순서로 상태와 다음 행동을 보여 준다", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-diagnostic-tui-"));
    const isolatedEnv = { ...cliEnv, CODEX_HOME: path.join(projectDir, "codex"), XDG_CONFIG_HOME: path.join(projectDir, "config"), XDG_STATE_HOME: path.join(projectDir, "state") };
    const events: string[] = [];
    const notes: string[] = [];
    const tui: TuiAdapter = {
      intro: (message) => events.push(`intro:${message}`), outro: (message) => events.push(`outro:${message}`), cancel: () => events.push("cancel"),
      note: (message, title) => { events.push(`note:${title}`); notes.push(`${title}: ${message}`); },
      select: async <T extends string>(): Promise<T | typeof TUI_CANCEL> => "codex" as T,
      multiselect: async <T extends string>() => ["codex"] as T[],
      confirm: async () => true,
      spinner: () => ({ start: () => events.push("spinner:start"), stop: () => events.push("spinner:stop") }),
    };
    expect(await runCli(["doctor"], { cwd: projectDir, env: isolatedEnv, isInteractive: true, tui, ...collectOutput() })).toBe(1);
    expect(events).toEqual(expect.arrayContaining(["intro:agents 진단", "spinner:start", "spinner:stop", "note:전체 상태", "note:설정", "note:실행 준비"]));
    expect(notes.join("\n")).toContain("카탈로그 신선도를 확인할 관리 상태가 없습니다");
    expect(events.at(-1)).toMatch(/^outro:/);
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test("숨은 status는 기존 JSON과 성공 종료 코드를 유지하고 validate는 기존 설정 종료 코드로 변환한다", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-diagnostic-compat-"));
    const status = collectOutput();
    expect(await runCli(["status", "--target", "codex", "--json"], { cwd: projectDir, env: cliEnv, ...status })).toBe(0);
    const statusResult = JSON.parse(status.out.join("\n")) as { targets: Array<{ target: string }> };
    expect(statusResult.targets).toEqual([expect.objectContaining({ target: "codex" })]);
    expect(status.err).toEqual([]);
    const validate = collectOutput();
    expect(await runCli(["validate", "--json"], { cwd: projectDir, env: cliEnv, ...validate })).toBe(0);
    expect(JSON.parse(validate.out.join("\n")).checks).toBeDefined();
    expect(validate.err).toEqual([]);

    const missingRuntime = collectOutput();
    const missingRuntimeEnv = { ...cliEnv, OLLAMA_API_KEY: "" };
    expect(await runCli(["validate", "--json"], { cwd: projectDir, env: missingRuntimeEnv, ...missingRuntime })).toBe(0);
    const missingRuntimeReport = JSON.parse(missingRuntime.out.join("\n")) as { checks: Array<{ id: string; status: string }> };
    expect(missingRuntimeReport.checks).toContainEqual(expect.objectContaining({ id: "runtime", status: "warning" }));

    const targetValidation = collectOutput();
    const targetEnv = { ...cliEnv, CODEX_HOME: path.join(projectDir, "empty-codex") };
    expect(await runCli(["validate", "--target", "codex", "--json"], { cwd: projectDir, env: targetEnv, ...targetValidation })).toBe(2);
    expect(JSON.parse(targetValidation.out.join("\n")).checks).toContainEqual(expect.objectContaining({ id: "target.codex", status: "warning" }));
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test("관리 상태가 없으면 카탈로그 신선도를 경고로 일관되게 보고한다", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-diagnostic-catalog-unknown-"));
    const managedCatalogPath = getManagedCatalogPath(projectDir);
    fs.mkdirSync(path.dirname(managedCatalogPath), { recursive: true });
    fs.copyFileSync(getBundledCatalogPath(), managedCatalogPath);

    const output = collectOutput();
    const isolatedEnv = { ...cliEnv, CODEX_HOME: path.join(projectDir, "codex"), XDG_CONFIG_HOME: path.join(projectDir, "config"), XDG_STATE_HOME: path.join(projectDir, "state") };
    expect(await runCli(["doctor", "--json"], { cwd: projectDir, env: isolatedEnv, ...output })).toBe(1);
    const report = JSON.parse(output.out.join("\n")) as { checks: Array<{ id: string; status: string; summary: string; detail?: string }>; nextActions: string[] };
    expect(report.checks).toContainEqual(expect.objectContaining({ id: "catalog", status: "warning", detail: "catalogFreshness=unknown" }));
    expect(report.checks.find((check) => check.id === "catalog")?.summary).toContain("확인할 관리 상태가 없습니다");
    expect(report.nextActions.join("\n")).toContain("agents update");
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test("설정 경고와 카탈로그 상태 경고는 모든 진단 형식에서 경고 종료 코드와 다음 행동을 공유한다", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-diagnostic-warnings-"));
    const isolatedEnv = { ...cliEnv, CODEX_HOME: path.join(projectDir, "codex"), XDG_CONFIG_HOME: path.join(projectDir, "config"), XDG_STATE_HOME: path.join(projectDir, "state") };
    writeAgentsToml(projectDir, 'preset = "missing"');

    const validate = collectOutput();
    expect(await runCli(["validate", "--json"], { cwd: projectDir, env: isolatedEnv, ...validate })).toBe(1);
    const validateReport = JSON.parse(validate.out.join("\n")) as { summary: { status: string }; checks: Array<{ id: string; status: string; detail?: string }> };
    expect(validateReport.summary.status).toBe("warning");
    expect(validateReport.checks).toContainEqual(expect.objectContaining({ id: "config", detail: expect.stringContaining("missing-preset") }));
    expect(validateReport.checks).toContainEqual(expect.objectContaining({ id: "config", status: "warning" }));

    const doctor = collectOutput();
    expect(await runCli(["doctor", "--format=kv"], { cwd: projectDir, env: isolatedEnv, ...doctor })).toBe(1);
    expect(doctor.out).toContain("userConfigValidity=warning");
    expect(doctor.err.join("\n")).toContain("missing-preset");

    const managedCatalogPath = getManagedCatalogPath(projectDir);
    fs.mkdirSync(path.dirname(managedCatalogPath), { recursive: true });
    fs.copyFileSync(getBundledCatalogPath(), managedCatalogPath);
    fs.writeFileSync(path.join(projectDir, ".opencode", "agents.state.json"), JSON.stringify({
      pluginVersion: "0.1.0",
      cliVersion: "0.1.0",
      catalogVersion: "stale",
      catalogChecksum: "stale",
      userConfigSchemaVersion: "2026.07.03.1",
      lastCommand: "update",
      lastUpdatedAt: "2026-07-12T00:00:00.000Z",
    }), "utf-8");
    fs.chmodSync(path.dirname(managedCatalogPath), 0o500);
    try {
      const reportOutput = collectOutput();
      expect(await runCli(["doctor", "--json"], { cwd: projectDir, env: isolatedEnv, ...reportOutput })).toBe(1);
      const report = JSON.parse(reportOutput.out.join("\n")) as { checks: Array<{ id: string; status: string }>; nextActions: string[] };
      expect(report.checks).toContainEqual(expect.objectContaining({ id: "catalog", status: "warning" }));
      expect(report.checks).toContainEqual(expect.objectContaining({ id: "catalog-storage", status: "warning" }));
      expect(report.nextActions.join("\n")).toContain("agents update");
    } finally {
      fs.chmodSync(path.dirname(managedCatalogPath), 0o700);
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
