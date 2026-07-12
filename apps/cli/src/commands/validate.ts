import { EXIT_INVALID, EXIT_VALID, EXIT_WARNING } from "@cli/constants";
import { diagnosticExitCode, emitJson, isJsonFormat, type DiagnosticStatus } from "@cli/diagnostic-result";
import { collectConfigDiagnostics, collectTargetDiagnostics } from "@cli/diagnostic-reports";
import { readOpencodeScope, readTargets } from "@cli/lifecycle/args";
import { resolveProjectDirectory } from "@cli/paths";
import type { CliIO } from "@cli/types";

function exitCodeForConfigStatus(status: DiagnosticStatus): number {
  if (status === "valid") return EXIT_VALID;
  if (status === "warning") return EXIT_WARNING;
  return EXIT_INVALID;
}

/**
 * `validate`은 설정 파일 호환 명령이므로, doctor의 실행 환경·저장소 진단을
 * 보고서에는 유지하되 기존 설정 검증 종료 코드에는 반영하지 않는다.
 */
function validateCompatibilityExitCode(report: ReturnType<typeof collectConfigDiagnostics>["report"]): number {
  const configCheck = report.checks.find((check) => check.id === "config");
  return configCheck ? exitCodeForConfigStatus(configCheck.status) : diagnosticExitCode(report);
}

/** 한 버전 동안 유지하는 숨은 호환 명령이다. */
export async function validate(args: string[], io: Required<CliIO>): Promise<number> {
  const projectDirectory = resolveProjectDirectory(args, io.cwd);
  try {
    const targets = readTargets(args);
    if (targets) {
      const scope = readOpencodeScope(args);
      if (targets.includes("opencode") && !scope) throw new Error("OpenCode 검증에는 --opencode-scope user 또는 project가 필요합니다.");
      const collection = collectTargetDiagnostics(targets, projectDirectory, io.env, scope ?? undefined);
      if (isJsonFormat(args)) emitJson(io, collection.report);
      else {
        for (const check of collection.report.checks) {
          io.stdout(`target=${check.metadata?.target ?? "unknown"}`);
          io.stdout(`targetStatus=${check.metadata?.lifecycleStatus ?? "unknown"}`);
          if (check.detail) io.stderr(`${check.metadata?.target ?? "target"}: ${check.detail}`);
        }
      }
      return collection.report.checks.every((check) => check.status === "valid") ? EXIT_VALID : EXIT_INVALID;
    }
    const collection = collectConfigDiagnostics(projectDirectory, io.env);
    if (isJsonFormat(args)) emitJson(io, collection.report);
    else {
      for (const error of collection.errors) io.stderr(error);
      if (collection.report.summary.status === "valid") io.stdout("valid: agents.toml 설정이 유효합니다.");
    }
    return validateCompatibilityExitCode(collection.report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`validation-failed: ${message}`);
    return 3;
  }
}
