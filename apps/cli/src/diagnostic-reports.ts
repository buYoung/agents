import * as fs from "node:fs";
import * as path from "node:path";
import {
  getBundledCatalogPath,
  getCatalogChecksum,
  getCatalogSource,
  getManagedCatalogPath,
  loadCatalogSnapshot,
  loadPluginConfig,
  readManagedState,
  USER_CONFIG_SCHEMA_VERSION,
  validatePluginConfig,
  type ConfigLoadWarning,
} from "opencode/core";
import { AGENT_RECORD } from "@cli/constants";
import { accessStatus, directoryWriteStatus, getCatalogFreshness } from "@cli/diagnostics";
import { createDiagnosticReport, type DiagnosticCheck, type DiagnosticReport, type DiagnosticStatus } from "@cli/diagnostic-result";
import { inspectTargets } from "@cli/lifecycle/orchestrator";
import { getPackageVersion, getProjectConfigPath, getUserConfigPath } from "@cli/paths";
import type { LifecycleInspection, LifecycleTarget, OpencodeScope } from "@cli/types";

export interface DiagnosticCollection {
  report: DiagnosticReport;
  keyValues: Record<string, string>;
  errors: string[];
}

function targetStatus(status: LifecycleInspection["status"]): DiagnosticStatus {
  if (status === "healthy-current" || status === "ahead") return "valid";
  if (status === "healthy-updatable" || status === "absent") return "warning";
  if (status === "unknown") return "blocked";
  return "invalid";
}

function targetAction(inspection: LifecycleInspection): string | undefined {
  if (inspection.status === "healthy-updatable") return "`agents update`로 최신 버전을 적용하세요.";
  if (inspection.status === "absent") return "`agents install`로 설치하세요.";
  if (inspection.status === "unmanaged") return "기존 파일을 보관하려면 `agents install --adopt`를 실행하세요.";
  if (inspection.status === "damaged" || inspection.status === "legacy-rebuild") return "`agents update`로 설치 상태를 복구하세요.";
  if (inspection.status === "unknown") return "경로와 권한을 확인한 뒤 `agents doctor --verbose`를 다시 실행하세요.";
  return undefined;
}

export function collectTargetDiagnostics(
  targets: LifecycleTarget[],
  projectDirectory: string,
  env: NodeJS.ProcessEnv,
  scope?: OpencodeScope,
): DiagnosticCollection {
  const inspections = inspectTargets(targets, projectDirectory, env, scope);
  const checks: DiagnosticCheck[] = inspections.map((inspection) => ({
    id: `target.${inspection.target}${inspection.scope ? `.${inspection.scope}` : ""}`,
    status: targetStatus(inspection.status),
    summary: `${inspection.target === "codex" ? "Codex" : "OpenCode"} 상태: ${inspection.status}`,
    detail: inspection.reason,
    remediation: targetAction(inspection),
    metadata: {
      target: inspection.target,
      scope: inspection.scope,
      lifecycleStatus: inspection.status,
      installedVersion: inspection.installedVersion,
      availableVersion: inspection.availableVersion,
      userModifiedFiles: inspection.userModifiedPaths.length,
    },
  }));
  const keyValues: Record<string, string> = {};
  for (const inspection of inspections) {
    const prefix = inspections.length === 1 ? "" : `${inspection.target}.`;
    keyValues[`${prefix}target`] = inspection.target;
    keyValues[`${prefix}status`] = inspection.status;
    keyValues[`${prefix}installedVersion`] = inspection.installedVersion ?? "unknown";
    keyValues[`${prefix}availableVersion`] = inspection.availableVersion ?? "unknown";
    keyValues[`${prefix}userModifiedFiles`] = String(inspection.userModifiedPaths.length);
  }
  return {
    report: createDiagnosticReport(checks, "대상 상태가 정상입니다."),
    keyValues,
    errors: inspections.flatMap((inspection) => inspection.reason ? [`${inspection.target}: ${inspection.reason}`] : []),
  };
}

