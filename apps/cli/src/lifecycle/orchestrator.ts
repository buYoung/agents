import type {
  LifecycleInspection,
  LifecyclePlanItem,
  LifecycleResult,
  LifecycleStatus,
  LifecycleTarget,
  OpencodeScope,
  RequestedOperation,
  ResolvedOperation,
} from "@cli/types";
import * as crypto from "node:crypto";
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

function appendPathFingerprint(
  hash: crypto.Hash,
  filePath: string,
  visitedPaths = new Set<string>(),
): void {
  const resolvedPath = path.resolve(filePath);
  let stats: fs.BigIntStats;
  try {
    stats = fs.lstatSync(resolvedPath, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      hash.update(`absent\0${resolvedPath}\0`);
      return;
    }
    throw error;
  }
  hash.update(`path\0${resolvedPath}\0mode\0${stats.mode}\0mtime\0${stats.mtimeNs}\0`);
  if (stats.isSymbolicLink()) {
    const linkTarget = fs.readlinkSync(resolvedPath);
    hash.update(`symlink\0${linkTarget}\0`);
    const canonicalPath = fs.realpathSync(resolvedPath);
    if (!visitedPaths.has(canonicalPath)) {
      visitedPaths.add(canonicalPath);
      appendPathFingerprint(hash, canonicalPath, visitedPaths);
    }
    return;
  }
  if (stats.isDirectory()) {
    hash.update("directory\0");
    for (const entry of fs.readdirSync(resolvedPath).sort()) {
      appendPathFingerprint(hash, path.join(resolvedPath, entry), visitedPaths);
    }
    return;
  }
  if (stats.isFile()) {
    hash.update("file\0");
    hash.update(crypto.createHash("sha256").update(fs.readFileSync(resolvedPath)).digest());
    return;
  }
  hash.update("other\0");
}

function createDecisionFingerprint(
  inspection: LifecycleInspection,
  projectDirectory: string,
  env: NodeJS.ProcessEnv,
): string {
  const hash = crypto.createHash("sha256");
  hash.update(`target\0${inspection.target}\0scope\0${inspection.scope ?? ""}\0`);
  hash.update(`installed\0${inspection.installedVersion ?? ""}\0available\0${inspection.availableVersion ?? ""}\0`);
  const managedPaths = TARGET_REGISTRY[inspection.target]
    .getBackupPaths(projectDirectory, env, inspection.scope)
    .map((filePath) => path.resolve(filePath))
    .sort();
  for (const managedPath of managedPaths) appendPathFingerprint(hash, managedPath);
  return hash.digest("hex");
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

/** 대화형 확인 전에는 이전 실행 복구도 파일 변경이므로 존재 여부만 확인한다. */
export function hasInterruptedLifecycle(env: NodeJS.ProcessEnv): boolean {
  return fs.existsSync(getLifecycleJournalPath(env));
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

export function planLifecycle(
  targets: LifecycleTarget[],
  requestedOperation: RequestedOperation,
  projectDirectory: string,
  env: NodeJS.ProcessEnv,
  options: { scope?: OpencodeScope; adopt?: boolean; allowDowngrade?: boolean } = {},
): LifecyclePlanItem[] {
  const inspections = inspectTargets(targets, projectDirectory, env, options.scope);
  return inspections.map((inspection) => ({
    inspection,
    resolvedOperation: resolveOperation(requestedOperation, inspection.status, options.adopt === true, options.allowDowngrade === true),
    decisionFingerprint: createDecisionFingerprint(inspection, projectDirectory, env),
  }));
}

export function areLifecyclePlansEqual(
  expected: LifecyclePlanItem[],
  actual: LifecyclePlanItem[],
): boolean {
  return expected.length === actual.length && expected.every((item, index) => {
    const other = actual[index];
    return other !== undefined &&
      item.inspection.target === other.inspection.target &&
      item.inspection.scope === other.inspection.scope &&
      item.inspection.status === other.inspection.status &&
      item.inspection.installedVersion === other.inspection.installedVersion &&
      item.inspection.availableVersion === other.inspection.availableVersion &&
      item.inspection.reason === other.inspection.reason &&
      item.inspection.userModifiedPaths.join("\0") === other.inspection.userModifiedPaths.join("\0") &&
      item.decisionFingerprint === other.decisionFingerprint &&
      item.resolvedOperation === other.resolvedOperation;
  });
}

export function executeLifecycle(
  targets: LifecycleTarget[],
  requestedOperation: RequestedOperation,
  projectDirectory: string,
  env: NodeJS.ProcessEnv,
  options: { scope?: OpencodeScope; adopt?: boolean; allowDowngrade?: boolean; expectedPlan?: LifecyclePlanItem[] } = {},
): LifecycleResult[] {
  if (options.expectedPlan) {
    if (hasInterruptedLifecycle(env)) {
      throw new Error("이전 수명주기 복구가 필요해 확인한 계획을 그대로 실행하지 않았습니다. 현재 상태를 다시 검토하세요.");
    }
  } else {
    recoverInterruptedLifecycle(projectDirectory, env);
  }
  const actualPlan = planLifecycle(targets, requestedOperation, projectDirectory, env, options);
  if (options.expectedPlan && !areLifecyclePlansEqual(options.expectedPlan, actualPlan)) {
    throw new Error("확인 후 대상 상태 또는 배포 버전이 바뀌어 표시한 계획을 실행하지 않았습니다. 현재 상태를 다시 검토하세요.");
  }
  const planned = options.expectedPlan ?? actualPlan;
  const changed = planned.filter((item) => item.resolvedOperation !== "verify" && item.resolvedOperation !== "none");
  const backup = changed.length === 0
    ? undefined
    : createBackup(
        env,
        requestedOperation,
        changed.map(({ inspection }) => ({ target: inspection.target, scope: inspection.scope })),
        changed.flatMap(({ inspection }) => TARGET_REGISTRY[inspection.target].getBackupPaths(projectDirectory, env, inspection.scope)),
        changed.map(({ inspection }) => ({ target: inspection.target, scope: inspection.scope, installedVersion: inspection.installedVersion })),
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
      if (item.resolvedOperation === "uninstall" && verification.status !== "absent" && verification.status !== "unmanaged") {
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
