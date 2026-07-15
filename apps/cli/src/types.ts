export interface CliIO {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /** 터미널 질문을 표시할 수 있는지 명시한다. 테스트에서는 process.stdin에 의존하지 않는다. */
  isInteractive?: boolean;
  /** 테스트에서 실제 터미널 없이 대화형 흐름을 대체하는 얇은 TUI 어댑터다. */
  tui?: TuiAdapter;
}

export interface TuiOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean | string;
}

export interface TuiSpinner {
  start(message?: string): void;
  stop(message?: string): void;
}

export const TUI_CANCEL = Symbol("tui-cancel");
export type TuiCancel = typeof TUI_CANCEL;

/** `@clack/prompts`를 실제 UI로 쓰되 테스트에서는 이 경계만 대체한다. */
export interface TuiAdapter {
  intro(message: string): void;
  outro(message: string): void;
  cancel(message: string): void;
  note(message: string, title?: string): void;
  select<T extends string>(message: string, options: TuiOption<T>[]): Promise<T | TuiCancel>;
  multiselect<T extends string>(message: string, options: TuiOption<T>[]): Promise<T[] | TuiCancel>;
  confirm(message: string): Promise<boolean | TuiCancel>;
  spinner(): TuiSpinner;
}

export interface LatestManifest {
  formatVersion?: 2;
  cliVersion: string;
  catalogVersion: string;
  minimumCliVersion: string;
  minimumPluginVersion: string;
  publishedAt: string;
  catalog?: LatestManifestArtifact;
  claudeCodeAgents?: LatestManifestArtifact;
  codexAgents?: LatestManifestArtifact;
  cli?: LatestManifestArtifact;
  opencode?: LatestManifestArtifact;
  signing?: LatestManifestSigning;
}

export type LatestManifestArtifactName = "catalog" | "claudeCodeAgents" | "codexAgents" | "cli" | "opencode";

export interface LatestManifestArtifact {
  url: string;
  sha256: string;
  size?: number;
  version?: string;
  compatibility?: LatestManifestCompatibility;
  requiredFiles?: string[];
}

export interface LatestManifestCompatibility {
  minimumCliVersion: string;
  maximumCliVersion: string;
}

export interface LatestManifestSigning {
  algorithm: "ed25519";
  keyId: string;
  signature: string;
}

export class ReleaseManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseManifestError";
  }
}

export interface FileSnapshot {
  filePath: string;
  existed: boolean;
  content?: Buffer;
  mode?: number;
}

export interface CliArtifactApplyResult {
  packageRoot: string;
  targetSnapshots: FileSnapshot[];
  actualVersion: string;
}

export interface CodexAgentsArtifactApplyResult {
  targetDirectory: string;
  updatedAgents: string[];
  skippedAgents: string[];
  targetSnapshots: FileSnapshot[];
}

export interface InstallState {
  pluginAdded: boolean;
  providerAdded: boolean;
  nativeConfigPath: string;
  agentsConfigManaged: boolean;
  installedAt: string;
}

export interface ClaudeCodeAgentsArtifactApplyResult {
  targetDirectory: string;
  updatedAgents: string[];
  skippedAgents: string[];
  targetSnapshots: FileSnapshot[];
}

export type LifecycleTarget = "codex" | "claude-code" | "opencode";
export type OpencodeScope = "user" | "project";
export type LifecycleStatus =
  | "absent"
  | "healthy-current"
  | "healthy-updatable"
  | "legacy-rebuild"
  | "damaged"
  | "unmanaged"
  | "ahead"
  | "unknown";
export type RequestedOperation = "install" | "update" | "uninstall";
export type ResolvedOperation =
  | "install"
  | "update"
  | "rebuild"
  | "repair"
  | "uninstall"
  | "verify"
  | "none";

export interface LifecycleFile {
  path: string;
  sha256: string;
}

/** 대상별 파일 소유권과 실제 적용 버전을 남기는 v2 상태 기록이다. */
export interface LifecycleState {
  schemaVersion: 2;
  target: LifecycleTarget;
  scope?: OpencodeScope;
  version: string;
  installedAt: string;
  updatedAt: string;
  files: LifecycleFile[];
  managedPaths: string[];
  userPaths: string[];
  /** OpenCode native 설정에서 CLI가 실제로 추가한 항목만 삭제하기 위한 소유권 기록이다. */
  nativeConfig?: {
    path: string;
    pluginEntry: string;
    providerId: string;
    pluginAdded: boolean;
    providerAdded: boolean;
  };
  lastBackupId?: string;
}

export interface LifecycleInspection {
  target: LifecycleTarget;
  scope?: OpencodeScope;
  status: LifecycleStatus;
  installedVersion?: string;
  availableVersion?: string;
  state: LifecycleState | null;
  reason?: string;
  userModifiedPaths: string[];
}

export interface LifecycleResult {
  target: LifecycleTarget;
  scope?: OpencodeScope;
  requestedOperation: RequestedOperation;
  resolvedOperation: ResolvedOperation;
  status: LifecycleStatus;
  backupId?: string;
  message: string;
}

export interface LifecyclePlanItem {
  inspection: LifecycleInspection;
  resolvedOperation: ResolvedOperation;
  /** 계획 판단에 사용한 상태 기록·관리 경로·버전 입력의 안정된 지문이다. */
  decisionFingerprint: string;
}

export interface BackupEntry {
  originalPath: string;
  /** 안전 사본 생성 시 확정한 물리 복원 경로다. */
  canonicalPath: string;
  relativePath: string;
  existed: boolean;
  mode?: number;
  sha256?: string;
  kind?: "absent" | "file" | "directory";
}

export interface BackupIndex {
  schemaVersion: 2 | 3;
  id: string;
  createdAt: string;
  reason: string;
  targets: Array<{ target: LifecycleTarget; scope?: OpencodeScope }>;
  entries: BackupEntry[];
  metadata?: BackupMetadata;
}

export interface BackupMetadata {
  createdAt: string;
  targets: Array<{ target: LifecycleTarget; scope?: OpencodeScope; installedVersion?: string }>;
  reason: string;
  fileCount: number;
  totalSizeBytes: number;
  restorable: boolean;
  restoreFailureReason?: string;
}

export interface BackupSummary {
  id: string;
  createdAt: string;
  targets: Array<{ target: LifecycleTarget; scope?: OpencodeScope; installedVersion?: string }>;
  reason: string;
  fileCount: number;
  totalSizeBytes: number;
  restorable: boolean;
  restoreFailureReason?: string;
}
