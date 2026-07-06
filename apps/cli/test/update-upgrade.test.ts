/**
 * update-upgrade.test.ts — update/upgrade CLI 명령, checksum 검증, managed catalog
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { runCli } from "@cli/cli";
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
    expect(models?.["ollama-cloud/release-only-model"]).toBeTruthy();

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
      cliVersion: "0.1.1",
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
      cliVersion: "0.1.1",
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
});
