import { afterEach, describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runCli } from "@cli/cli";
import { createBackup, readBackup, restoreBackup } from "@cli/lifecycle/backup";
import { getLifecycleBackupDirectory } from "@cli/lifecycle/paths";

function createIo(): {
  out: string[];
  err: string[];
  stdout: (line: string) => void;
  stderr: (line: string) => void;
} {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (line) => out.push(line), stderr: (line) => err.push(line) };
}

describe.sequential("명시적 대상 수명주기", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("install/update는 대상별 실제 동작으로 자동 전환하고 Codex skill도 관리한다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-"));
    temporaryDirectories.push(root);
    const io = createIo();
    const env = {
      ...process.env,
      CODEX_HOME: path.join(root, "codex"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_STATE_HOME: path.join(root, "state"),
      OLLAMA_API_KEY: "test",
    };
    const installExit = await runCli(
      ["install", "--target", "all", "--opencode-scope", "project"],
      { cwd: root, env, stdout: io.stdout, stderr: io.stderr },
    );
    expect([0, 1]).toContain(installExit);
    expect(io.out).toContain("target=codex");
    expect(io.out).toContain("target=opencode");
    expect(io.out).toContain("resolvedOperation=install");
    expect(fs.existsSync(path.join(root, "codex", "skills", "codex-orchestrator", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".opencode", "agents", "plugin", "plugin.ts"))).toBe(true);

    io.out.length = 0;
    const updateExit = await runCli(
      ["update", "--target", "all", "--opencode-scope", "project"],
      { cwd: root, env, stdout: io.stdout, stderr: io.stderr },
    );
    expect([0, 1]).toContain(updateExit);
    expect(io.out).toContain("resolvedOperation=verify");
  });

  test("backup과 restore는 현재 상태를 보관하고 지정 대상만 복원한다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-backup-"));
    temporaryDirectories.push(root);
    const io = createIo();
    const env = { ...process.env, CODEX_HOME: path.join(root, "codex"), XDG_STATE_HOME: path.join(root, "state") };
    expect(await runCli(["install", "--target", "codex"], { cwd: root, env, stdout: io.stdout, stderr: io.stderr })).toBe(0);
    io.out.length = 0;
    expect(await runCli(["backup", "--target", "codex"], { cwd: root, env, stdout: io.stdout, stderr: io.stderr })).toBe(0);
    const backupId = io.out.find((line) => line.startsWith("backupId="))?.slice("backupId=".length);
    expect(backupId).toBeTruthy();
    const workerPath = path.join(root, "codex", "agents", "worker.toml");
    const original = fs.readFileSync(workerPath, "utf-8");
    fs.writeFileSync(workerPath, `${original}\n# changed\n`, "utf-8");
    expect(await runCli(["restore", "--target", "codex", "--backup", backupId ?? ""], { cwd: root, env, stdout: io.stdout, stderr: io.stderr }), io.err.join("\n")).toBe(0);
    expect(fs.readFileSync(workerPath, "utf-8")).toBe(original);
  });

  test("OpenCode uninstall은 CLI가 추가한 JSONC 등록만 제거하고 trailing comma를 손상시키지 않는다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-uninstall-"));
    temporaryDirectories.push(root);
    const io = createIo();
    const env = { ...process.env, XDG_CONFIG_HOME: path.join(root, "config"), XDG_STATE_HOME: path.join(root, "state") };
    const nativePath = path.join(root, ".opencode", "opencode.json");
    fs.mkdirSync(path.dirname(nativePath), { recursive: true });
    fs.writeFileSync(nativePath, '{\n  "mcp": {},\n}\n', "utf-8");
    expect([0, 1]).toContain(await runCli(["install", "--target", "opencode", "--opencode-scope", "project"], { cwd: root, env, stdout: io.stdout, stderr: io.stderr }));
    expect(fs.readFileSync(nativePath, "utf-8")).not.toContain(",,");
    expect(await runCli(["uninstall", "--target", "opencode", "--opencode-scope", "project"], { cwd: root, env, stdout: io.stdout, stderr: io.stderr }), io.err.join("\n")).toBe(0);
    const restoredConfig = fs.readFileSync(nativePath, "utf-8");
    expect(restoredConfig).toContain('"mcp"');
    expect(restoredConfig).not.toContain("plugin");
    expect(restoredConfig).not.toContain("ollama-cloud");
  });

  test("OpenCode repair는 최초 native 등록 소유권을 유지해 uninstall에서 제거한다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-native-ownership-"));
    temporaryDirectories.push(root);
    const io = createIo();
    const env = { ...process.env, XDG_CONFIG_HOME: path.join(root, "config"), XDG_STATE_HOME: path.join(root, "state") };
    const nativePath = path.join(root, ".opencode", "opencode.json");
    fs.mkdirSync(path.dirname(nativePath), { recursive: true });
    fs.writeFileSync(nativePath, '{"mcp":{}}', "utf-8");
    expect([0, 1]).toContain(await runCli(["install", "--target", "opencode", "--opencode-scope", "project"], { cwd: root, env, stdout: io.stdout, stderr: io.stderr }));
    fs.rmSync(path.join(root, ".opencode", "agents", "plugin", "plugin.ts"));
    expect([0, 1]).toContain(await runCli(["install", "--target", "opencode", "--opencode-scope", "project"], { cwd: root, env, stdout: io.stdout, stderr: io.stderr }));
    expect(await runCli(["uninstall", "--target", "opencode", "--opencode-scope", "project"], { cwd: root, env, stdout: io.stdout, stderr: io.stderr }), io.err.join("\n")).toBe(0);
    const config = fs.readFileSync(nativePath, "utf-8");
    expect(config).not.toContain("plugin.ts");
    expect(config).not.toContain("ollama-cloud");
  });

  test("상태 없는 dangling OpenCode plugin 등록은 restore 성공으로 승인하지 않는다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-dangling-restore-"));
    temporaryDirectories.push(root);
    const io = createIo();
    const env = { ...process.env, XDG_CONFIG_HOME: path.join(root, "config"), XDG_STATE_HOME: path.join(root, "state") };
    const nativePath = path.join(root, ".opencode", "opencode.json");
    const pluginEntry = `file://${path.join(root, ".opencode", "agents", "plugin", "plugin.ts")}`;
    fs.mkdirSync(path.dirname(nativePath), { recursive: true });
    fs.writeFileSync(nativePath, JSON.stringify({ plugin: [pluginEntry] }), "utf-8");
    const backup = createBackup(env, "test", [{ target: "opencode", scope: "project" }], [nativePath]);
    fs.writeFileSync(nativePath, "{}", "utf-8");
    expect(await runCli(["restore", "--target", "opencode", "--opencode-scope", "project", "--backup", backup.id], { cwd: root, env, stdout: io.stdout, stderr: io.stderr })).not.toBe(0);
    expect(fs.readFileSync(nativePath, "utf-8")).toBe("{}");
  });

  test("관리 밖 대상 삭제를 차단하고 빈 디렉터리를 복원한다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-safe-"));
    temporaryDirectories.push(root);
    const io = createIo();
    const env = { ...process.env, CODEX_HOME: path.join(root, "codex"), XDG_STATE_HOME: path.join(root, "state") };
    fs.mkdirSync(path.join(root, "codex", "agents"), { recursive: true });
    fs.writeFileSync(path.join(root, "codex", "agents", "custom.toml"), "name = \"custom\"\n", "utf-8");
    expect(await runCli(["uninstall", "--target", "codex"], { cwd: root, env, stdout: io.stdout, stderr: io.stderr })).not.toBe(0);

    const managedDirectory = path.join(root, "managed");
    fs.mkdirSync(managedDirectory);
    const managedFile = path.join(managedDirectory, "inside.txt");
    fs.writeFileSync(managedFile, "managed", "utf-8");
    const backup = createBackup(env, "test", [{ target: "codex" }], [managedDirectory]);
    fs.rmSync(managedFile);
    fs.writeFileSync(path.join(managedDirectory, "new.txt"), "new", "utf-8");
    restoreBackup(env, backup, [managedDirectory]);
    expect(fs.readdirSync(managedDirectory)).toEqual(["inside.txt"]);

  });

  test("복원은 교체된 부모 심볼릭 링크를 따라가지 않고, 충돌 없는 사본 경로를 사용한다", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-restore-path-"));
    temporaryDirectories.push(root);
    const env = { ...process.env, XDG_STATE_HOME: path.join(root, "state") };
    const managedDirectory = path.join(root, "managed");
    const outsideDirectory = path.join(root, "outside");
    fs.mkdirSync(managedDirectory);
    fs.mkdirSync(outsideDirectory);
    fs.writeFileSync(path.join(managedDirectory, "inside.txt"), "managed", "utf-8");
    const backup = createBackup(env, "test", [{ target: "codex" }], [managedDirectory]);
    fs.rmSync(managedDirectory, { recursive: true });
    fs.symlinkSync(outsideDirectory, managedDirectory);
    expect(() => restoreBackup(env, backup, [managedDirectory])).toThrow("심볼릭 링크");
    expect(fs.readdirSync(outsideDirectory)).toEqual([]);

    const collisionDirectory = path.join(root, "collision");
    fs.mkdirSync(collisionDirectory);
    const colonPath = path.join(collisionDirectory, "a:b");
    const underscorePath = path.join(collisionDirectory, "a_b");
    fs.writeFileSync(colonPath, "colon", "utf-8");
    fs.writeFileSync(underscorePath, "underscore", "utf-8");
    const collisionBackup = createBackup(env, "test", [{ target: "codex" }], [collisionDirectory]);
    expect(new Set(collisionBackup.entries.map((entry) => entry.relativePath)).size).toBe(collisionBackup.entries.length);
    fs.writeFileSync(colonPath, "changed", "utf-8");
    fs.writeFileSync(underscorePath, "changed", "utf-8");
    restoreBackup(env, collisionBackup, [collisionDirectory]);
    expect(fs.readFileSync(colonPath, "utf-8")).toBe("colon");
    expect(fs.readFileSync(underscorePath, "utf-8")).toBe("underscore");
  });

  test("조작된 v2 사본의 물리 경로를 거부하고 정상 사본은 복원한다", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-index-path-"));
    temporaryDirectories.push(root);
    const env = { ...process.env, XDG_STATE_HOME: path.join(root, "state") };
    const managedDirectory = path.join(root, "managed");
    const managedFile = path.join(managedDirectory, "managed.txt");
    const outsideFile = path.join(root, "outside.txt");
    fs.mkdirSync(managedDirectory);
    fs.writeFileSync(managedFile, "original", "utf-8");
    fs.writeFileSync(outsideFile, "outside", "utf-8");

    const backup = createBackup(env, "test", [{ target: "codex" }], [managedFile]);
    const indexPath = path.join(getLifecycleBackupDirectory(env), backup.id, "index.json");
    const tamperedIndex = {
      ...backup,
      entries: backup.entries.map((entry) => ({ ...entry, canonicalPath: outsideFile })),
    };
    fs.writeFileSync(indexPath, JSON.stringify(tamperedIndex), "utf-8");
    fs.writeFileSync(managedFile, "changed", "utf-8");

    expect(() => restoreBackup(env, readBackup(env, backup.id), [managedDirectory])).toThrow("현재 허용 대상과 일치하지 않습니다");
    expect(fs.readFileSync(outsideFile, "utf-8")).toBe("outside");
    expect(fs.readFileSync(managedFile, "utf-8")).toBe("changed");

    fs.writeFileSync(indexPath, JSON.stringify(backup), "utf-8");
    restoreBackup(env, readBackup(env, backup.id), [managedDirectory]);
    expect(fs.readFileSync(managedFile, "utf-8")).toBe("original");

    const missingPath = path.join(managedDirectory, "missing");
    const absentBackup = createBackup(env, "test", [{ target: "codex" }], [missingPath]);
    const outsideDirectory = path.join(root, "outside-directory");
    fs.mkdirSync(outsideDirectory);
    fs.writeFileSync(path.join(outsideDirectory, "keep.txt"), "keep", "utf-8");
    const absentIndexPath = path.join(getLifecycleBackupDirectory(env), absentBackup.id, "index.json");
    const tamperedAbsentIndex = {
      ...absentBackup,
      entries: absentBackup.entries.map((entry) => ({ ...entry, canonicalPath: outsideDirectory })),
    };
    fs.writeFileSync(absentIndexPath, JSON.stringify(tamperedAbsentIndex), "utf-8");

    expect(() => restoreBackup(env, readBackup(env, absentBackup.id), [managedDirectory])).toThrow("현재 허용 대상과 일치하지 않습니다");
    expect(fs.readFileSync(path.join(outsideDirectory, "keep.txt"), "utf-8")).toBe("keep");
  });

  test("Codex 가져오기는 사용자 agent를 유지하면서 관리 파일만 검증한다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-adopt-"));
    temporaryDirectories.push(root);
    const io = createIo();
    const env = { ...process.env, CODEX_HOME: path.join(root, "codex"), XDG_STATE_HOME: path.join(root, "state") };
    const customAgentPath = path.join(root, "codex", "agents", "my-agent.toml");
    fs.mkdirSync(path.dirname(customAgentPath), { recursive: true });
    fs.writeFileSync(customAgentPath, "name = \"my-agent\"\n", "utf-8");
    expect(await runCli(["install", "--target", "codex", "--adopt"], { cwd: root, env, stdout: io.stdout, stderr: io.stderr })).toBe(0);
    expect(fs.readFileSync(customAgentPath, "utf-8")).toBe("name = \"my-agent\"\n");
  });
});
