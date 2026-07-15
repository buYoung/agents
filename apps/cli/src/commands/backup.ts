import { EXIT_BLOCKED, EXIT_VALID } from "@cli/constants";
import { emitJson, isJsonFormat, isKeyValueFormat } from "@cli/diagnostic-result";
import { readOpencodeScope, readTargets } from "@cli/lifecycle/args";
import { createBackup } from "@cli/lifecycle/backup";
import { inspectTargets } from "@cli/lifecycle/orchestrator";
import { getLifecycleBackupDirectory } from "@cli/lifecycle/paths";
import { TARGET_REGISTRY } from "@cli/lifecycle/targets";
import { resolveProjectDirectory } from "@cli/paths";
import type { BackupIndex, CliIO } from "@cli/types";
import { selectLifecycleTargets } from "@cli/interactive";
import { finishCancelled } from "@cli/tui";

function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString("ko-KR")} B`;
}

function formatTargets(backup: BackupIndex): string {
  return (backup.metadata?.targets ?? backup.targets)
    .map((target) => `${target.target}${target.scope ? ` (${target.scope})` : ""}`)
    .join(", ");
}

function backupMachineResult(backup: BackupIndex) {
  const metadata = backup.metadata;
  return {
    schemaVersion: 1,
    backupId: backup.id,
    backupFiles: backup.entries.length,
    createdAt: backup.createdAt,
    targets: metadata?.targets ?? backup.targets,
    reason: backup.reason,
    fileCount: metadata?.fileCount ?? backup.entries.length,
    totalSizeBytes: metadata?.totalSizeBytes ?? 0,
    restorable: metadata?.restorable ?? true,
    restoreFailureReason: metadata?.restoreFailureReason,
    nextActions: [`되돌리려면 \`agents restore --backup ${backup.id}\`를 실행하세요.`],
  };
}

function emitBackupKeyValues(io: Required<CliIO>, result: ReturnType<typeof backupMachineResult>): void {
  io.stdout(`backupId=${result.backupId}`);
  io.stdout(`backupFiles=${result.backupFiles}`);
  io.stdout(`createdAt=${result.createdAt}`);
  io.stdout(`targets=${result.targets.map((target) => `${target.target}${target.scope ? `:${target.scope}` : ""}`).join(",")}`);
  io.stdout(`fileCount=${result.fileCount}`);
  io.stdout(`totalSizeBytes=${result.totalSizeBytes}`);
  io.stdout(`restorable=${result.restorable}`);
}

function emitBackupFailure(io: Required<CliIO>, args: string[], message: string): void {
  const result = {
    schemaVersion: 1,
    error: message,
    nextActions: ["명령 인수와 대상 경로를 확인한 뒤 다시 실행하세요."],
  };
  if (isJsonFormat(args)) emitJson(io, result);
  else if (isKeyValueFormat(args)) {
    io.stdout(`error=${message.replace(/\n/g, " | ")}`);
    io.stdout(`nextAction=${result.nextActions[0]}`);
  }
}

export async function backup(args: string[], io: Required<CliIO>): Promise<number> {
  try {
    let targets = readTargets(args);
    let selectedScope: ReturnType<typeof readOpencodeScope> | undefined;
    const isHumanOutput = io.isInteractive && !isJsonFormat(args) && !isKeyValueFormat(args);
    if (!targets && isHumanOutput) {
      io.tui.intro("agents 안전 사본");
      const selection = await selectLifecycleTargets(io.tui);
      if (!selection) {
        finishCancelled(io.tui);
        return EXIT_VALID;
      }
      targets = selection.targets;
      selectedScope = selection.scope;
    }
    if (!targets) throw new Error("backup에는 --target codex, claude-code, opencode 또는 all이 필요합니다. 비대화형에서는 프롬프트를 표시하지 않습니다.");
    const scope = selectedScope ?? readOpencodeScope(args);
    if (targets.includes("opencode") && !scope) throw new Error("OpenCode 안전 사본에는 --opencode-scope가 필요합니다.");
    const projectDirectory = resolveProjectDirectory(args, io.cwd);
    const inspections = inspectTargets(targets, projectDirectory, io.env, scope ?? undefined);
    const backupPaths = targets.flatMap((target) => TARGET_REGISTRY[target].getBackupPaths(projectDirectory, io.env, target === "opencode" ? scope ?? undefined : undefined));
    if (isHumanOutput) {
      io.tui.note([
        `대상: ${targets.map((target) => `${target}${target === "opencode" ? ` (${scope})` : ""}`).join(", ")}`,
        `범위: ${scope ?? "기본"}`,
        `예상 파일 경로: ${backupPaths.length}개`,
        "안전 사본은 현재 파일을 변경하지 않고 보관합니다.",
      ].join("\n"), "생성 전 요약");
    }
    const progress = isHumanOutput ? io.tui.spinner() : undefined;
    progress?.start("안전 사본을 만드는 중");
    const result = createBackup(
      io.env,
      "manual",
      targets.map((target) => ({ target, scope: target === "opencode" ? scope ?? undefined : undefined })),
      backupPaths,
      inspections.map((inspection) => ({ target: inspection.target, scope: inspection.scope, installedVersion: inspection.installedVersion })),
    );
    progress?.stop("안전 사본을 만들었습니다.");
    const machineResult = backupMachineResult(result);
    if (isJsonFormat(args)) emitJson(io, machineResult);
    else if (!isHumanOutput || isKeyValueFormat(args)) emitBackupKeyValues(io, machineResult);
    else {
      io.tui.note([
        `ID: ${result.id}`,
        `생성 시각: ${result.createdAt}`,
        `대상·범위: ${formatTargets(result)}`,
        `설치 버전: ${(result.metadata?.targets ?? []).map((target) => `${target.target}=${target.installedVersion ?? "없음"}`).join(", ") || "없음"}`,
        `파일: ${machineResult.fileCount}개 · ${formatBytes(machineResult.totalSizeBytes)}`,
        `복원 가능: ${machineResult.restorable ? "예" : "아니오"}`,
        `보관 위치: ${getLifecycleBackupDirectory(io.env)}`,
      ].join("\n"), "안전 사본 생성 완료");
      io.tui.note(machineResult.nextActions[0] ?? "`agents doctor`로 상태를 확인하세요.", "다음 행동");
      io.tui.outro("안전 사본 생성 성공");
    }
    return EXIT_VALID;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isJsonFormat(args) || isKeyValueFormat(args)) emitBackupFailure(io, args, message);
    else io.stderr(`backup-failed: ${message}`);
    return EXIT_BLOCKED;
  }
}
