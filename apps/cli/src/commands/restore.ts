import { EXIT_BLOCKED, EXIT_VALID } from "@cli/constants";
import { emitJson, isJsonFormat, isKeyValueFormat } from "@cli/diagnostic-result";
import { readOpencodeScope, readTargets } from "@cli/lifecycle/args";
import {
  createBackup,
  getBackupSummary,
  listBackupSummaries,
  readBackup,
  restoreBackup,
  validateBackupRestore,
} from "@cli/lifecycle/backup";
import { inspectTargets } from "@cli/lifecycle/orchestrator";
import { TARGET_REGISTRY } from "@cli/lifecycle/targets";
import { resolveProjectDirectory } from "@cli/paths";
import { TUI_CANCEL, type BackupIndex, type BackupSummary, type CliIO, type LifecycleTarget, type OpencodeScope } from "@cli/types";
import { finishCancelled } from "@cli/tui";

function formatBackupTargets(summary: BackupSummary): string {
  return summary.targets.map((target) => `${target.target}${target.scope ? ` (${target.scope})` : ""}${target.installedVersion ? ` v${target.installedVersion}` : ""}`).join(", ");
}

function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString("ko-KR")} B`;
}

function sameTargets(targets: LifecycleTarget[], scope: OpencodeScope | null | undefined, backupTargets: Array<{ target: LifecycleTarget; scope?: OpencodeScope }>): boolean {
  const requested = targets.map((target) => `${target}:${target === "opencode" ? scope ?? "" : ""}`).sort();
  const backedUp = backupTargets.map((target) => `${target.target}:${target.target === "opencode" ? target.scope ?? "" : ""}`).sort();
  return requested.join(",") === backedUp.join(",");
}

type BackupSelection =
  | { kind: "selected"; backup: BackupSummary }
  | { kind: "cancelled" }
  | { kind: "unavailable" };

async function selectBackup(io: Required<CliIO>, projectDirectory: string): Promise<BackupSelection> {
  const backups = listBackupSummaries(io.env, (backup) => backup.targets.flatMap((target) => TARGET_REGISTRY[target.target].getBackupPaths(projectDirectory, io.env, target.scope)));
  const restorableBackups = backups.filter((backup) => backup.restorable);
  if (restorableBackups.length === 0) {
    const reasons = backups.length === 0 ? ["저장된 안전 사본이 없습니다."] : backups.map((backup) => `- ${backup.id}: ${backup.restoreFailureReason ?? "검증 실패"}`);
    const nextAction = backups.length === 0
      ? "새 안전 사본을 만들려면 `agents backup --target codex`, `agents backup --target claude-code` 또는 `agents backup --target opencode --opencode-scope project`를 실행하세요."
      : "손상 사유를 해결하거나 복원 가능한 안전 사본을 만든 뒤 다시 시도하세요.";
    io.tui.note(["복원 가능한 안전 사본이 없습니다.", ...reasons, `다음 행동: ${nextAction}`].join("\n"), "복원할 수 없음");
    return { kind: "unavailable" };
  }
  const selectedId = await io.tui.select("복원할 안전 사본을 선택하세요.", backups.map((backup) => ({
    value: backup.id,
    label: `${backup.restorable ? "" : "[복원 불가] "}${backup.createdAt} · ${formatBackupTargets(backup) || "대상 확인 불가"}`,
    hint: `${formatBytes(backup.totalSizeBytes)} · ${backup.restorable ? "복원 가능" : `복원 불가: ${backup.restoreFailureReason ?? "검증 실패"}`}`,
    disabled: backup.restorable ? false : backup.restoreFailureReason ?? "손상된 안전 사본",
  })));
  if (selectedId === TUI_CANCEL) return { kind: "cancelled" };
  const backup = backups.find((item) => item.id === selectedId);
  return backup ? { kind: "selected", backup } : { kind: "cancelled" };
}

function emitRestoreKeyValues(io: Required<CliIO>, result: { restoredBackupId: string; rollbackBackupId: string; verification: string }): void {
  io.stdout(`restoredBackupId=${result.restoredBackupId}`);
  io.stdout(`rollbackBackupId=${result.rollbackBackupId}`);
  io.stdout(`verification=${result.verification}`);
}

type RollbackStatus = "not-started" | "restored" | "failed";

function restoreFailureNextAction(
  rollbackBackup: BackupIndex | undefined,
  rollbackStatus: RollbackStatus,
): string {
  if (rollbackStatus === "restored") {
    return "복원 직전 상태로 되돌렸습니다. `agents doctor`로 상태를 확인하세요.";
  }
  if (rollbackStatus === "failed") {
    return `일부 파일 변경이 남아 있을 수 있습니다. 권한 또는 파일시스템 오류를 해결한 뒤 rollback 안전 사본 ${rollbackBackup?.id ?? ""}을(를) 다시 복원하고 \`agents doctor\`로 상태를 확인하세요.`;
  }
  return "복원은 파일을 변경하기 전에 중단되었습니다. 원인을 수정한 뒤 `agents doctor`를 실행하세요.";
}

