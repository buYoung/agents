import { diagnosticExitCode, emitJson, isJsonFormat, isKeyValueFormat, type DiagnosticCheck } from "@cli/diagnostic-result";
import { combineDiagnosticCollections, collectConfigDiagnostics, collectTargetDiagnostics, type DiagnosticCollection } from "@cli/diagnostic-reports";
import { readOpencodeScope, readTargets } from "@cli/lifecycle/args";
import { resolveProjectDirectory } from "@cli/paths";
import type { CliIO } from "@cli/types";

function isVerbose(args: string[]): boolean {
  return args.includes("--verbose");
}

function formatCheck(check: DiagnosticCheck, verbose: boolean): string {
  const label = check.status === "valid" ? "정상" : check.status === "warning" ? "경고" : check.status === "invalid" ? "무효" : "실행 불가";
  const details = verbose && check.detail ? `\n${check.detail}` : "";
  return `${label} · ${check.summary}${details}`;
}

function emitKeyValues(io: Required<CliIO>, collection: DiagnosticCollection, verbose: boolean): void {
  for (const [key, value] of Object.entries(collection.keyValues)) io.stdout(`${key}=${value}`);
  if (verbose) {
    for (const check of collection.report.checks) {
      if (check.detail) io.stdout(`check.${check.id}.detail=${check.detail.replace(/\n/g, " | ")}`);
    }
  }
  for (const error of collection.errors) io.stderr(error);
}

function emitHumanReport(io: Required<CliIO>, collection: DiagnosticCollection, verbose: boolean): void {
  const { report } = collection;
  io.tui.intro("agents 진단");
  const spinner = io.tui.spinner();
  spinner.start("설치 상태와 실행 환경을 확인하는 중");
  spinner.stop("진단을 수집했습니다.");
  io.tui.note(`${report.summary.status === "valid" ? "정상" : report.summary.status === "warning" ? "경고" : report.summary.status === "invalid" ? "무효" : "실행 불가"} · ${report.summary.message}`, "전체 상태");
  const targetChecks = report.checks.filter((check) => check.id.startsWith("target."));
  if (targetChecks.length > 0) io.tui.note(targetChecks.map((check) => formatCheck(check, verbose)).join("\n"), "Codex/OpenCode 상태");
  const configChecks = report.checks.filter((check) => check.id.startsWith("catalog") || check.id === "config");
  if (configChecks.length > 0) io.tui.note(configChecks.map((check) => formatCheck(check, verbose)).join("\n"), "설정");
  const runtimeChecks = report.checks.filter((check) => check.id === "runtime");
  if (runtimeChecks.length > 0) io.tui.note(runtimeChecks.map((check) => formatCheck(check, verbose)).join("\n"), "실행 준비");
  const problems = report.checks.filter((check) => check.status !== "valid");
  if (problems.length > 0) io.tui.note(problems.map((check) => formatCheck(check, verbose)).join("\n\n"), "문제");
  if (report.nextActions.length > 0) io.tui.note(report.nextActions.map((action, index) => `${index + 1}. ${action}`).join("\n"), "권장 다음 행동");
  if (verbose) io.tui.note("경로·해시 등 세부 검사 값은 `agents doctor --format=kv --verbose` 또는 `agents doctor --json`에서 확인할 수 있습니다.", "세부 정보");
  io.tui.outro(report.summary.status === "valid" ? "진단 완료" : "조치가 필요합니다.");
}

export async function doctor(args: string[], io: Required<CliIO>): Promise<number> {
  const projectDirectory = resolveProjectDirectory(args, io.cwd);
  const targets = readTargets(args);
  let collection: DiagnosticCollection;
  try {
    if (targets) {
      const scope = readOpencodeScope(args);
      if (targets.includes("opencode") && !scope) {
        throw new Error("OpenCode 진단에는 --opencode-scope user 또는 project가 필요합니다.");
      }
      collection = collectTargetDiagnostics(targets, projectDirectory, io.env, scope ?? undefined);
    } else {
      collection = combineDiagnosticCollections(
        collectConfigDiagnostics(projectDirectory, io.env),
        collectTargetDiagnostics(["codex", "opencode"], projectDirectory, io.env, "project"),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    collection = combineDiagnosticCollections({
      report: {
        schemaVersion: 1,
        summary: { status: "blocked", message, validCount: 0, warningCount: 0, invalidCount: 0, blockedCount: 1 },
        checks: [{ id: "diagnostic", status: "blocked", summary: "진단을 실행할 수 없습니다.", detail: message, remediation: "명령 인수와 파일 접근 권한을 확인한 뒤 다시 실행하세요." }],
        nextActions: ["명령 인수와 파일 접근 권한을 확인한 뒤 다시 실행하세요."],
      },
      keyValues: { diagnosticStatus: "blocked" },
      errors: [`doctor-failed: ${message}`],
    });
  }
  if (isJsonFormat(args)) emitJson(io, collection.report);
  else if (!io.isInteractive || isKeyValueFormat(args)) emitKeyValues(io, collection, isVerbose(args));
  else emitHumanReport(io, collection, isVerbose(args));
  return diagnosticExitCode(collection.report);
}
