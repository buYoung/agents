import {
  loadCatalog,
  loadPluginConfig,
  validatePluginConfig,
  type ConfigLoadWarning,
} from "opencode/core";
import {
  AGENT_RECORD,
  EXIT_INVALID,
  EXIT_VALID,
  EXIT_WARNING,
} from "@cli/constants";
import { resolveProjectDirectory } from "@cli/paths";
import type { CliIO } from "@cli/types";
import { readOpencodeScope, readTargets } from "@cli/lifecycle/args";
import { inspectTargets } from "@cli/lifecycle/orchestrator";

export async function validate(
  args: string[],
  io: Required<CliIO>,
): Promise<number> {
  const projectDirectory = resolveProjectDirectory(args, io.cwd);
  const targets = readTargets(args);
  if (targets) {
    try {
      const scope = readOpencodeScope(args);
      if (targets.includes("opencode") && !scope) {
        io.stderr("OpenCode 검증에는 --opencode-scope user 또는 project가 필요합니다.");
        return EXIT_INVALID;
      }
      const inspections = inspectTargets(targets, projectDirectory, io.env, scope ?? undefined);
      for (const inspection of inspections) {
        io.stdout(`target=${inspection.target}`);
        io.stdout(`targetStatus=${inspection.status}`);
        if (inspection.reason) io.stderr(`${inspection.target}: ${inspection.reason}`);
      }
      return inspections.every((inspection) => inspection.status === "healthy-current" || inspection.status === "ahead")
        ? EXIT_VALID
        : EXIT_INVALID;
    } catch (error) {
      io.stderr(`target-validation-failed: ${error instanceof Error ? error.message : String(error)}`);
      return EXIT_INVALID;
    }
  }
  const catalog = loadCatalog(projectDirectory);
  const warnings: ConfigLoadWarning[] = [];
  const config = loadPluginConfig(projectDirectory, {
    silent: true,
    catalog,
    agentRecord: AGENT_RECORD,
    onWarning: (warning) => warnings.push(warning),
  });
  const validationMessages = validatePluginConfig(
    config,
    catalog,
    AGENT_RECORD,
  );
  for (const warning of warnings) {
    io.stderr(`${warning.kind}: ${warning.message}`);
  }
  const warningKeys = new Set(
    warnings.map((warning) => `${warning.kind}:${warning.message}`),
  );
  for (const message of validationMessages) {
    if (warningKeys.has(`${message.kind}:${message.message}`)) {
      continue;
    }
    io.stderr(`${message.kind}: ${message.message}`);
  }
  if (
    warnings.some(
      (warning) =>
        warning.kind === "invalid-model" ||
        warning.kind === "invalid-reasoning-effort" ||
        warning.kind === "protected-agent-disabled" ||
        warning.kind === "invalid-schema" ||
        warning.kind === "invalid-toml",
    )
  ) {
    return EXIT_INVALID;
  }
  if (
    validationMessages.some(
      (message) =>
        message.kind === "invalid-model" ||
        message.kind === "invalid-reasoning-effort" ||
        message.kind === "protected-agent-disabled",
    )
  ) {
    return EXIT_INVALID;
  }
  if (warnings.length > 0 || validationMessages.length > 0) {
    return EXIT_WARNING;
  }
  io.stdout("valid: agents.toml 설정이 유효합니다.");
  return EXIT_VALID;
}