function emitRestoreFailureKeyValues(
  io: Required<CliIO>,
  result: { error: string; rollbackBackupId?: string; rollbackRestored: boolean; rollbackStatus: RollbackStatus; rollbackError?: string; nextActions: string[] },
): void {
  io.stdout(`error=${result.error.replace(/\n/g, " | ")}`);
  io.stdout(`rollbackBackupId=${result.rollbackBackupId ?? "none"}`);
  io.stdout(`rollbackRestored=${result.rollbackRestored}`);
  io.stdout(`rollbackStatus=${result.rollbackStatus}`);
  if (result.rollbackError) io.stdout(`rollbackError=${result.rollbackError.replace(/\n/g, " | ")}`);
  io.stdout(`nextAction=${result.nextActions[0]?.replace(/\n/g, " | ") ?? ""}`);
}

export async function restore(args: string[], io: Required<CliIO>): Promise<number> {
  const isHumanOutput = io.isInteractive && !isJsonFormat(args) && !isKeyValueFormat(args);
  let rollbackBackup: BackupIndex | undefined;
  let rollbackRestored = false;
  let rollbackError: string | undefined;
  let restoreStarted = false;
  try {
    const backupArgumentIndex = args.indexOf("--backup");
    const requestedBackupId = backupArgumentIndex >= 0 ? args[backupArgumentIndex + 1] : undefined;
    const isInteractiveSelection = !requestedBackupId;
    const projectDirectory = resolveProjectDirectory(args, io.cwd);
    if (isHumanOutput) io.tui.intro("agents 복원");
    if (!requestedBackupId && !isHumanOutput) throw new Error("restore에는 --backup <id>가 필요합니다. 기계 출력에서는 프롬프트를 표시하지 않습니다.");
    if (requestedBackupId === undefined && backupArgumentIndex >= 0) throw new Error("--backup에는 안전 사본 ID가 필요합니다.");
    let selectedSummary: BackupSummary | undefined;
    if (isInteractiveSelection && isHumanOutput) {
      const selection = await selectBackup(io, projectDirectory);
      if (selection.kind === "unavailable") {
        io.tui.outro("복원을 시작할 수 없습니다.");
        return EXIT_BLOCKED;
      }
      if (selection.kind === "cancelled") {
        finishCancelled(io.tui);
        return EXIT_VALID;
      }
      selectedSummary = selection.backup;
      if (!selectedSummary.restorable) throw new Error(`선택한 안전 사본은 복원할 수 없습니다: ${selectedSummary.restoreFailureReason ?? "검증 실패"}`);
    }
    const backupId = requestedBackupId ?? selectedSummary?.id;
    if (!backupId) throw new Error("복원할 안전 사본을 선택하지 않았습니다.");
    const backup = readBackup(io.env, backupId);
    const targets = readTargets(args) ?? backup.targets.map((target) => target.target);
    const backupScope = backup.targets.find((target) => target.target === "opencode")?.scope;
    const scope = readOpencodeScope(args) ?? backupScope;
    if (!sameTargets(targets, scope, backup.targets)) throw new Error("안전 사본의 대상 또는 범위가 현재 요청과 다릅니다.");
    const allowedPaths = targets.flatMap((target) => TARGET_REGISTRY[target].getBackupPaths(projectDirectory, io.env, target === "opencode" ? scope ?? undefined : undefined));
    const verifiedPayload = validateBackupRestore(io.env, backup, allowedPaths);
    const summary = getBackupSummary(backup, verifiedPayload);
    if (isHumanOutput) {
      const current = inspectTargets(targets, projectDirectory, io.env, scope ?? undefined);
      io.tui.note([
        `안전 사본: ${summary.id}`,
        `생성 시각: ${summary.createdAt}`,
        `대상·버전: ${formatBackupTargets(summary)}`,
        `파일: ${summary.fileCount}개 · ${formatBytes(summary.totalSizeBytes)}`,
        `현재 상태: ${current.map((item) => `${item.target}=${item.status}`).join(", ")}`,
        "주의: 복원하면 안전 사본 이후의 사용자 변경을 덮어쓸 수 있습니다.",
      ].join("\n"), "복원 전 확인");
      const confirmed = await io.tui.confirm("이 안전 사본으로 복원하시겠습니까?");
      if (confirmed !== true) {
        finishCancelled(io.tui);
        return EXIT_VALID;
      }
    }
    rollbackBackup = createBackup(
      io.env,
      "before-restore",
      backup.targets,
      allowedPaths,
      inspectTargets(targets, projectDirectory, io.env, scope ?? undefined).map((item) => ({ target: item.target, scope: item.scope, installedVersion: item.installedVersion })),
    );
    const progress = isHumanOutput ? io.tui.spinner() : undefined;
    progress?.start("안전 사본을 복원하는 중");
    let verification = "valid";
    try {
      restoreStarted = true;
      restoreBackup(io.env, backup, allowedPaths);
      const verifications = targets.map((target) => TARGET_REGISTRY[target].verify(projectDirectory, io.env, target === "opencode" ? scope ?? undefined : undefined));
      verification = verifications.map((item) => `${item.target}:${item.status}`).join(",");
      for (const item of verifications) {
        if (item.status !== "absent" && item.status !== "healthy-current" && item.status !== "healthy-updatable" && item.status !== "ahead") throw new Error(`${item.target} 복원 후 적용 확인 실패: ${item.reason ?? item.status}`);
      }
    } catch (error) {
      try {
        restoreBackup(io.env, rollbackBackup, allowedPaths);
        rollbackRestored = true;
        progress?.stop("복원에 실패해 복원 직전 상태로 되돌렸습니다.");
      } catch (rollbackFailure) {
        rollbackError = rollbackFailure instanceof Error ? rollbackFailure.message : String(rollbackFailure);
        progress?.stop("복원에 실패했고 복원 직전 상태로 되돌리지 못했습니다.");
      }
      throw error;
    }
    progress?.stop("복원을 완료했습니다.");
    const machineResult = { schemaVersion: 1, restoredBackupId: backup.id, rollbackBackupId: rollbackBackup.id, verification, nextActions: [`되돌리려면 \`agents restore --backup ${rollbackBackup.id}\`를 실행하세요.`, "`agents doctor`로 전체 실행 준비 상태를 확인하세요."] };
    if (isJsonFormat(args)) emitJson(io, machineResult);
    else if (!isHumanOutput || isKeyValueFormat(args)) emitRestoreKeyValues(io, machineResult);
    else {
      io.tui.note([
        `복원한 안전 사본: ${backup.id}`,
        `적용 대상·버전: ${formatBackupTargets(summary)}`,
        `적용 확인: ${verification}`,
        `복원 직전 상태 보관: ${rollbackBackup.id}`,
        `즉시 되돌리기: agents restore --backup ${rollbackBackup.id}`,
      ].join("\n"), "복원 결과");
      io.tui.note(machineResult.nextActions[1] ?? "`agents doctor`를 실행하세요.", "다음 행동");
      io.tui.outro("복원 성공");
    }
    return EXIT_VALID;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const rollbackStatus: RollbackStatus = rollbackRestored ? "restored" : rollbackError ? "failed" : "not-started";
    const failureResult = {
      schemaVersion: 1,
      error: message,
      rollbackBackupId: rollbackBackup?.id,
      rollbackRestored,
      rollbackStatus,
      rollbackError,
      restoreStarted,
      nextActions: [restoreFailureNextAction(rollbackBackup, rollbackStatus)],
    };
    if (isJsonFormat(args)) emitJson(io, failureResult);
    else if (isKeyValueFormat(args)) emitRestoreFailureKeyValues(io, failureResult);
    else if (isHumanOutput) {
      const rollbackMessage = rollbackStatus === "restored"
        ? `성공 (${rollbackBackup?.id})`
        : rollbackStatus === "failed"
          ? `실패 (${rollbackBackup?.id}): ${rollbackError}`
          : restoreStarted ? "확인하지 못함" : "복원 시작 전";
      io.tui.note([`실패 원인: ${message}`, `rollback: ${rollbackMessage}`, `다음 행동: ${failureResult.nextActions[0]}`].join("\n"), "복원 실패");
      io.tui.outro("복원에 실패했습니다.");
    } else {
      io.stderr(`restore-failed: ${message}`);
      if (rollbackBackup) io.stderr(`rollbackStatus=${rollbackStatus}`);
    }
    return EXIT_BLOCKED;
  }
}
