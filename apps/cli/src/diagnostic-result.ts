import {
  EXIT_BLOCKED,
  EXIT_INVALID,
  EXIT_VALID,
  EXIT_WARNING,
} from "@cli/constants";

/** 진단 명령이 공유하는 안정된 검사 상태와 종료 코드 의미다. */
export type DiagnosticStatus = "valid" | "warning" | "invalid" | "blocked";

export interface DiagnosticCheck {
  id: string;
  status: DiagnosticStatus;
  summary: string;
  detail?: string;
  remediation?: string;
  metadata?: Record<string, string | number | boolean | undefined>;
}

export interface DiagnosticReport {
  schemaVersion: 1;
  summary: {
    status: DiagnosticStatus;
    message: string;
    validCount: number;
    warningCount: number;
    invalidCount: number;
    blockedCount: number;
  };
  checks: DiagnosticCheck[];
  nextActions: string[];
}

const severity: Record<DiagnosticStatus, number> = {
  valid: 0,
  warning: 1,
  invalid: 2,
  blocked: 3,
};

export function createDiagnosticReport(
  checks: DiagnosticCheck[],
  fallbackMessage: string,
): DiagnosticReport {
  const count = (status: DiagnosticStatus) => checks.filter((check) => check.status === status).length;
  const status = checks.reduce<DiagnosticStatus>(
    (current, check) => severity[check.status] > severity[current] ? check.status : current,
    "valid",
  );
  const nextActions = [...new Set(checks
    .filter((check) => check.status !== "valid")
    .map((check) => check.remediation)
    .filter((action): action is string => Boolean(action)))];
  const message = status === "valid"
    ? fallbackMessage
    : checks.find((check) => check.status === status)?.summary ?? fallbackMessage;
  return {
    schemaVersion: 1,
    summary: {
      status,
      message,
      validCount: count("valid"),
      warningCount: count("warning"),
      invalidCount: count("invalid"),
      blockedCount: count("blocked"),
    },
    checks,
    nextActions,
  };
}

export function diagnosticExitCode(report: DiagnosticReport): number {
  if (report.summary.status === "valid") return EXIT_VALID;
  if (report.summary.status === "warning") return EXIT_WARNING;
  if (report.summary.status === "invalid") return EXIT_INVALID;
  return EXIT_BLOCKED;
}

export function isJsonFormat(args: string[]): boolean {
  return args.includes("--json");
}

export function isKeyValueFormat(args: string[]): boolean {
  return args.includes("--format=kv") || args.includes("--format") && args[args.indexOf("--format") + 1] === "kv";
}

export function emitJson(io: { stdout(line: string): void }, value: unknown): void {
  io.stdout(JSON.stringify(value, null, 2));
}
