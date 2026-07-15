import type { LifecycleTarget, OpencodeScope } from "@cli/types";

export function readTargets(
  args: string[],
): LifecycleTarget[] | null {
  const targetIndex = args.indexOf("--target");
  if (targetIndex < 0) return null;
  const value = args[targetIndex + 1];
  if (value === "codex") return ["codex"];
  if (value === "claude-code") return ["claude-code"];
  if (value === "opencode") return ["opencode"];
  if (value === "all") return ["codex", "claude-code", "opencode"];
  throw new Error("--target은 codex, claude-code, opencode 또는 all이어야 합니다.");
}

export function readOpencodeScope(args: string[]): OpencodeScope | null {
  const modernIndex = args.indexOf("--opencode-scope");
  const legacyIndex = args.indexOf("--scope");
  const value =
    modernIndex >= 0
      ? args[modernIndex + 1]
      : legacyIndex >= 0
        ? args[legacyIndex + 1]
        : undefined;
  if (value === undefined) return null;
  if (value === "user" || value === "project") return value;
  throw new Error("OpenCode 범위는 user 또는 project여야 합니다.");
}
