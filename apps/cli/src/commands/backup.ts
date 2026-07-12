import { EXIT_BLOCKED, EXIT_VALID } from "@cli/constants";
import { readOpencodeScope, readTargets } from "@cli/lifecycle/args";
import { createBackup } from "@cli/lifecycle/backup";
import { TARGET_REGISTRY } from "@cli/lifecycle/targets";
import { resolveProjectDirectory } from "@cli/paths";
import type { CliIO } from "@cli/types";

export async function backup(args: string[], io: Required<CliIO>): Promise<number> {
  try {
    const targets = readTargets(args);
    if (!targets) throw new Error("backup에는 --target codex, opencode 또는 all이 필요합니다.");
    const scope = readOpencodeScope(args);
    if (targets.includes("opencode") && !scope) throw new Error("OpenCode 안전 사본에는 --opencode-scope가 필요합니다.");
    const projectDirectory = resolveProjectDirectory(args, io.cwd);
    const result = createBackup(
      io.env,
      "manual",
      targets.map((target) => ({ target, scope: target === "opencode" ? scope ?? undefined : undefined })),
      targets.flatMap((target) => TARGET_REGISTRY[target].getBackupPaths(projectDirectory, io.env, target === "opencode" ? scope ?? undefined : undefined)),
    );
    io.stdout(`backupId=${result.id}`);
    io.stdout(`backupFiles=${result.entries.length}`);
    return EXIT_VALID;
  } catch (error) {
    io.stderr(`backup-failed: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_BLOCKED;
  }
}
