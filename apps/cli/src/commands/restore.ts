import { EXIT_BLOCKED, EXIT_VALID } from "@cli/constants";
import { readOpencodeScope, readTargets } from "@cli/lifecycle/args";
import { createBackup, readBackup, restoreBackup } from "@cli/lifecycle/backup";
import { TARGET_REGISTRY } from "@cli/lifecycle/targets";
import { resolveProjectDirectory } from "@cli/paths";
import type { CliIO } from "@cli/types";

export async function restore(args: string[], io: Required<CliIO>): Promise<number> {
  try {
    const backupIndex = args.indexOf("--backup");
    const backupId = backupIndex >= 0 ? args[backupIndex + 1] : undefined;
    if (!backupId) throw new Error("restore에는 --backup <id>가 필요합니다.");
    const targets = readTargets(args);
    if (!targets) throw new Error("restore에는 안전 사본과 같은 --target이 필요합니다.");
    const scope = readOpencodeScope(args);
    const backup = readBackup(io.env, backupId);
    const requestedTargets = targets.map((target) => `${target}:${target === "opencode" ? scope ?? "" : ""}`).sort();
    const backupTargets = backup.targets.map((target) => `${target.target}:${target.target === "opencode" ? target.scope ?? "" : ""}`).sort();
    if (requestedTargets.join(",") !== backupTargets.join(",")) throw new Error("안전 사본의 대상 또는 범위가 현재 요청과 다릅니다.");
    const projectDirectory = resolveProjectDirectory(args, io.cwd);
    const allowedPaths = targets.flatMap((target) => TARGET_REGISTRY[target].getBackupPaths(projectDirectory, io.env, target === "opencode" ? scope ?? undefined : undefined));
    const current = createBackup(io.env, "before-restore", backup.targets, allowedPaths);
    try {
      restoreBackup(io.env, backup, allowedPaths);
      for (const target of targets) {
        const verification = TARGET_REGISTRY[target].verify(
          projectDirectory,
          io.env,
          target === "opencode" ? scope ?? undefined : undefined,
        );
        if (verification.status !== "absent" && verification.status !== "healthy-current" && verification.status !== "healthy-updatable" && verification.status !== "ahead") {
          throw new Error(`${target} 복원 후 적용 확인 실패: ${verification.reason ?? verification.status}`);
        }
      }
    } catch (error) {
      restoreBackup(io.env, current, allowedPaths);
      throw error;
    }
    io.stdout(`restoredBackupId=${backup.id}`);
    io.stdout(`rollbackBackupId=${current.id}`);
    return EXIT_VALID;
  } catch (error) {
    io.stderr(`restore-failed: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_BLOCKED;
  }
}
