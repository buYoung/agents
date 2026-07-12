/**
 * update-upgrade.test.ts — update/upgrade CLI 명령, checksum 검증, managed catalog
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import { runCli } from "@cli/cli";
import { parseLatestManifest } from "@cli/release";
import { stageRemoteTargetSources } from "@cli/lifecycle/targets";
import { executeLifecycle } from "@cli/lifecycle/orchestrator";
import { sha256, getManagedCatalogPath } from "opencode/core";
import _pluginFactory from "opencode";

const pluginFactory =
  typeof _pluginFactory === "function"
    ? _pluginFactory
    : "server" in _pluginFactory
      ? _pluginFactory.server
      : (_pluginFactory as { default: { server: typeof _pluginFactory } }).default
          .server;

const cliEnv = { ...process.env, OLLAMA_API_KEY: "present-for-smoke" };

describe("배포 목록 v2 검증", () => {
  test("대상별 실제 버전·호환 범위·필수 파일을 보존한다", () => {
    const checksum = "a".repeat(64);
    const manifest = parseLatestManifest(JSON.stringify({
      formatVersion: 2,
      cliVersion: "0.1.0",
      catalogVersion: "2026.07.05.1",
      minimumCliVersion: "0.1.0",
      minimumPluginVersion: "0.1.0",
      publishedAt: "2026-07-12T00:00:00.000Z",
      catalog: { url: "https://example.test/catalog.toml", sha256: checksum, size: 1, version: "2026.07.05.1", compatibility: { minimumCliVersion: "0.1.0", maximumCliVersion: "0.1.0" }, requiredFiles: ["catalog.toml"] },
      cli: { url: "https://example.test/cli.tar.gz", sha256: checksum, size: 1, version: "0.1.0", compatibility: { minimumCliVersion: "0.1.0", maximumCliVersion: "0.1.0" }, requiredFiles: ["bin/agents"] },
      opencode: { url: "https://example.test/opencode.tar.gz", sha256: checksum, size: 1, version: "0.1.0", compatibility: { minimumCliVersion: "0.1.0", maximumCliVersion: "0.1.0" }, requiredFiles: ["plugin.mjs"] },
      codexAgents: { url: "https://example.test/codex.tar.gz", sha256: checksum, size: 1, version: "0.1.0", compatibility: { minimumCliVersion: "0.1.0", maximumCliVersion: "0.1.0" }, requiredFiles: ["agents/versions.json"] }
    }));
    expect(manifest.opencode?.version).toBe("0.1.0");
    expect(manifest.codexAgents?.requiredFiles).toContain("agents/versions.json");
  });

  test("필수 파일 경로 탈출을 거부한다", () => {
    expect(() => parseLatestManifest(JSON.stringify({
      cliVersion: "0.1.0", catalogVersion: "2026.07.05.1", minimumCliVersion: "0.1.0", minimumPluginVersion: "0.1.0", publishedAt: "2026-07-12T00:00:00.000Z",
      cli: { url: "https://example.test/cli.tar.gz", sha256: "a".repeat(64), requiredFiles: ["../escape"] }
    }))).toThrow("requiredFiles");
  });

  test("v2 artifact에 크기 계약이 없으면 거부한다", () => {
    expect(() => parseLatestManifest(JSON.stringify({
      formatVersion: 2,
      cliVersion: "0.1.0", catalogVersion: "2026.07.05.1", minimumCliVersion: "0.1.0", minimumPluginVersion: "0.1.0", publishedAt: "2026-07-12T00:00:00.000Z",
      catalog: { url: "https://example.test/catalog.toml", sha256: "a".repeat(64), version: "2026.07.05.1", compatibility: { minimumCliVersion: "0.1.0", maximumCliVersion: "0.1.0" }, requiredFiles: ["catalog.toml"] },
      cli: { url: "https://example.test/cli.tar.gz", sha256: "a".repeat(64), size: 1, version: "0.1.0", compatibility: { minimumCliVersion: "0.1.0", maximumCliVersion: "0.1.0" }, requiredFiles: ["bin/agents"] },
      opencode: { url: "https://example.test/opencode.tar.gz", sha256: "a".repeat(64), size: 1, version: "0.1.0", compatibility: { minimumCliVersion: "0.1.0", maximumCliVersion: "0.1.0" }, requiredFiles: ["plugin.mjs"] },
      codexAgents: { url: "https://example.test/codex.tar.gz", sha256: "a".repeat(64), size: 1, version: "0.1.0", compatibility: { minimumCliVersion: "0.1.0", maximumCliVersion: "0.1.0" }, requiredFiles: ["agents/versions.json"] },
    }))).toThrow("v2 계약");
  });

  test("대상 수명주기는 원격 artifact를 임시 source로 준비한다", async () => {
    const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "agents-target-release-"));
    const artifactPath = path.join(fixtureDirectory, "agents-codex-0.1.0.tar.gz");
    const content = createTarGz([
      { name: "package.json", content: Buffer.from(JSON.stringify({ name: "codex", version: "0.1.0" })) },
      { name: "agents/versions.json", content: Buffer.from("{}") },
      { name: "skills/codex-orchestrator/SKILL.md", content: Buffer.from("# skill\n") },
      { name: "skills/codex-orchestrator/agents/openai.yaml", content: Buffer.from("name: test\n") },
    ]);
    fs.writeFileSync(artifactPath, content);
    const manifest = {
      cliVersion: "0.1.0", catalogVersion: "2026.07.05.1", minimumCliVersion: "0.1.0", minimumPluginVersion: "0.1.0", publishedAt: "2026-07-12T00:00:00.000Z",
      codexAgents: { url: `file://${artifactPath}`, sha256: sha256(content), size: content.length, version: "0.1.0", compatibility: { minimumCliVersion: "0.1.0", maximumCliVersion: "0.1.0" }, requiredFiles: ["agents/versions.json", "skills/codex-orchestrator/SKILL.md", "skills/codex-orchestrator/agents/openai.yaml"] },
    } as never;
    const staged = await stageRemoteTargetSources(manifest, ["codex"], cliEnv);
    try {
      expect(staged.env.AGENTS_CODEX_ARTIFACT_ROOT).toBeDefined();
      expect(fs.existsSync(path.join(staged.env.AGENTS_CODEX_ARTIFACT_ROOT!, "agents", "versions.json"))).toBe(true);
    } finally {
      staged.cleanup();
      fs.rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });

  test("원격 OpenCode plugin은 임시 source 정리 뒤에도 영구 사본으로 설치·업데이트·복원·삭제·실패 복구한다", async () => {
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "agents-opencode-remote-lifecycle-"));
    const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "agents-opencode-remote-artifact-"));
    const catalogContent = fs.readFileSync(
      path.join(process.cwd(), "..", "..", "packages", "opencode", "src", "core", "catalog", "catalog.toml"),
      "utf-8",
    );
    const agentsContent = fs.readFileSync(
      path.join(process.cwd(), "..", "..", "packages", "opencode", "agents.example.toml"),
      "utf-8",
    );
    const customPluginPath = path.join(projectDirectory, "custom-plugin.mjs");
    const nativeConfigPath = path.join(projectDirectory, "opencode.json");
    const managedPluginPath = path.join(projectDirectory, ".opencode", "agents", "plugin", "plugin.mjs");
    const managedEntryPath = path.join(projectDirectory, ".opencode", "agents", "plugin", "plugin.ts");
    const environment = {
      ...cliEnv,
      XDG_STATE_HOME: path.join(projectDirectory, "state"),
    };
    const stageArtifact = async (version: string, pluginVersion: string, artifactCatalog = catalogContent) => {
      const artifactPath = path.join(fixtureDirectory, `agents-opencode-${version}.tar.gz`);
      const content = createTarGz([
        { name: "package.json", content: Buffer.from(JSON.stringify({ name: "opencode", version })) },
        { name: "plugin.mjs", content: Buffer.from(`export const version = ${JSON.stringify(pluginVersion)}; export default async () => ({ event: async () => {} });\n`) },
        { name: "agents.example.toml", content: Buffer.from(agentsContent) },
        { name: "catalog.toml", content: Buffer.from(artifactCatalog) },
      ]);
      fs.writeFileSync(artifactPath, content);
      return stageRemoteTargetSources({
        cliVersion: "0.1.0",
        catalogVersion: "2026.07.05.1",
        minimumCliVersion: "0.1.0",
        minimumPluginVersion: "0.1.0",
        publishedAt: "2026-07-12T00:00:00.000Z",
        opencode: {
          url: `file://${artifactPath}`,
          sha256: sha256(content),
          size: content.length,
          version,
          compatibility: { minimumCliVersion: "0.1.0", maximumCliVersion: "0.1.0" },
          requiredFiles: ["package.json", "plugin.mjs", "agents.example.toml", "catalog.toml"],
        },
      } as never, ["opencode"], environment);
    };

    try {
      fs.writeFileSync(customPluginPath, "export default {};\n", "utf-8");
      fs.writeFileSync(nativeConfigPath, JSON.stringify({ plugin: [`file://${customPluginPath}`] }), "utf-8");

      const firstStage = await stageArtifact("0.1.1", "first");
      try {
        executeLifecycle(["opencode"], "install", projectDirectory, firstStage.env, { scope: "project" });
      } finally {
        firstStage.cleanup();
      }
      expect(fs.readFileSync(managedEntryPath, "utf-8")).toContain('"./plugin.mjs"');
      expect(fs.readFileSync(managedEntryPath, "utf-8")).not.toContain("agents-target-release-");
      expect((await import(`${pathToFileURL(managedPluginPath).href}?version=first`)).version).toBe("first");

      const secondStage = await stageArtifact("0.1.2", "second");
      let updateBackupId: string | undefined;
      try {
        updateBackupId = executeLifecycle(["opencode"], "update", projectDirectory, secondStage.env, { scope: "project" })[0]?.backupId;
      } finally {
        secondStage.cleanup();
      }
      expect(updateBackupId).toBeDefined();
      expect((await import(`${pathToFileURL(managedPluginPath).href}?version=second`)).version).toBe("second");

      const restoreOutput = collectOutput();
      expect(await runCli(["restore", "--target", "opencode", "--opencode-scope", "project", "--backup", updateBackupId ?? ""], {
        cwd: projectDirectory,
        env: environment,
        stdout: restoreOutput.stdout,
        stderr: restoreOutput.stderr,
      }), restoreOutput.err.join("\n")).toBe(0);
      expect((await import(`${pathToFileURL(managedPluginPath).href}?version=restored`)).version).toBe("first");

      const failingStage = await stageArtifact("0.1.3", "broken", "");
      try {
        expect(() => executeLifecycle(["opencode"], "update", projectDirectory, failingStage.env, { scope: "project" })).toThrow();
      } finally {
        failingStage.cleanup();
      }
      expect((await import(`${pathToFileURL(managedPluginPath).href}?version=recovered`)).version).toBe("first");

      const userManagedPluginPath = path.join(path.dirname(managedPluginPath), "custom.mjs");
      fs.writeFileSync(userManagedPluginPath, "export default {};\n", "utf-8");
      executeLifecycle(["opencode"], "uninstall", projectDirectory, environment, { scope: "project" });
      expect(fs.existsSync(managedEntryPath)).toBe(false);
      expect(fs.existsSync(managedPluginPath)).toBe(false);
      expect(fs.existsSync(userManagedPluginPath)).toBe(true);
      expect(fs.readFileSync(nativeConfigPath, "utf-8")).toContain(`file://${customPluginPath}`);
    } finally {
      fs.rmSync(projectDirectory, { recursive: true, force: true });
      fs.rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });
});

function writeOpencodeJson(dir: string, config: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(dir, "opencode.json"),
    JSON.stringify(config, null, 2),
    "utf-8",
  );
}

function collectOutput(): {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
  };
}

function writeOctalHeaderValue(
  header: Buffer,
  offset: number,
  length: number,
  value: number,
): void {
  const text = value.toString(8).padStart(length - 1, "0");
  header.write(text.slice(0, length - 1), offset, length - 1, "ascii");
  header[offset + length - 1] = 0;
}

function createTarGz(
  entries: Array<{ name: string; content: Buffer; mode?: number }>,
): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(
      entry.name,
      0,
      Math.min(Buffer.byteLength(entry.name), 100),
      "utf-8",
    );
    writeOctalHeaderValue(header, 100, 8, entry.mode ?? 0o644);
    writeOctalHeaderValue(header, 108, 8, 0);
    writeOctalHeaderValue(header, 116, 8, 0);
    writeOctalHeaderValue(header, 124, 12, entry.content.length);
    writeOctalHeaderValue(header, 136, 12, Math.floor(Date.now() / 1000));
    header.fill(0x20, 148, 156);
    header.write("0", 156, 1, "ascii");
    header.write("ustar", 257, 5, "ascii");
    header.write("00", 263, 2, "ascii");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    const checksumText = checksum.toString(8).padStart(6, "0");
    header.write(checksumText, 148, 6, "ascii");
    header[154] = 0;
    header[155] = 0x20;
    chunks.push(header, entry.content);
    const paddingLength = (512 - (entry.content.length % 512)) % 512;
    if (paddingLength > 0) {
      chunks.push(Buffer.alloc(paddingLength));
    }
  }
  chunks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(chunks));
}

function listTarGzEntries(archive: Buffer): string[] {
  const tarContent = zlib.gunzipSync(archive);
  const names: string[] = [];
  let offset = 0;
  while (offset + 512 <= tarContent.length) {
    const header = tarContent.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const rawName = header.subarray(0, 100).toString("utf-8");
    const name = rawName.replace(/\0.*$/, "");
    const sizeText = header
      .subarray(124, 136)
      .toString("ascii")
      .replace(/\0.*$/, "")
      .trim();
    const size = Number.parseInt(sizeText || "0", 8);
    names.push(name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

function writeLatestManifest(
  latestPath: string,
  manifest: {
    cliVersion: string;
    catalogVersion: string;
    catalog: { url: string; sha256: string };
    codexAgents?: { url: string; sha256: string };
    cli: { url: string; sha256: string };
  },
): void {
  fs.writeFileSync(
    latestPath,
    JSON.stringify(
      {
        minimumCliVersion: "0.1.0",
        minimumPluginVersion: "0.1.0",
        publishedAt: "2026-07-05T00:00:00.000Z",
        ...manifest,
      },
      null,
      2,
    ),
    "utf-8",
  );
}

function readCliPackage(version: string): Buffer {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8"),
  ) as Record<string, unknown>;
  packageJson.version = version;
  return Buffer.from(JSON.stringify(packageJson, null, 2) + "\n");
}

const stubInput = {
  client: {} as never,
  project: {} as never,
  directory: ".",
  worktree: ".",
  experimental_workspace: { register: () => {} },
  serverUrl: new URL("http://localhost"),
  $: {} as never,
};

describe("release fixture 빌드", () => {
  test("cli artifact에 bin/agents 포함", () => {
    const fixtureDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "agents-fixture-build-"),
    );
    const cliArtifactPath = path.join(fixtureDir, "agents-0.1.0.tgz");
    fs.writeFileSync(
      cliArtifactPath,
      createTarGz([
        {
          name: "package.json",
          content: fs.readFileSync(path.join(process.cwd(), "package.json")),
        },
        {
          name: "bin/agents",
          content: fs.readFileSync(path.join(process.cwd(), "bin", "agents")),
          mode: 0o755,
        },
        {
          name: "src/cli.ts",
          content: fs.readFileSync(path.join(process.cwd(), "src", "cli.ts")),
        },
      ]),
    );
    expect(listTarGzEntries(fs.readFileSync(cliArtifactPath))).toContain(
      "bin/agents",
    );
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });
});

describe("update + managed catalog", () => {
  let projectDir: string;
  let fixtureDir: string;
  let latestPath: string;
  let catalogArtifactPath: string;
  let io: ReturnType<typeof collectOutput>;
  const releaseEnv = () => ({
    ...cliEnv,
    AGENTS_RELEASE_URL: `file://${latestPath}`,
  });

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-upd-"));
    writeOpencodeJson(projectDir, {
      mcp: {
        "codemap-search": {
          type: "local",
          command: ["codemap-search", "mcp"],
          enabled: true,
        },
      },
    });
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-fixture-upd-"));
    catalogArtifactPath = path.join(fixtureDir, "catalog.toml");
    latestPath = path.join(fixtureDir, "latest.json");
    io = collectOutput();
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("install → update: catalog checksum 검증 성공 + managed state 저장", async () => {
    await runCli(["install", "--scope", "project"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });

    const bundled = fs.readFileSync(
      path.join(
        process.cwd(),
        "..",
        "..",
        "packages",
        "opencode",
        "src",
        "core",
        "catalog",
        "catalog.toml",
      ),
      "utf-8",
    );
    const managedContent = `${bundled.replace('catalogVersion = "2026.07.05.1"', 'catalogVersion = "2026.07.05.2"')}
[[models]]
id = "ollama-cloud/release-only-model"
name = "Release Only Model"
status = "active"
reasoning_efforts = ["high"]
tool_call = true
temperature = true
input_modalities = ["text"]
output_modalities = ["text"]
`;
    fs.writeFileSync(catalogArtifactPath, managedContent, "utf-8");
    const catalogChecksum = sha256(fs.readFileSync(catalogArtifactPath));
    writeLatestManifest(latestPath, {
      cliVersion: "0.1.1",
      catalogVersion: "2026.07.05.2",
      catalog: {
        url: `file://${catalogArtifactPath}`,
        sha256: catalogChecksum,
      },
      cli: { url: "file:///dev/null", sha256: "0".repeat(64) },
    });

    const updateExit = await runCli(["update"], {
      cwd: projectDir,
      env: releaseEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(updateExit).toBe(0);
    expect(
      fs.existsSync(
        path.join(projectDir, ".opencode", "agents", "catalog.toml"),
      ),
    ).toBe(true);
  });

  test("update 후 validate: managed catalog 새 model id 허용 + upgrade 알림", async () => {
    await runCli(["install", "--scope", "project"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });

    const bundled = fs.readFileSync(
      path.join(
        process.cwd(),
        "..",
        "..",
        "packages",
        "opencode",
        "src",
        "core",
        "catalog",
        "catalog.toml",
      ),
      "utf-8",
    );
    const managedContent = `${bundled.replace('catalogVersion = "2026.07.05.1"', 'catalogVersion = "2026.07.05.2"')}
[[models]]
id = "ollama-cloud/release-only-model"
name = "Release Only Model"
status = "active"
reasoning_efforts = ["high"]
tool_call = true
temperature = true
input_modalities = ["text"]
output_modalities = ["text"]
`;
    fs.writeFileSync(catalogArtifactPath, managedContent, "utf-8");
    const catalogChecksum = sha256(fs.readFileSync(catalogArtifactPath));

    const cliArtifactPath = path.join(fixtureDir, "agents-0.1.1.tgz");
    fs.writeFileSync(
      cliArtifactPath,
      createTarGz([
        {
          name: "package.json",
          content: fs.readFileSync(path.join(process.cwd(), "package.json")),
        },
        {
          name: "bin/agents",
          content: fs.readFileSync(path.join(process.cwd(), "bin", "agents")),
          mode: 0o755,
        },
        {
          name: "src/cli.ts",
          content: fs.readFileSync(path.join(process.cwd(), "src", "cli.ts")),
        },
      ]),
    );
    const cliArtifactChecksum = sha256(fs.readFileSync(cliArtifactPath));

    writeLatestManifest(latestPath, {
      cliVersion: "0.1.1",
      catalogVersion: "2026.07.05.2",
      catalog: {
        url: `file://${catalogArtifactPath}`,
        sha256: catalogChecksum,
      },
      cli: { url: `file://${cliArtifactPath}`, sha256: cliArtifactChecksum },
    });

    await runCli(["update"], {
      cwd: projectDir,
      env: releaseEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    fs.writeFileSync(
      path.join(projectDir, ".opencode", "agents.toml"),
      [
        "[agents.worker]",
        'model = "ollama-cloud/release-only-model"',
        'reasoning_effort = "high"',
      ].join("\n"),
      "utf-8",
    );

    const noticeOut: string[] = [];
    const noticeErr: string[] = [];
    const validateExit = await runCli(["validate"], {
      cwd: projectDir,
      env: releaseEnv(),
      stdout: (l) => noticeOut.push(l),
      stderr: (l) => noticeErr.push(l),
    });
    expect(validateExit).toBe(0);
    expect(
      noticeErr.some((l) =>
        l.includes("upgrade-available: agents 0.1.0 -> 0.1.1"),
      ),
    ).toBe(true);
  });

  test("runtime: managed catalog 새 model id provider 주입 + reasoning_effort 적용", async () => {
    await runCli(["install", "--scope", "project"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });

    const bundled = fs.readFileSync(
      path.join(
        process.cwd(),
        "..",
        "..",
        "packages",
        "opencode",
        "src",
        "core",
        "catalog",
        "catalog.toml",
      ),
      "utf-8",
    );
    const managedContent = `${bundled.replace('catalogVersion = "2026.07.05.1"', 'catalogVersion = "2026.07.05.2"')}
[[models]]
id = "ollama-cloud/release-only-model"
name = "Release Only Model"
status = "active"
reasoning_efforts = ["high"]
tool_call = true
temperature = true
input_modalities = ["text"]
output_modalities = ["text"]
`;
    fs.writeFileSync(catalogArtifactPath, managedContent, "utf-8");
    const catalogChecksum = sha256(fs.readFileSync(catalogArtifactPath));

    const cliArtifactPath = path.join(fixtureDir, "agents-0.1.1.tgz");
    fs.writeFileSync(
      cliArtifactPath,
      createTarGz([
        {
          name: "package.json",
          content: fs.readFileSync(path.join(process.cwd(), "package.json")),
        },
        {
          name: "bin/agents",
          content: fs.readFileSync(path.join(process.cwd(), "bin", "agents")),
          mode: 0o755,
        },
        {
          name: "src/cli.ts",
          content: fs.readFileSync(path.join(process.cwd(), "src", "cli.ts")),
        },
      ]),
    );
    const cliArtifactChecksum = sha256(fs.readFileSync(cliArtifactPath));

    writeLatestManifest(latestPath, {
      cliVersion: "0.1.1",
      catalogVersion: "2026.07.05.2",
      catalog: {
        url: `file://${catalogArtifactPath}`,
        sha256: catalogChecksum,
      },
      cli: { url: `file://${cliArtifactPath}`, sha256: cliArtifactChecksum },
    });

    await runCli(["update"], {
      cwd: projectDir,
      env: releaseEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    fs.writeFileSync(
      path.join(projectDir, ".opencode", "agents.toml"),
      [
        "[agents.worker]",
        'model = "ollama-cloud/release-only-model"',
        'reasoning_effort = "high"',
      ].join("\n"),
      "utf-8",
    );

    const hooks = await pluginFactory(
      { ...stubInput, directory: projectDir, worktree: projectDir },
      {},
    );
    const cfg: Record<string, unknown> = {};
    await hooks.config?.(cfg as never);
    const provider = (
      cfg.provider as Record<string, Record<string, unknown>>
    )?.["ollama-cloud"];
    const models = provider?.models as Record<string, unknown> | undefined;
    expect(models?.["release-only-model"]).toBeTruthy();

    const agents = cfg.agent as
      | Record<
          string,
          { options?: { extraBody?: { reasoning_effort?: string } } }
        >
      | undefined;
    expect(agents?.["worker"]?.options?.extraBody?.reasoning_effort).toBe(
      "high",
    );
  });

  test("두 번째 update: 같은 프로세스에서 catalog 갱신 + 새 model id 허용", async () => {
    await runCli(["install", "--scope", "project"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });

    const bundled = fs.readFileSync(
      path.join(
        process.cwd(),
        "..",
        "..",
        "packages",
        "opencode",
        "src",
        "core",
        "catalog",
        "catalog.toml",
      ),
      "utf-8",
    );
    const v2Content = `${bundled.replace('catalogVersion = "2026.07.05.1"', 'catalogVersion = "2026.07.05.2"')}
[[models]]
id = "ollama-cloud/release-only-model"
name = "Release Only Model"
status = "active"
reasoning_efforts = ["high"]
tool_call = true
temperature = true
input_modalities = ["text"]
output_modalities = ["text"]
`;
    const v3Content = v2Content
      .replace(
        'catalogVersion = "2026.07.05.2"',
        'catalogVersion = "2026.07.05.3"',
      )
      .replaceAll(
        "ollama-cloud/release-only-model",
        "ollama-cloud/release-only-model-v2",
      )
      .replace("Release Only Model", "Release Only Model V2");

    fs.writeFileSync(catalogArtifactPath, v2Content, "utf-8");
    const v2Checksum = sha256(fs.readFileSync(catalogArtifactPath));

    const cliArtifactPath = path.join(fixtureDir, "agents-0.1.0.tgz");
    fs.writeFileSync(
      cliArtifactPath,
      createTarGz([
        {
          name: "package.json",
          content: fs.readFileSync(path.join(process.cwd(), "package.json")),
        },
        {
          name: "bin/agents",
          content: fs.readFileSync(path.join(process.cwd(), "bin", "agents")),
          mode: 0o755,
        },
        {
          name: "src/cli.ts",
          content: fs.readFileSync(path.join(process.cwd(), "src", "cli.ts")),
        },
      ]),
    );
    const cliArtifactChecksum = sha256(fs.readFileSync(cliArtifactPath));

    writeLatestManifest(latestPath, {
      cliVersion: "0.1.0",
      catalogVersion: "2026.07.05.2",
      catalog: { url: `file://${catalogArtifactPath}`, sha256: v2Checksum },
      cli: { url: `file://${cliArtifactPath}`, sha256: cliArtifactChecksum },
    });

    await runCli(["update"], {
      cwd: projectDir,
      env: releaseEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
    });

    // 두 번째 catalog 버전으로 교체
    fs.writeFileSync(catalogArtifactPath, v3Content, "utf-8");
    const v3Checksum = sha256(fs.readFileSync(catalogArtifactPath));
    writeLatestManifest(latestPath, {
      cliVersion: "0.1.1",
      catalogVersion: "2026.07.05.3",
      catalog: { url: `file://${catalogArtifactPath}`, sha256: v3Checksum },
      cli: { url: `file://${cliArtifactPath}`, sha256: cliArtifactChecksum },
    });

    const secondUpdateExit = await runCli(["update"], {
      cwd: projectDir,
      env: releaseEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(secondUpdateExit).toBe(0);

    fs.writeFileSync(
      path.join(projectDir, ".opencode", "agents.toml"),
      [
        "[agents.worker]",
        'model = "ollama-cloud/release-only-model-v2"',
        'reasoning_effort = "high"',
      ].join("\n"),
      "utf-8",
    );
    const validateExit = await runCli(["validate"], {
      cwd: projectDir,
      env: releaseEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(validateExit).toBe(0);
  });

  test("update: Codex agent는 로컬 버전이 낮은 파일만 갱신", async () => {
    await runCli(["install", "--scope", "project"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });

    const bundled = fs.readFileSync(
      path.join(
        process.cwd(),
        "..",
        "..",
        "packages",
        "opencode",
        "src",
        "core",
        "catalog",
        "catalog.toml",
      ),
      "utf-8",
    );
    const managedContent = bundled.replace(
      'catalogVersion = "2026.07.05.1"',
      'catalogVersion = "2026.07.05.2"',
    );
    fs.writeFileSync(catalogArtifactPath, managedContent, "utf-8");
    const catalogChecksum = sha256(fs.readFileSync(catalogArtifactPath));

    const codexHome = path.join(fixtureDir, "codex-home");
    const codexAgentsDirectory = path.join(codexHome, "agents");
    fs.mkdirSync(codexAgentsDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(codexAgentsDirectory, "code-explorer.toml"),
      [
        'name = "code-explorer"',
        'description = "old local"',
      ].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(codexAgentsDirectory, "worker.toml"),
      [
        'name = "worker"',
        'description = "newer local"',
      ].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(codexAgentsDirectory, "versions.json"),
      JSON.stringify(
        {
          "code-explorer": "0.1.0",
          worker: "0.3.0",
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    const codexAgentsArtifactPath = path.join(
      fixtureDir,
      "codex-agents-0.2.0.tgz",
    );
    fs.writeFileSync(
      codexAgentsArtifactPath,
      createTarGz([
        {
          name: "code-explorer.toml",
          content: Buffer.from(
            [
              'name = "code-explorer"',
              'description = "updated remote"',
            ].join("\n"),
          ),
        },
        {
          name: "worker.toml",
          content: Buffer.from(
            [
              'name = "worker"',
              'description = "older remote"',
            ].join("\n"),
          ),
        },
        {
          name: "planner.toml",
          content: Buffer.from(
            [
              'name = "planner"',
              'description = "missing local"',
            ].join("\n"),
          ),
        },
        {
          name: "versions.json",
          content: Buffer.from(
            JSON.stringify(
              {
                "code-explorer": "0.2.0",
                planner: "0.2.0",
                worker: "0.2.0",
              },
              null,
              2,
            ) + "\n",
          ),
        },
      ]),
    );
    const codexAgentsChecksum = sha256(
      fs.readFileSync(codexAgentsArtifactPath),
    );

    writeLatestManifest(latestPath, {
      cliVersion: "0.1.1",
      catalogVersion: "2026.07.05.2",
      catalog: {
        url: `file://${catalogArtifactPath}`,
        sha256: catalogChecksum,
      },
      codexAgents: {
        url: `file://${codexAgentsArtifactPath}`,
        sha256: codexAgentsChecksum,
      },
      cli: { url: "file:///dev/null", sha256: "0".repeat(64) },
    });

    const updateExit = await runCli(["update"], {
      cwd: projectDir,
      env: { ...releaseEnv(), CODEX_HOME: codexHome },
      stdout: io.stdout,
      stderr: io.stderr,
    });

    expect(updateExit).toBe(0);
    expect(
      fs.readFileSync(
        path.join(codexAgentsDirectory, "code-explorer.toml"),
        "utf-8",
      ),
    ).toContain('description = "updated remote"');
    expect(
      fs.readFileSync(path.join(codexAgentsDirectory, "worker.toml"), "utf-8"),
    ).toContain('description = "newer local"');
    expect(
      fs.readFileSync(path.join(codexAgentsDirectory, "planner.toml"), "utf-8"),
    ).toContain('description = "missing local"');
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(codexAgentsDirectory, "versions.json"),
          "utf-8",
        ),
      ),
    ).toEqual({
      "code-explorer": "0.2.0",
      planner: "0.2.0",
      worker: "0.3.0",
    });
    expect(io.out).toContain(`codexAgentsPath=${codexAgentsDirectory}`);
    expect(io.out).toContain("codexAgentsUpdated=2");
    expect(io.out).toContain("codexAgentsSkipped=1");
  });
});

describe("upgrade + checksum", () => {
  let projectDir: string;
  let fixtureDir: string;
  let latestPath: string;
  let catalogArtifactPath: string;
  let io: ReturnType<typeof collectOutput>;
  const releaseEnv = () => ({
    ...cliEnv,
    AGENTS_RELEASE_URL: `file://${latestPath}`,
  });

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-upg-"));
    writeOpencodeJson(projectDir, {
      mcp: {
        "codemap-search": {
          type: "local",
          command: ["codemap-search", "mcp"],
          enabled: true,
        },
      },
    });
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-fixture-upg-"));
    catalogArtifactPath = path.join(fixtureDir, "catalog.toml");
    latestPath = path.join(fixtureDir, "latest.json");
    io = collectOutput();
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("upgrade: checksum 검증 후 artifact 적용", async () => {
    await runCli(["install", "--scope", "project"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });

    const bundled = fs.readFileSync(
      path.join(
        process.cwd(),
        "..",
        "..",
        "packages",
        "opencode",
        "src",
        "core",
        "catalog",
        "catalog.toml",
      ),
      "utf-8",
    );
    const catalogContent = bundled.replace(
      'catalogVersion = "2026.07.05.1"',
      'catalogVersion = "2026.07.05.2"',
    );
    fs.writeFileSync(catalogArtifactPath, catalogContent, "utf-8");
    const catalogChecksum = sha256(fs.readFileSync(catalogArtifactPath));

    const cliArtifactPath = path.join(fixtureDir, "agents-0.1.1.tgz");
    fs.writeFileSync(
      cliArtifactPath,
      createTarGz([
        {
          name: "package.json",
          content: fs.readFileSync(path.join(process.cwd(), "package.json")),
        },
        {
          name: "bin/agents",
          content: fs.readFileSync(path.join(process.cwd(), "bin", "agents")),
          mode: 0o755,
        },
        {
          name: "src/cli.ts",
          content: fs.readFileSync(path.join(process.cwd(), "src", "cli.ts")),
        },
      ]),
    );
    const cliArtifactChecksum = sha256(fs.readFileSync(cliArtifactPath));

    writeLatestManifest(latestPath, {
      cliVersion: "0.1.0",
      catalogVersion: "2026.07.05.2",
      catalog: {
        url: `file://${catalogArtifactPath}`,
        sha256: catalogChecksum,
      },
      cli: { url: `file://${cliArtifactPath}`, sha256: cliArtifactChecksum },
    });

    const upgradeExit = await runCli(["upgrade"], {
      cwd: projectDir,
      env: releaseEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(upgradeExit).toBe(0);
    expect(io.out).toContain("upgrade artifact applied.");
    expect(io.out).toContain(`packagePath=${process.cwd()}`);
  });

  test("upgrade: state 기록 실패 시 적용한 CLI 파일 복구", async () => {
    await runCli(["install", "--scope", "project"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });

    const packageCliPath = path.join(process.cwd(), "src", "cli.ts");
    const originalCliContent = fs.readFileSync(packageCliPath);
    const originalCliMode = fs.statSync(packageCliPath).mode & 0o777;
    const managedStatePath = path.join(
      projectDir,
      ".opencode",
      "agents.state.json",
    );
    const opencodeDirectory = path.dirname(managedStatePath);
    const originalOpencodeDirectoryMode =
      fs.statSync(opencodeDirectory).mode & 0o777;
    const originalManagedStateContent = fs.existsSync(managedStatePath)
      ? fs.readFileSync(managedStatePath)
      : null;

    const bundled = fs.readFileSync(
      path.join(
        process.cwd(),
        "..",
        "..",
        "packages",
        "opencode",
        "src",
        "core",
        "catalog",
        "catalog.toml",
      ),
      "utf-8",
    );
    const catalogContent = bundled.replace(
      'catalogVersion = "2026.07.05.1"',
      'catalogVersion = "2026.07.05.2"',
    );
    fs.writeFileSync(catalogArtifactPath, catalogContent, "utf-8");
    const catalogChecksum = sha256(fs.readFileSync(catalogArtifactPath));

    const cliArtifactPath = path.join(fixtureDir, "agents-0.1.1.tgz");
    fs.writeFileSync(
      cliArtifactPath,
      createTarGz([
        {
          name: "package.json",
          content: fs.readFileSync(path.join(process.cwd(), "package.json")),
        },
        {
          name: "bin/agents",
          content: fs.readFileSync(path.join(process.cwd(), "bin", "agents")),
          mode: 0o755,
        },
        {
          name: "src/cli.ts",
          content: Buffer.concat([
            originalCliContent,
            Buffer.from("\n// rollback probe\n"),
          ]),
        },
      ]),
    );
    const cliArtifactChecksum = sha256(fs.readFileSync(cliArtifactPath));

    writeLatestManifest(latestPath, {
      cliVersion: "0.1.0",
      catalogVersion: "2026.07.05.2",
      catalog: {
        url: `file://${catalogArtifactPath}`,
        sha256: catalogChecksum,
      },
      cli: { url: `file://${cliArtifactPath}`, sha256: cliArtifactChecksum },
    });

    try {
      fs.chmodSync(opencodeDirectory, 0o555);
      const upgradeExit = await runCli(["upgrade"], {
        cwd: projectDir,
        env: releaseEnv(),
        stdout: io.stdout,
        stderr: io.stderr,
      });
      expect(upgradeExit).not.toBe(0);
      expect(io.err.some((line) => line.includes("internal-error:"))).toBe(
        true,
      );
      expect(fs.readFileSync(packageCliPath)).toEqual(originalCliContent);
      expect(fs.statSync(packageCliPath).mode & 0o777).toBe(originalCliMode);
      if (originalManagedStateContent) {
        expect(fs.readFileSync(managedStatePath)).toEqual(
          originalManagedStateContent,
        );
      } else {
        expect(fs.existsSync(managedStatePath)).toBe(false);
      }
    } finally {
      fs.chmodSync(opencodeDirectory, originalOpencodeDirectoryMode);
      fs.writeFileSync(packageCliPath, originalCliContent);
      fs.chmodSync(packageCliPath, originalCliMode);
      if (originalManagedStateContent) {
        fs.writeFileSync(managedStatePath, originalManagedStateContent);
      } else {
        fs.rmSync(managedStatePath, { force: true });
      }
    }
  });

  test("update: catalog checksum mismatch → 거부", async () => {
    await runCli(["install", "--scope", "project"], {
      cwd: projectDir,
      env: cliEnv,
      stdout: io.stdout,
      stderr: io.stderr,
    });

    const bundled = fs.readFileSync(
      path.join(
        process.cwd(),
        "..",
        "..",
        "packages",
        "opencode",
        "src",
        "core",
        "catalog",
        "catalog.toml",
      ),
      "utf-8",
    );
    fs.writeFileSync(catalogArtifactPath, bundled, "utf-8");

    const cliArtifactPath = path.join(fixtureDir, "agents-0.1.1.tgz");
    fs.writeFileSync(
      cliArtifactPath,
      createTarGz([
        {
          name: "package.json",
          content: readCliPackage("0.1.1"),
        },
        {
          name: "bin/agents",
          content: fs.readFileSync(path.join(process.cwd(), "bin", "agents")),
          mode: 0o755,
        },
        {
          name: "src/cli.ts",
          content: fs.readFileSync(path.join(process.cwd(), "src", "cli.ts")),
        },
      ]),
    );
    const cliArtifactChecksum = sha256(fs.readFileSync(cliArtifactPath));

    writeLatestManifest(latestPath, {
      cliVersion: "0.1.1",
      catalogVersion: "2026.07.05.2",
      catalog: { url: `file://${catalogArtifactPath}`, sha256: "0".repeat(64) },
      cli: { url: `file://${cliArtifactPath}`, sha256: cliArtifactChecksum },
    });

    const exit = await runCli(["update"], {
      cwd: projectDir,
      env: releaseEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(exit).not.toBe(0);
  });

  test("upgrade: 빈 배포 묶음과 실제 버전 불일치를 성공으로 기록하지 않는다", async () => {
    const emptyArtifactPath = path.join(fixtureDir, "empty.tgz");
    fs.writeFileSync(
      emptyArtifactPath,
      createTarGz([{ name: "README.md", content: Buffer.from("empty") }]),
    );
    const emptyChecksum = sha256(fs.readFileSync(emptyArtifactPath));
    writeLatestManifest(latestPath, {
      cliVersion: "0.1.1",
      catalogVersion: "2026.07.05.2",
      catalog: { url: `file://${catalogArtifactPath}`, sha256: "0".repeat(64) },
      cli: { url: `file://${emptyArtifactPath}`, sha256: emptyChecksum },
    });
    const emptyExit = await runCli(["upgrade"], {
      cwd: projectDir,
      env: releaseEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(emptyExit).not.toBe(0);

    const mismatchArtifactPath = path.join(fixtureDir, "mismatch.tgz");
    fs.writeFileSync(
      mismatchArtifactPath,
      createTarGz([
        { name: "package.json", content: readCliPackage("0.0.9") },
        { name: "bin/agents", content: fs.readFileSync(path.join(process.cwd(), "bin", "agents")), mode: 0o755 },
        { name: "src/cli.ts", content: fs.readFileSync(path.join(process.cwd(), "src", "cli.ts")) },
      ]),
    );
    const mismatchChecksum = sha256(fs.readFileSync(mismatchArtifactPath));
    writeLatestManifest(latestPath, {
      cliVersion: "0.1.1",
      catalogVersion: "2026.07.05.2",
      catalog: { url: `file://${catalogArtifactPath}`, sha256: "0".repeat(64) },
      cli: { url: `file://${mismatchArtifactPath}`, sha256: mismatchChecksum },
    });
    const mismatchExit = await runCli(["upgrade"], {
      cwd: projectDir,
      env: releaseEnv(),
      stdout: io.stdout,
      stderr: io.stderr,
    });
    expect(mismatchExit).not.toBe(0);
    expect(io.err.some((line) => line.includes("실제 버전"))).toBe(true);
  });
});
