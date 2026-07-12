import type {
  LifecycleInspection,
  LifecycleResult,
  LifecycleStatus,
  LifecycleTarget,
  OpencodeScope,
  RequestedOperation,
  ResolvedOperation,
} from "@cli/types";
import * as fs from "node:fs";
import * as path from "node:path";
import { createBackup, readBackup, restoreBackup } from "@cli/lifecycle/backup";
import { getLifecycleJournalPath } from "@cli/lifecycle/paths";
import { TARGET_REGISTRY } from "@cli/lifecycle/targets";

function resolveOperation(
  requestedOperation: RequestedOperation,
  status: LifecycleStatus,
  adopt: boolean,
  allowDowngrade: boolean,
): ResolvedOperation {
  if (requestedOperation === "uninstall") {
    if (status === "absent") return "none";
    if (status === "unmanaged" || status === "unknown") {
      throw new Error("관리 소유권을 확인할 수 없어 삭제하지 않았습니다.");
    }
    return "uninstall";
  }
  if (status === "absent") return "install";
  if (status === "healthy-current") return "verify";
  if (status === "ahead") return allowDowngrade ? "update" : "verify";
  if (status === "healthy-updatable") return "update";
  if (status === "legacy-rebuild") return "rebuild";
  if (status === "damaged") return "repair";
  if (status === "unmanaged") {
    if (!adopt) throw new Error("CLI 관리 기록 없는 설치입니다. 기존 설정을 안전 사본으로 보관한 뒤 처리하려면 --adopt를 지정하세요.");
    return "rebuild";
  }
  throw new Error("상태를 안전하게 판정할 수 없어 변경하지 않았습니다.");
}

interface LifecycleJournal {
  schemaVersion: 1;
  backupId: string;
  projectDirectory: string;
  targets: Array<{ target: LifecycleTarget; scope?: OpencodeScope }>;
  phase: "applying" | "rolling-back";
}

function writeJournal(env: NodeJS.ProcessEnv, journal: LifecycleJournal): void {
  const journalPath = getLifecycleJournalPath(env);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${journalPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(journal, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temporaryPath, journalPath);
}

function clearJournal(env: NodeJS.ProcessEnv): void {
  fs.rmSync(getLifecycleJournalPath(env), { force: true });
}

function recoverInterruptedLifecycle(projectDirectory: string, env: NodeJS.ProcessEnv): void {
  const journalPath = getLifecycleJournalPath(env);
  if (!fs.existsSync(journalPath)) return;
  let journal: LifecycleJournal;
  try {
    journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as LifecycleJournal;
  } catch {
    throw new Error("이전 수명주기 journal을 읽을 수 없어 안전하게 계속할 수 없습니다.");
  }
  if (
    journal.schemaVersion !== 1 ||
    journal.projectDirectory !== projectDirectory ||
    !Array.isArray(journal.targets) ||
    !/^[A-Za-z0-9-]+$/.test(journal.backupId)
  ) {
    throw new Error("이전 수명주기 journal이 현재 작업과 일치하지 않아 안전하게 계속할 수 없습니다.");
  }
  const backup = readBackup(env, journal.backupId);
  const allowedPaths = journal.targets.flatMap(({ target, scope }) =>
    TARGET_REGISTRY[target].getBackupPaths(projectDirectory, env, scope),
  );
  writeJournal(env, { ...journal, phase: "rolling-back" });
  restoreBackup(env, backup, allowedPaths);
  clearJournal(env);
}

export function inspectTargets(
  targets: LifecycleTarget[],
  projectDirectory: string,
  env: NodeJS.ProcessEnv,
  scope?: OpencodeScope,
): LifecycleInspection[] {
  return targets.map((target) => TARGET_REGISTRY[target].inspect(projectDirectory, env, target === "opencode" ? scope : undefined));
}

export function executeLifecycle(
  targets: LifecycleTarget[],
  requestedOperation: RequestedOperation,
  projectDirectory: string,
  env: NodeJS.ProcessEnv,
  options: { scope?: OpencodeScope; adopt?: boolean; allowDowngrade?: boolean } = {},
): LifecycleResult[] {
  recoverInterruptedLifecycle(projectDirectory, env);
  const inspections = inspectTargets(targets, projectDirectory, env, options.scope);
  const planned = inspections.map((inspection) => ({
    inspection,
    resolvedOperation: resolveOperation(requestedOperation, inspection.status, options.adopt === true, options.allowDowngrade === true),
  }));
  const changed = planned.filter((item) => item.resolvedOperation !== "verify" && item.resolvedOperation !== "none");
  const backup = changed.length === 0
    ? undefined
    : createBackup(
        env,
        requestedOperation,
        changed.map(({ inspection }) => ({ target: inspection.target, scope: inspection.scope })),
        changed.flatMap(({ inspection }) => TARGET_REGISTRY[inspection.target].getBackupPaths(projectDirectory, env, inspection.scope)),
      );
  if (backup) {
    writeJournal(env, {
      schemaVersion: 1,
      backupId: backup.id,
      projectDirectory,
      targets: changed.map(({ inspection }) => ({ target: inspection.target, scope: inspection.scope })),
      phase: "applying",
    });
  }
  let journalComplete = !backup;
  try {
    for (const item of planned) {
      const handler = TARGET_REGISTRY[item.inspection.target];
      if (item.resolvedOperation === "uninstall") {
        handler.uninstall(projectDirectory, env, item.inspection.scope);
      } else if (item.resolvedOperation !== "verify" && item.resolvedOperation !== "none") {
        handler.apply(projectDirectory, env, item.inspection.scope);
      }
      const verification = handler.verify(projectDirectory, env, item.inspection.scope);
      if (item.resolvedOperation === "uninstall" && verification.status !== "absent") {
        throw new Error(`${item.inspection.target} 삭제 확인 실패: ${verification.reason ?? verification.status}`);
      }
      const verificationAccepted = verification.status === "healthy-current" ||
        (item.resolvedOperation === "verify" && verification.status === "ahead");
      if (item.resolvedOperation !== "uninstall" && item.resolvedOperation !== "none" && !verificationAccepted) {
        throw new Error(`${item.inspection.target} 적용 확인 실패: ${verification.reason ?? verification.status}`);
      }
    }
    journalComplete = true;
  } catch (error) {
    if (backup) {
      writeJournal(env, {
        schemaVersion: 1,
        backupId: backup.id,
        projectDirectory,
        targets: changed.map(({ inspection }) => ({ target: inspection.target, scope: inspection.scope })),
        phase: "rolling-back",
      });
      restoreBackup(env, backup, changed.flatMap(({ inspection }) => TARGET_REGISTRY[inspection.target].getBackupPaths(projectDirectory, env, inspection.scope)));
      journalComplete = true;
    }
    throw error;
  } finally {
    if (journalComplete) clearJournal(env);
  }
  return planned.map(({ inspection, resolvedOperation }) => ({
    target: inspection.target,
    scope: inspection.scope,
    requestedOperation,
    resolvedOperation,
    status: inspection.status,
    backupId: backup?.id,
    message:
      resolvedOperation === "none"
        ? "이미 설치되지 않았습니다."
        : resolvedOperation === "verify"
          ? "변경 없이 적용 상태를 다시 확인했습니다."
          : `${resolvedOperation} 적용과 확인을 완료했습니다.`,
  }));
}
