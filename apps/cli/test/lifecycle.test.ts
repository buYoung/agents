import { afterEach, describe, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runCli } from "@cli/cli";
import { createBackup, listBackupSummaries, readBackup, restoreBackup } from "@cli/lifecycle/backup";
import * as backupModule from "@cli/lifecycle/backup";
import { getCodexLifecycleStatePath, getLifecycleBackupDirectory, getLifecycleJournalPath } from "@cli/lifecycle/paths";
import { TUI_CANCEL, type TuiAdapter } from "@cli/types";

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

function createInteractiveIo(answers: string[]): ReturnType<typeof createIo> & {
  isInteractive: true;
  tui: TuiAdapter;
} {
  const output = createIo();
  const next = () => answers.shift() ?? "0";
  return {
    ...output,
    isInteractive: true,
    tui: {
      intro: (message) => output.out.push(message),
      outro: (message) => output.out.push(message),
      cancel: (message) => output.out.push(message),
      note: (message, title) => output.out.push(`${title ?? "안내"}: ${message}`),
      select: async <T extends string>() => {
        const answer = next();
        if (answer === "0") return TUI_CANCEL;
        return (answer === "1" ? "user" : "project") as T;
      },
      multiselect: async <T extends string>() => {
        const answer = next();
        if (answer === "0") return TUI_CANCEL;
        return (answer === "1" ? ["codex"] : answer === "2" ? ["opencode"] : ["codex", "opencode"]) as T[];
      },
      confirm: async () => {
        const answer = next().toLowerCase();
        return answer === "0" ? TUI_CANCEL : answer === "y" || answer === "yes" || answer === "예";
      },
      spinner: () => ({ start: () => undefined, stop: () => undefined }),
    },
  };
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
    const backup = readBackup(env, backupId ?? "");
    expect(backup.schemaVersion).toBe(3);
    expect(backup.metadata).toMatchObject({
      reason: "manual",
      restorable: true,
      targets: [{ target: "codex", installedVersion: "0.1.0" }],
    });
    expect(backup.metadata?.fileCount).toBeGreaterThan(0);
    expect(backup.metadata?.totalSizeBytes).toBeGreaterThan(0);
    const workerPath = path.join(root, "codex", "agents", "worker.toml");
    const original = fs.readFileSync(workerPath, "utf-8");
    fs.writeFileSync(workerPath, `${original}\n# changed\n`, "utf-8");
    expect(await runCli(["restore", "--target", "codex", "--backup", backupId ?? ""], { cwd: root, env, stdout: io.stdout, stderr: io.stderr }), io.err.join("\n")).toBe(0);
    expect(fs.readFileSync(workerPath, "utf-8")).toBe(original);
  });

  test("대화형 backup은 Clack 어댑터로 대상을 선택하고 완료 요약을 남긴다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-interactive-backup-"));
    temporaryDirectories.push(root);
    const env = { ...process.env, CODEX_HOME: path.join(root, "codex"), XDG_STATE_HOME: path.join(root, "state") };
    const setup = createIo();
    expect(await runCli(["install", "--target", "codex"], { cwd: root, env, ...setup })).toBe(0);
    const io = createInteractiveIo(["1"]);

    expect(await runCli(["backup"], { cwd: root, env, ...io })).toBe(0);
    expect(io.out.join("\n")).toContain("안전 사본 생성 완료:");
    expect(io.out.join("\n")).toContain("복원 가능: 예");
  });

  test("backup/restore 자동 실행은 JSON 계약을 제공하고 대화형 화면에 raw key=value를 섞지 않는다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-machine-output-"));
    temporaryDirectories.push(root);
    const env = { ...process.env, CODEX_HOME: path.join(root, "codex"), XDG_STATE_HOME: path.join(root, "state") };
    const setup = createIo();
    expect(await runCli(["install", "--target", "codex"], { cwd: root, env, ...setup })).toBe(0);
    const backupOutput = createIo();
    expect(await runCli(["backup", "--target", "codex", "--json"], { cwd: root, env, ...backupOutput })).toBe(0);
    const backup = JSON.parse(backupOutput.out.join("\n")) as { schemaVersion: number; backupId: string; backupFiles: number; restorable: boolean };
    expect(backup).toMatchObject({ schemaVersion: 1, restorable: true });
    expect(backup.backupFiles).toBeGreaterThan(0);
    const workerPath = path.join(root, "codex", "agents", "worker.toml");
    fs.appendFileSync(workerPath, "\n# changed\n", "utf-8");
    const restoreOutput = createIo();
    expect(await runCli(["restore", "--target", "codex", "--backup", backup.backupId, "--json"], { cwd: root, env, ...restoreOutput })).toBe(0);
    expect(JSON.parse(restoreOutput.out.join("\n"))).toMatchObject({ schemaVersion: 1, restoredBackupId: backup.backupId });

    const humanOutput = createInteractiveIo(["1"]);
    expect(await runCli(["backup", "--target", "codex"], { cwd: root, env, ...humanOutput })).toBe(0);
    expect(humanOutput.out.some((line) => line.startsWith("backupId="))).toBe(false);
    expect(humanOutput.out.join("\n")).toContain("다음 행동:");
  });

  test("기계 출력 backup/restore는 대화형 선택이나 확인을 실행하지 않고 형식화된 실패 결과만 출력한다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-machine-no-tui-"));
    temporaryDirectories.push(root);
    const env = { ...process.env, CODEX_HOME: path.join(root, "codex"), XDG_STATE_HOME: path.join(root, "state") };
    const setup = createIo();
    expect(await runCli(["install", "--target", "codex"], { cwd: root, env, ...setup })).toBe(0);
    const calls: string[] = [];
    const tui: TuiAdapter = {
      intro: () => calls.push("intro"), outro: () => calls.push("outro"), cancel: () => calls.push("cancel"), note: () => calls.push("note"),
      select: async <T extends string>() => { calls.push("select"); return TUI_CANCEL as T | typeof TUI_CANCEL; },
      multiselect: async <T extends string>() => { calls.push("multiselect"); return TUI_CANCEL as T[] | typeof TUI_CANCEL; },
      confirm: async () => { calls.push("confirm"); return TUI_CANCEL; },
      spinner: () => ({ start: () => calls.push("start"), stop: () => calls.push("stop") }),
    };

    const backupOutput = createIo();
    expect(await runCli(["backup", "--json"], { cwd: root, env, isInteractive: true, tui, ...backupOutput })).toBe(3);
    expect(JSON.parse(backupOutput.out.join("\n"))).toMatchObject({ schemaVersion: 1, error: expect.any(String) });
    expect(backupOutput.err).toEqual([]);

    const restoreOutput = createIo();
    expect(await runCli(["restore", "--format=kv"], { cwd: root, env, isInteractive: true, tui, ...restoreOutput })).toBe(3);
    expect(restoreOutput.out).toContain("rollbackStatus=not-started");
    expect(restoreOutput.out.every((line) => line.includes("="))).toBe(true);
    expect(restoreOutput.err).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("rollback 실패는 성공으로 표현하지 않고 안전 사본과 수동 복구 행동을 보고한다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-rollback-failure-"));
    temporaryDirectories.push(root);
    const env = { ...process.env, CODEX_HOME: path.join(root, "codex"), XDG_STATE_HOME: path.join(root, "state") };
    const setup = createIo();
    expect(await runCli(["install", "--target", "codex"], { cwd: root, env, ...setup })).toBe(0);
    const backupOutput = createIo();
    expect(await runCli(["backup", "--target", "codex", "--json"], { cwd: root, env, ...backupOutput })).toBe(0);
    const backupId = (JSON.parse(backupOutput.out.join("\n")) as { backupId: string }).backupId;
    const restoreSpy = vi.spyOn(backupModule, "restoreBackup").mockImplementation(() => {
      throw new Error("simulated restore failure");
    });
    try {
      const restoreOutput = createIo();
      expect(await runCli(["restore", "--target", "codex", "--backup", backupId, "--json"], { cwd: root, env, ...restoreOutput })).toBe(3);
      const failure = JSON.parse(restoreOutput.out.join("\n")) as { rollbackStatus: string; rollbackRestored: boolean; rollbackBackupId?: string; rollbackError?: string; nextActions: string[] };
      expect(failure).toMatchObject({ rollbackStatus: "failed", rollbackRestored: false, rollbackBackupId: expect.any(String), rollbackError: "simulated restore failure" });
      expect(failure.nextActions.join("\n")).toContain("일부 파일 변경이 남아 있을 수 있습니다");
    } finally {
      restoreSpy.mockRestore();
    }
  });

  test("대화형 restore 성공 화면은 rollback과 doctor 다음 행동을 보여 준다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-interactive-restore-result-"));
    temporaryDirectories.push(root);
    const env = { ...process.env, CODEX_HOME: path.join(root, "codex"), XDG_STATE_HOME: path.join(root, "state") };
    const setup = createIo();
    expect(await runCli(["install", "--target", "codex"], { cwd: root, env, ...setup })).toBe(0);
    const backupOutput = createIo();
    expect(await runCli(["backup", "--target", "codex"], { cwd: root, env, ...backupOutput })).toBe(0);
    const backupId = backupOutput.out.find((line) => line.startsWith("backupId="))?.slice("backupId=".length);
    expect(backupId).toBeTruthy();
    const output = createIo();
    const tui: TuiAdapter = {
      intro: (message) => output.out.push(message), outro: (message) => output.out.push(message), cancel: (message) => output.out.push(message),
      note: (message, title) => output.out.push(`${title}: ${message}`),
      select: async <T extends string>(): Promise<T | typeof TUI_CANCEL> => backupId as T,
      multiselect: async <T extends string>() => ["codex"] as T[],
      confirm: async () => true,
      spinner: () => ({ start: () => undefined, stop: () => undefined }),
    };
    expect(await runCli(["restore"], { cwd: root, env, isInteractive: true, tui, ...output })).toBe(0);
    expect(output.out.join("\n")).toContain("복원 결과:");
    expect(output.out.join("\n")).toContain("복원 직전 상태 보관:");
    expect(output.out.join("\n")).toContain("agents doctor");
    expect(output.out.some((line) => line.startsWith("restoredBackupId="))).toBe(false);
  });

  test("손상되거나 조작된 안전 사본은 목록에서 사유와 함께 차단하고 --backup도 거부한다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-invalid-backup-"));
    temporaryDirectories.push(root);
    const output = createIo();
    const env = { ...process.env, CODEX_HOME: path.join(root, "codex"), XDG_STATE_HOME: path.join(root, "state") };
    expect(await runCli(["install", "--target", "codex"], { cwd: root, env, ...output })).toBe(0);
    output.out.length = 0;
    expect(await runCli(["backup", "--target", "codex"], { cwd: root, env, ...output })).toBe(0);
    const backupId = output.out.find((line) => line.startsWith("backupId="))?.slice("backupId=".length);
    expect(backupId).toBeTruthy();
    for (const backupDirectory of fs.readdirSync(getLifecycleBackupDirectory(env))) {
      const indexPath = path.join(getLifecycleBackupDirectory(env), backupDirectory, "index.json");
      const index = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as { metadata?: { targets: unknown[] } };
      if (index.metadata) {
        index.metadata.targets = [{ target: "opencode", scope: "project" }];
        fs.writeFileSync(indexPath, JSON.stringify(index), "utf-8");
      } else {
        fs.writeFileSync(indexPath, "손상된 기록", "utf-8");
      }
    }

    const capturedOptions: Array<{ disabled?: boolean | string }> = [];
    const capturedNotes: string[] = [];
    const capturedOutros: string[] = [];
    const backupDirectoriesBeforeRestore = fs.readdirSync(getLifecycleBackupDirectory(env)).sort();
    const interactiveIo = {
      ...createIo(),
      isInteractive: true as const,
      tui: {
        intro: () => undefined,
        outro: (message) => capturedOutros.push(message),
        cancel: () => undefined,
        note: (message) => capturedNotes.push(message),
        select: async <T extends string>(_message: string, options: Array<{ disabled?: boolean | string }>) => {
          capturedOptions.push(...options);
          return TUI_CANCEL as T | typeof TUI_CANCEL;
        },
        multiselect: async <T extends string>() => TUI_CANCEL as T[] | typeof TUI_CANCEL,
        confirm: async () => TUI_CANCEL,
        spinner: () => ({ start: () => undefined, stop: () => undefined }),
      } satisfies TuiAdapter,
    };
    expect(await runCli(["restore"], { cwd: root, env, ...interactiveIo })).toBe(3);
    expect(capturedOptions).toHaveLength(0);
    expect(capturedNotes.join("\n")).toContain("복원 가능한 안전 사본이 없습니다");
    expect(capturedNotes.join("\n")).toContain("메타데이터가 실제 기록과 일치하지 않습니다");
    expect(capturedNotes.join("\n")).toContain("다음 행동:");
    expect(capturedOutros).toEqual(["복원을 시작할 수 없습니다."]);
    expect(fs.readdirSync(getLifecycleBackupDirectory(env)).sort()).toEqual(backupDirectoriesBeforeRestore);

    output.err.length = 0;
    expect(await runCli(["restore", "--target", "codex", "--backup", backupId ?? ""], { cwd: root, env, ...output })).toBe(3);
    expect(output.err.join("\n")).toContain("메타데이터가 실제 기록과 일치하지 않습니다");
  });

  test("목록은 내용·크기·경로를 다시 검증하고 v2 안전 사본은 호환한다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-backup-validation-"));
    temporaryDirectories.push(root);
    const env = { ...process.env, XDG_STATE_HOME: path.join(root, "state") };
    const managedDirectory = path.join(root, "managed");
    const managedFile = path.join(managedDirectory, "managed.txt");
    fs.mkdirSync(managedDirectory, { recursive: true });
    fs.writeFileSync(managedFile, "original", "utf-8");
    const backup = createBackup(env, "test", [{ target: "codex" }], [managedFile]);
    const backupDirectory = path.join(getLifecycleBackupDirectory(env), backup.id);
    const indexPath = path.join(backupDirectory, "index.json");
    const payloadPath = path.join(backupDirectory, "files", backup.entries[0]?.relativePath ?? "");

    fs.writeFileSync(payloadPath, "changed", "utf-8");
    const damagedPayload = listBackupSummaries(env, () => [managedDirectory]).find((summary) => summary.id === backup.id);
    expect(damagedPayload).toMatchObject({ restorable: false });
    expect(damagedPayload?.restoreFailureReason).toContain("해시가 일치하지 않습니다");

    fs.writeFileSync(payloadPath, "original", "utf-8");
    const alteredIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as { metadata: { totalSizeBytes: number } };
    alteredIndex.metadata.totalSizeBytes += 1;
    fs.writeFileSync(indexPath, JSON.stringify(alteredIndex), "utf-8");
    const damagedSize = listBackupSummaries(env, () => [managedDirectory]).find((summary) => summary.id === backup.id);
    expect(damagedSize).toMatchObject({ restorable: false });
    expect(damagedSize?.restoreFailureReason).toContain("파일 수 또는 크기가 실제 내용과 일치하지 않습니다");

    fs.writeFileSync(indexPath, JSON.stringify({ ...backup, schemaVersion: 2, metadata: undefined }), "utf-8");
    const legacy = listBackupSummaries(env, () => [managedDirectory]).find((summary) => summary.id === backup.id);
    expect(legacy).toMatchObject({ restorable: true, totalSizeBytes: "original".length });
    const differentEnvironment = listBackupSummaries(env, () => [path.join(root, "different-managed-root")]).find((summary) => summary.id === backup.id);
    expect(differentEnvironment).toMatchObject({ restorable: false });
    expect(differentEnvironment?.restoreFailureReason).toContain("허용되지 않은 경로");
    fs.writeFileSync(managedFile, "changed", "utf-8");
    restoreBackup(env, readBackup(env, backup.id), [managedDirectory]);
    expect(fs.readFileSync(managedFile, "utf-8")).toBe("original");
    fs.rmSync(payloadPath);
    const missingPayload = listBackupSummaries(env, () => [managedDirectory]).find((summary) => summary.id === backup.id);
    expect(missingPayload).toMatchObject({ restorable: false });
    expect(missingPayload?.restoreFailureReason).toContain("내용 파일이 없거나 올바르지 않습니다");
  });

  test("동일한 생성 시각의 안전 사본 목록은 ID로 안정 정렬한다", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-backup-order-"));
    temporaryDirectories.push(root);
    const env = { ...process.env, XDG_STATE_HOME: path.join(root, "state") };
    const managedDirectory = path.join(root, "managed");
    fs.mkdirSync(managedDirectory, { recursive: true });
    const first = createBackup(env, "test", [{ target: "codex" }], [managedDirectory]);
    const second = createBackup(env, "test", [{ target: "codex" }], [managedDirectory]);
    for (const backup of [first, second]) {
      const indexPath = path.join(getLifecycleBackupDirectory(env), backup.id, "index.json");
      const index = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as { createdAt: string; metadata: { createdAt: string } };
      index.createdAt = "2026-07-12T00:00:00.000Z";
      index.metadata.createdAt = index.createdAt;
      fs.writeFileSync(indexPath, JSON.stringify(index), "utf-8");
    }
    expect(listBackupSummaries(env, () => [managedDirectory]).map((summary) => summary.id)).toEqual([first.id, second.id].sort());
  });

  test("대화형 복원 목록은 손상된 최신 안전 사본보다 복원 가능한 안전 사본을 먼저 표시한다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-backup-tui-order-"));
    temporaryDirectories.push(root);
    const env = { ...process.env, CODEX_HOME: path.join(root, "codex"), XDG_STATE_HOME: path.join(root, "state") };
    const output = createIo();
    expect(await runCli(["install", "--target", "codex"], { cwd: root, env, ...output })).toBe(0);
    output.out.length = 0;
    expect(await runCli(["backup", "--target", "codex"], { cwd: root, env, ...output })).toBe(0);
    const restorableBackupId = output.out.find((line) => line.startsWith("backupId="))?.slice("backupId=".length);
    output.out.length = 0;
    expect(await runCli(["backup", "--target", "codex"], { cwd: root, env, ...output })).toBe(0);
    const damagedBackupId = output.out.find((line) => line.startsWith("backupId="))?.slice("backupId=".length);
    expect(restorableBackupId).toBeTruthy();
    expect(damagedBackupId).toBeTruthy();
    fs.writeFileSync(path.join(getLifecycleBackupDirectory(env), damagedBackupId ?? "", "index.json"), "손상된 기록", "utf-8");

    const capturedOptions: Array<{ value: string; label: string; disabled?: boolean | string }> = [];
    const interactiveIo = {
      ...createIo(),
      isInteractive: true as const,
      tui: {
        intro: () => undefined,
        outro: () => undefined,
        cancel: () => undefined,
        note: () => undefined,
        select: async <T extends string>(_message: string, options: Array<{ value: string; label: string; disabled?: boolean | string }>) => {
          capturedOptions.push(...options);
          return TUI_CANCEL as T | typeof TUI_CANCEL;
        },
        multiselect: async <T extends string>() => TUI_CANCEL as T[] | typeof TUI_CANCEL,
        confirm: async () => TUI_CANCEL,
        spinner: () => ({ start: () => undefined, stop: () => undefined }),
      } satisfies TuiAdapter,
    };

    expect(await runCli(["restore"], { cwd: root, env, ...interactiveIo })).toBe(0);
    const restorableOptionIndex = capturedOptions.findIndex((option) => option.value === restorableBackupId);
    const damagedOptionIndex = capturedOptions.findIndex((option) => option.value === damagedBackupId);
    expect(restorableOptionIndex).toBeGreaterThanOrEqual(0);
    expect(damagedOptionIndex).toBeGreaterThan(restorableOptionIndex);
    expect(capturedOptions.slice(0, damagedOptionIndex).every((option) => option.disabled === false)).toBe(true);
    expect(capturedOptions[damagedOptionIndex]?.label).toContain("[복원 불가]");
    expect(capturedOptions[damagedOptionIndex]?.disabled).toEqual(expect.any(String));
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

  test("비대화형 install은 대상이 없으면 필요한 옵션을 알리고 파일을 바꾸지 않는다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-noninteractive-"));
    temporaryDirectories.push(root);
    const io = createIo();
    const env = { ...process.env, CODEX_HOME: path.join(root, "codex"), XDG_STATE_HOME: path.join(root, "state") };

    expect(await runCli(["install"], { cwd: root, env, stdout: io.stdout, stderr: io.stderr })).toBe(3);
    expect(io.err.join("\n")).toContain("--target codex, opencode 또는 all");
    expect(fs.existsSync(path.join(root, "codex"))).toBe(false);
  });

  test("비대화형 update도 대상이 없으면 대상 옵션을 요청한다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-update-noninteractive-"));
    temporaryDirectories.push(root);
    const io = createIo();

    expect(await runCli(["update"], { cwd: root, env: { ...process.env }, stdout: io.stdout, stderr: io.stderr })).toBe(3);
    expect(io.err.join("\n")).toContain("--target codex, opencode 또는 all");
  });

  test("대화형 선택 취소는 파일을 변경하지 않는다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-cancel-"));
    temporaryDirectories.push(root);
    const io = createInteractiveIo(["0"]);
    const env = { ...process.env, CODEX_HOME: path.join(root, "codex"), XDG_STATE_HOME: path.join(root, "state") };

    expect(await runCli(["install"], { cwd: root, env, ...io })).toBe(0);
    expect(io.out).toContain("작업을 취소했습니다. 파일은 변경하지 않았습니다.");
    expect(fs.existsSync(path.join(root, "codex"))).toBe(false);
  });

  test("대화형 확인 취소는 원격 artifact를 읽거나 대상 파일을 만들지 않는다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-remote-cancel-"));
    temporaryDirectories.push(root);
    const missingArtifactPath = path.join(root, "missing-codex.tar.gz");
    const latestPath = path.join(root, "latest.json");
    fs.writeFileSync(latestPath, JSON.stringify({
      cliVersion: "0.1.0",
      catalogVersion: "2026.07.12.1",
      minimumCliVersion: "0.1.0",
      minimumPluginVersion: "0.1.0",
      publishedAt: "2026-07-12T00:00:00.000Z",
      codexAgents: {
        url: `file://${missingArtifactPath}`,
        sha256: "a".repeat(64),
        size: 1,
        version: "0.1.0",
        compatibility: { minimumCliVersion: "0.1.0", maximumCliVersion: "0.1.0" },
        requiredFiles: ["agents/versions.json"],
      },
    }), "utf-8");
    const io = createInteractiveIo(["1", "n"]);
    const env = {
      ...process.env,
      AGENTS_RELEASE_URL: `file://${latestPath}`,
      CODEX_HOME: path.join(root, "codex"),
      XDG_STATE_HOME: path.join(root, "state"),
    };

    expect(await runCli(["install"], { cwd: root, env, ...io })).toBe(0);
    expect(io.out).toContain("작업을 취소했습니다. 파일은 변경하지 않았습니다.");
    expect(fs.existsSync(missingArtifactPath)).toBe(false);
    expect(fs.existsSync(path.join(root, "codex"))).toBe(false);
    expect(fs.existsSync(path.join(root, "state"))).toBe(false);
  });

  test("대화형 취소는 내부 오류 대신 변경 없는 취소로 처리한다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-input-ended-"));
    temporaryDirectories.push(root);
    const output = createInteractiveIo(["0"]);
    const env = { ...process.env, CODEX_HOME: path.join(root, "codex"), XDG_STATE_HOME: path.join(root, "state") };

    expect(await runCli(["install"], {
      cwd: root,
      env,
      ...output,
      isInteractive: true,
      tui: output.tui,
    })).toBe(0);
    expect(output.out).toContain("작업을 취소했습니다. 파일은 변경하지 않았습니다.");
    expect(output.err.join("\n")).not.toContain("internal-error");
    expect(fs.existsSync(path.join(root, "codex"))).toBe(false);
  });

  test("실행 전 확인에서 취소하면 선택한 대상도 변경하지 않는다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-confirm-cancel-"));
    temporaryDirectories.push(root);
    const io = createInteractiveIo(["1", "n"]);
    const env = { ...process.env, CODEX_HOME: path.join(root, "codex"), XDG_STATE_HOME: path.join(root, "state") };

    expect(await runCli(["install"], { cwd: root, env, ...io })).toBe(0);
    expect(io.out.join("\n")).toContain("설치 전 확인:");
    expect(io.out).toContain("작업을 취소했습니다. 파일은 변경하지 않았습니다.");
    expect(fs.existsSync(path.join(root, "codex"))).toBe(false);
  });

  test("확인 뒤 대상 상태가 바뀌면 표시한 계획을 실행하지 않는다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-plan-race-"));
    temporaryDirectories.push(root);
    const output = createIo();
    const env = { ...process.env, CODEX_HOME: path.join(root, "codex"), XDG_STATE_HOME: path.join(root, "state") };
    let questionCount = 0;

    expect(await runCli(["install"], {
      cwd: root,
      env,
      ...output,
      isInteractive: true,
      tui: {
        ...createInteractiveIo(["1", "y"]).tui,
        confirm: async () => {
        questionCount += 1;
        fs.mkdirSync(path.join(root, "codex", "agents"), { recursive: true });
        fs.writeFileSync(path.join(root, "codex", "agents", "external.toml"), "name = \"external\"\n", "utf-8");
        return true;
        },
      },
    })).toBe(3);
    expect(output.err.join("\n")).toContain("표시한 계획을 실행하지 않았습니다");
    expect(fs.existsSync(path.join(root, "codex", "agents", "worker.toml"))).toBe(false);
    expect(fs.existsSync(path.join(root, "state"))).toBe(false);
  });

  test("상태 기록만 바뀌어도 원격 artifact를 받기 전에 안전하게 중단한다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-state-race-"));
    temporaryDirectories.push(root);
    const initialOutput = createIo();
    const stateDirectory = path.join(root, "state");
    const env = {
      ...process.env,
      CODEX_HOME: path.join(root, "codex"),
      XDG_STATE_HOME: stateDirectory,
    };
    expect(await runCli(["install", "--target", "codex"], { cwd: root, env, ...initialOutput })).toBe(0);

    const statePath = getCodexLifecycleStatePath(env);
    const originalWorker = fs.readFileSync(path.join(root, "codex", "agents", "worker.toml"), "utf-8");
    const backupEntriesBefore = fs.readdirSync(getLifecycleBackupDirectory(env)).sort();
    const missingArtifactPath = path.join(root, "missing-codex-artifact.tar.gz");
    const latestPath = path.join(root, "latest.json");
    fs.writeFileSync(latestPath, JSON.stringify({
      cliVersion: "0.1.0",
      catalogVersion: "2026.07.12.1",
      minimumCliVersion: "0.1.0",
      minimumPluginVersion: "0.1.0",
      publishedAt: "2026-07-12T00:00:00.000Z",
      codexAgents: {
        url: `file://${missingArtifactPath}`,
        sha256: "a".repeat(64),
        size: 1,
        version: "0.1.1",
        compatibility: { minimumCliVersion: "0.1.0", maximumCliVersion: "0.1.0" },
        requiredFiles: ["agents/versions.json"],
      },
    }), "utf-8");
    const output = createIo();
    let questionCount = 0;
    let externallyChangedState: string | undefined;
    const interactiveEnv = { ...env, AGENTS_RELEASE_URL: `file://${latestPath}` };

    expect(await runCli(["update"], {
      cwd: root,
      env: interactiveEnv,
      ...output,
      isInteractive: true,
      tui: {
        ...createInteractiveIo(["1", "y"]).tui,
        confirm: async () => {
        questionCount += 1;
        const state = JSON.parse(fs.readFileSync(statePath, "utf-8")) as { files: Array<{ path: string }> };
        state.files = state.files.filter((file) => !file.path.endsWith(`${path.sep}worker.toml`));
        externallyChangedState = JSON.stringify(state, null, 2) + "\n";
        fs.writeFileSync(statePath, externallyChangedState, "utf-8");
        return true;
        },
      },
    })).toBe(3);

    expect(output.err.join("\n")).toContain("원격 artifact를 받거나 표시한 계획을 실행하지 않았습니다");
    expect(fs.existsSync(missingArtifactPath)).toBe(false);
    expect(fs.readFileSync(path.join(root, "codex", "agents", "worker.toml"), "utf-8")).toBe(originalWorker);
    expect(fs.readFileSync(statePath, "utf-8")).toBe(externallyChangedState);
    expect(fs.readdirSync(getLifecycleBackupDirectory(env)).sort()).toEqual(backupEntriesBefore);
    expect(fs.existsSync(getLifecycleJournalPath(env))).toBe(false);
  });

  test("중단된 수명주기 기록이 있으면 대화형 실행은 복구나 다른 작업을 시작하지 않는다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-journal-review-"));
    temporaryDirectories.push(root);
    const io = createInteractiveIo(["1"]);
    const env = { ...process.env, CODEX_HOME: path.join(root, "codex"), XDG_STATE_HOME: path.join(root, "state") };
    const journalPath = getLifecycleJournalPath(env);
    fs.mkdirSync(path.dirname(journalPath), { recursive: true });
    fs.writeFileSync(journalPath, JSON.stringify({ schemaVersion: 1, backupId: "missing", projectDirectory: root, targets: [{ target: "codex" }], phase: "applying" }), "utf-8");

    expect(await runCli(["update"], { cwd: root, env, ...io })).toBe(3);
    expect(io.err.join("\n")).toContain("이전 수명주기 복구가 필요합니다");
    expect(fs.existsSync(journalPath)).toBe(true);
    expect(fs.existsSync(path.join(root, "codex"))).toBe(false);
  });

  test("대화형 install은 미설치 대상을 새 설치로 안내하고, 설치된 대상은 확인만 안내한다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-interactive-current-"));
    temporaryDirectories.push(root);
    const env = { ...process.env, CODEX_HOME: path.join(root, "codex"), XDG_STATE_HOME: path.join(root, "state") };
    const installIo = createInteractiveIo(["1", "y"]);

    expect(await runCli(["install"], { cwd: root, env, ...installIo })).toBe(0);
    expect(installIo.out.join("\n")).toContain("설치되지 않아 새로 설치합니다.");

    const updateIo = createInteractiveIo(["1", "y"]);
    expect(await runCli(["update"], { cwd: root, env, ...updateIo })).toBe(0);
    expect(updateIo.out.join("\n")).toContain("최신 상태라 변경하지 않고 적용 상태만 확인합니다.");
  });

  test("대화형 all은 대상별 혼합 상태와 이전 설치의 재구성을 각각 안내한다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-lifecycle-interactive-mixed-"));
    temporaryDirectories.push(root);
    const env = {
      ...process.env,
      CODEX_HOME: path.join(root, "codex"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_STATE_HOME: path.join(root, "state"),
    };
    const legacyStatePath = path.join(root, ".opencode", "agents.install.json");
    fs.mkdirSync(path.dirname(legacyStatePath), { recursive: true });
    fs.writeFileSync(legacyStatePath, JSON.stringify({ pluginAdded: true, providerAdded: true, nativeConfigPath: "", agentsConfigManaged: true, installedAt: "2020-01-01T00:00:00.000Z" }), "utf-8");
    const io = createInteractiveIo(["3", "2", "y"]);

    expect([0, 1]).toContain(await runCli(["update"], { cwd: root, env, ...io }));
    const output = io.out.join("\n");
    expect(output).toContain("예정 작업: 설치되지 않아 새로 설치합니다.");
    expect(output).toContain("예정 작업: 너무 오래된 설치라 사용자 설정을 보존하고 새 방식으로 다시 설치합니다.");
  });
});
