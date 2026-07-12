import { EXIT_BLOCKED, EXIT_VALID } from "@cli/constants";
import { readOpencodeScope, readTargets } from "@cli/lifecycle/args";
import { inspectTargets } from "@cli/lifecycle/orchestrator";
import { resolveProjectDirectory } from "@cli/paths";
import type { CliIO, LifecycleTarget } from "@cli/types";

export async function status(args: string[], io: Required<CliIO>): Promise<number> {
  let targets;
  let scope;
  try {
    targets = (readTargets(args) ?? ["codex", "opencode"]) as LifecycleTarget[];
    scope = readOpencodeScope(args) ?? "project";
    const inspections = inspectTargets(targets, resolveProjectDirectory(args, io.cwd), io.env, scope);
    if (args.includes("--json")) {
      io.stdout(JSON.stringify({ targets: inspections }, null, 2));
    } else {
      for (const item of inspections) {
        io.stdout(`target=${item.target}`);
        io.stdout(`status=${item.status}`);
        if (item.installedVersion) io.stdout(`installedVersion=${item.installedVersion}`);
        if (item.availableVersion) io.stdout(`availableVersion=${item.availableVersion}`);
        if (item.reason) io.stdout(`reason=${item.reason}`);
      }
    }
    return EXIT_VALID;
  } catch (error) {
    io.stderr(`status-failed: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_BLOCKED;
  }
}
