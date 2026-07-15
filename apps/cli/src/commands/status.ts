import { EXIT_BLOCKED, EXIT_VALID } from "@cli/constants";
import { readOpencodeScope, readTargets } from "@cli/lifecycle/args";
import { inspectTargets } from "@cli/lifecycle/orchestrator";
import { resolveProjectDirectory } from "@cli/paths";
import type { CliIO, LifecycleTarget } from "@cli/types";

/** 한 버전 동안 유지하는 숨은 호환 명령이다. */
export async function status(args: string[], io: Required<CliIO>): Promise<number> {
  try {
    const targets = (readTargets(args) ?? ["codex", "claude-code", "opencode"]) as LifecycleTarget[];
    const scope = readOpencodeScope(args) ?? "project";
    const inspections = inspectTargets(targets, resolveProjectDirectory(args, io.cwd), io.env, scope);
    if (args.includes("--json")) io.stdout(JSON.stringify({ targets: inspections }, null, 2));
    else {
      for (const inspection of inspections) {
        io.stdout(`target=${inspection.target}`);
        io.stdout(`status=${inspection.status}`);
        if (inspection.installedVersion) io.stdout(`installedVersion=${inspection.installedVersion}`);
        if (inspection.availableVersion) io.stdout(`availableVersion=${inspection.availableVersion}`);
        if (inspection.reason) io.stdout(`reason=${inspection.reason}`);
      }
    }
    return EXIT_VALID;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`status-failed: ${message}`);
    return EXIT_BLOCKED;
  }
}
