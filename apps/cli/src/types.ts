export interface CliIO {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

export interface LatestManifest {
  cliVersion: string;
  catalogVersion: string;
  minimumCliVersion: string;
  minimumPluginVersion: string;
  publishedAt: string;
  catalog?: {
    url: string;
    sha256: string;
  };
  cli?: {
    url: string;
    sha256: string;
  };
}

export type LatestManifestArtifactName = "catalog" | "cli";

export interface LatestManifestArtifact {
  url: string;
  sha256: string;
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
}

export interface InstallState {
  pluginAdded: boolean;
  providerAdded: boolean;
  nativeConfigPath: string;
  agentsConfigManaged: boolean;
  installedAt: string;
}