function configInvalidWarning(warning: ConfigLoadWarning): boolean {
  return warning.kind === "invalid-model" || warning.kind === "invalid-reasoning-effort" || warning.kind === "protected-agent-disabled" || warning.kind === "invalid-schema" || warning.kind === "invalid-toml";
}

function configInvalidMessage(message: { kind: string }): boolean {
  return message.kind === "invalid-model" || message.kind === "invalid-reasoning-effort" || message.kind === "protected-agent-disabled";
}

export function collectConfigDiagnostics(projectDirectory: string, env: NodeJS.ProcessEnv): DiagnosticCollection {
  let catalogSource = getCatalogSource(projectDirectory);
  const managedCatalogPath = getManagedCatalogPath(projectDirectory);
  const projectConfigPath = getProjectConfigPath(projectDirectory);
  const userConfigPath = getUserConfigPath(env);
  const packageVersion = getPackageVersion();
  const state = readManagedState(projectDirectory);
  let catalogChecksum = "unavailable";
  let catalog: ReturnType<typeof loadCatalogSnapshot>["catalog"] | undefined;
  let catalogLoadError: unknown;
  try {
    const snapshot = loadCatalogSnapshot(projectDirectory);
    catalog = snapshot.catalog;
    catalogChecksum = snapshot.checksum;
    catalogSource = snapshot.source;
  } catch (error) {
    catalogLoadError = error;
    try { catalogChecksum = getCatalogChecksum(projectDirectory); } catch { /* 아래 검사에 원인을 기록한다. */ }
  }
  const keyValues: Record<string, string> = {
    pluginVersion: packageVersion,
    cliVersion: packageVersion,
    catalogVersion: catalog?.catalogVersion ?? "unknown",
    userConfigSchemaVersion: String(USER_CONFIG_SCHEMA_VERSION),
    catalogChecksum,
    catalogSource: catalogSource.kind,
    catalogValidity: catalog ? "valid" : "invalid",
    catalogFreshness: catalog ? getCatalogFreshness(state, catalog.catalogVersion, catalogChecksum) : "invalid",
    bundledCatalogPath: getBundledCatalogPath(),
    managedCatalogPath,
    activeCatalogPath: catalogSource.path,
    projectConfigPath,
    userConfigPath,
    managedStatePath: path.join(projectDirectory, ".opencode", "agents.state.json"),
    activeCatalogReadable: accessStatus(catalogSource.path, fs.constants.R_OK),
    managedCatalogWritable: directoryWriteStatus(managedCatalogPath),
    projectConfigStatus: fs.existsSync(projectConfigPath) ? "present" : "missing",
    userConfigStatus: fs.existsSync(userConfigPath) ? "present" : "missing",
    state: state ? "present" : "missing",
  };
  if (!catalog) {
    keyValues.userConfigValidity = "unknown";
    keyValues.runtimeInjectionReady = "unknown";
    const errorMessage = catalogLoadError instanceof Error ? catalogLoadError.message : String(catalogLoadError);
    const report = createDiagnosticReport([{
      id: "catalog",
      status: "invalid",
      summary: "관리 카탈로그를 읽을 수 없습니다.",
      detail: errorMessage,
      remediation: "`agents update`로 카탈로그를 다시 내려받거나 파일 경로와 권한을 확인하세요.",
      metadata: { path: catalogSource.path, checksum: catalogChecksum, source: catalogSource.kind },
    }], "카탈로그를 확인했습니다.");
    return { report, keyValues, errors: [`catalog-invalid: ${catalogSource.path}: ${errorMessage}`] };
  }
  const warnings: ConfigLoadWarning[] = [];
  const config = loadPluginConfig(projectDirectory, {
    silent: true,
    catalog,
    agentRecord: AGENT_RECORD,
    onWarning: (warning) => warnings.push(warning),
  });
  const validationMessages = validatePluginConfig(config, catalog, AGENT_RECORD);
  const warningKeys = new Set(warnings.map((warning) => `${warning.kind}:${warning.message}`));
  const errors = [
    ...warnings.map((warning) => `${warning.kind}: ${warning.filePath}: ${warning.message}`),
    ...validationMessages
      .filter((message) => !warningKeys.has(`${message.kind}:${message.message}`))
      .map((message) => `${message.kind}: ${message.path}: ${message.message}`),
  ];
  const hasInvalidConfig = warnings.some(configInvalidWarning) || validationMessages.some(configInvalidMessage);
  const configStatus: DiagnosticStatus = hasInvalidConfig ? "invalid" : errors.length > 0 ? "warning" : "valid";
  const missingEnvironment = catalog.provider.env.filter((name) => !env[name]);
  keyValues.userConfigValidity = configStatus;
  keyValues.runtimeInjectionReady = missingEnvironment.length === 0 ? "yes" : "unknown";
  const catalogFreshness = keyValues.catalogFreshness;
  const catalogStatus: DiagnosticStatus = catalogFreshness === "current" ? "valid" : "warning";
  const catalogSummary = catalogFreshness === "current"
    ? `카탈로그 정상 · v${catalog.catalogVersion}`
    : catalogFreshness === "unknown"
      ? "카탈로그 신선도를 확인할 관리 상태가 없습니다."
      : "카탈로그와 관리 상태가 일치하지 않습니다.";
  const managedCatalogWritable = keyValues.managedCatalogWritable;
  const checks: DiagnosticCheck[] = [
    {
      id: "catalog",
      status: catalogStatus,
      summary: catalogSummary,
      detail: catalogStatus === "valid" ? undefined : `catalogFreshness=${catalogFreshness}`,
      remediation: catalogStatus === "valid" ? undefined : "`agents update`로 관리 카탈로그와 상태 기록을 다시 동기화하세요.",
      metadata: { version: catalog.catalogVersion, source: catalogSource.kind, checksum: catalogChecksum, freshness: catalogFreshness },
    },
    {
      id: "catalog-storage",
      status: managedCatalogWritable === "yes" ? "valid" : "warning",
      summary: managedCatalogWritable === "yes" ? "관리 카탈로그 저장소에 쓸 수 있습니다." : "관리 카탈로그 저장소에 쓸 수 없습니다.",
      detail: `managedCatalogWritable=${managedCatalogWritable}`,
      remediation: managedCatalogWritable === "yes" ? undefined : "프로젝트의 `.opencode/agents` 디렉터리 쓰기 권한을 확인한 뒤 `agents update`를 다시 실행하세요.",
      metadata: { path: managedCatalogPath, writable: managedCatalogWritable },
    },
    {
      id: "config",
      status: configStatus,
      summary: configStatus === "valid" ? "agents.toml 설정 정상" : configStatus === "warning" ? "agents.toml 설정에 경고가 있습니다." : "agents.toml 설정이 유효하지 않습니다.",
      detail: errors.join("\n") || undefined,
      remediation: configStatus === "valid" ? undefined : "표시된 설정 문제를 수정한 뒤 `agents doctor`를 다시 실행하세요.",
      metadata: { projectConfigPath, userConfigPath },
    },
    {
      id: "runtime",
      status: missingEnvironment.length === 0 ? "valid" : "warning",
      summary: missingEnvironment.length === 0 ? "실행 환경 준비됨" : `환경 변수 누락: ${missingEnvironment.join(", ")}`,
      remediation: missingEnvironment.length === 0 ? undefined : `환경 변수를 설정한 뒤 \`agents doctor\`를 다시 실행하세요.`,
      metadata: { missingEnvironment: missingEnvironment.join(",") || undefined },
    },
  ];
  return { report: createDiagnosticReport(checks, "설정과 실행 환경이 준비되었습니다."), keyValues, errors };
}

export function combineDiagnosticCollections(...collections: DiagnosticCollection[]): DiagnosticCollection {
  const checks = collections.flatMap((collection) => collection.report.checks);
  return {
    report: createDiagnosticReport(checks, "전체 진단이 정상입니다."),
    keyValues: Object.assign({}, ...collections.map((collection) => collection.keyValues)),
    errors: collections.flatMap((collection) => collection.errors),
  };
}
