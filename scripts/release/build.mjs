import { build } from "esbuild";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const repositoryRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const argumentsByName = new Map(process.argv.slice(2).flatMap((value, index, values) => value.startsWith("--") && value !== "--" ? [[value, values[index + 1]]] : []));
const isPublish = argumentsByName.has("--publish");
const outputDirectory = resolve(repositoryRoot, argumentsByName.get("--output") ?? "dist/release");
const rootPackage = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
const version = argumentsByName.get("--version") ?? rootPackage.version;
const releaseTag = argumentsByName.get("--tag") ?? `v${version}`;
const releaseBaseUrl = process.env.AGENTS_RELEASE_BASE_URL ?? `https://github.com/buYoung/agents/releases/download/${encodeURIComponent(releaseTag)}/`;
const maxArtifactBytes = 50 * 1024 * 1024;
const minimumCliVersion = "0.1.0";

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`올바르지 않은 배포 버전: ${version}`);
if (!releaseBaseUrl.startsWith("https://")) throw new Error("AGENTS_RELEASE_BASE_URL은 HTTPS 주소여야 합니다.");
if (!releaseBaseUrl.includes(`/releases/download/${encodeURIComponent(releaseTag)}/`)) throw new Error("artifact URL은 현재 release tag의 download 주소여야 합니다.");

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function encodeString(value, length) {
  const result = Buffer.alloc(length);
  Buffer.from(value).copy(result, 0, 0, Math.min(Buffer.byteLength(value), length));
  return result;
}

function writeOctal(header, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, "0");
  header.write(text.slice(-length + 1), offset, length - 1, "ascii");
  header[offset + length - 1] = 0;
}

function tarGz(directory, archivePath) {
  const entries = [];
  const visit = (currentDirectory) => {
    for (const entry of readDirectory(currentDirectory)) {
      const absolutePath = join(currentDirectory, entry);
      if (existsSync(absolutePath) && readFileKind(absolutePath) === "directory") visit(absolutePath);
      else if (readFileKind(absolutePath) === "file") entries.push(absolutePath);
    }
  };
  visit(directory);
  const blocks = [];
  for (const sourcePath of entries.sort()) {
    const entryName = relative(directory, sourcePath).replaceAll("\\", "/");
    if (Buffer.byteLength(entryName) > 100) throw new Error(`tar 경로가 너무 깁니다: ${entryName}`);
    const content = readFileSync(sourcePath);
    const header = Buffer.alloc(512);
    encodeString(entryName, 100).copy(header, 0);
    writeOctal(header, 100, 8, sourcePath.endsWith("agents") ? 0o755 : 0o644);
    writeOctal(header, 108, 8, 0); writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, content.length); writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
    header.fill(0x20, 148, 156); header.write("0", 156, 1); header.write("ustar", 257, 5); header.write("00", 263, 2);
    writeOctal(header, 148, 8, header.reduce((total, byte) => total + byte, 0));
    blocks.push(header, content, Buffer.alloc((512 - (content.length % 512)) % 512));
  }
  writeFileSync(archivePath, gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)])));
}

function readDirectory(directory) { return readdirSync(directory); }
function readFileKind(filePath) { return statSync(filePath).isDirectory() ? "directory" : statSync(filePath).isFile() ? "file" : "other"; }

function artifactRecord(fileName, artifactVersion, requiredFiles) {
  const content = readFileSync(join(outputDirectory, fileName));
  if (content.length === 0 || content.length > maxArtifactBytes) throw new Error(`artifact 크기가 허용 범위를 벗어났습니다: ${fileName}`);
  return { url: new URL(fileName, releaseBaseUrl).toString(), sha256: sha256(content), size: content.length, version: artifactVersion, compatibility: { minimumCliVersion, maximumCliVersion: version }, requiredFiles };
}

function canonicalManifest(manifest) {
  const { signing, ...unsigned } = manifest;
  const sortObject = (value) => {
    if (Array.isArray(value)) return value.map(sortObject);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
    return value;
  };
  return Buffer.from(JSON.stringify(sortObject(unsigned)));
}

function readPublicKey() {
  const encoded = process.env.AGENTS_RELEASE_PUBLIC_KEY_BASE64;
  return encoded ? Buffer.from(encoded, "base64").toString("utf8") : null;
}

function signManifest(manifest, publicKey) {
  const privateKey = process.env.AGENTS_RELEASE_SIGNING_KEY;
  if (!privateKey || !publicKey) {
    if (isPublish) throw new Error("게시 배포에는 AGENTS_RELEASE_SIGNING_KEY secret과 AGENTS_RELEASE_PUBLIC_KEY_BASE64 GitHub variable이 필요합니다.");
    return manifest;
  }
  const key = createPrivateKey(privateKey.includes("BEGIN") ? privateKey : Buffer.from(privateKey, "base64"));
  const derivedPublicKey = createPublicKey(key).export({ type: "spki", format: "pem" }).toString();
  if (derivedPublicKey.trim() !== publicKey.trim()) throw new Error("공개키가 AGENTS_RELEASE_SIGNING_KEY와 일치하지 않습니다.");
  return { ...manifest, signing: { algorithm: "ed25519", keyId: sha256(publicKey).slice(0, 16), signature: sign(null, canonicalManifest(manifest), key).toString("base64") } };
}

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });
const cliDirectory = join(outputDirectory, "cli");
const resourceDirectory = join(cliDirectory, "resources");
mkdirSync(join(cliDirectory, "bin"), { recursive: true });
mkdirSync(join(cliDirectory, "dist"), { recursive: true });

await build({ entryPoints: [join(repositoryRoot, "apps", "cli", "src", "entry.ts")], bundle: true, platform: "node", format: "esm", target: "node18", outfile: join(cliDirectory, "dist", "cli.mjs") });
writeFileSync(join(cliDirectory, "bin", "agents"), "#!/usr/bin/env node\nimport { runCliFromProcess } from '../dist/cli.mjs';\nrunCliFromProcess();\n", "utf8");
chmodSync(join(cliDirectory, "bin", "agents"), 0o755);
writeFileSync(join(cliDirectory, "package.json"), JSON.stringify({ name: "cli", version, type: "module", bin: { agents: "./bin/agents" }, private: true }, null, 2) + "\n");
writeFileSync(join(cliDirectory, "release-metadata.json"), JSON.stringify({ cliVersion: version, pluginVersion: version }, null, 2) + "\n");

const publicKey = readPublicKey();
if (publicKey) writeFileSync(join(cliDirectory, "release-public-key.pem"), publicKey.trim() + "\n");
mkdirSync(join(resourceDirectory, "opencode"), { recursive: true });
await build({ entryPoints: [join(repositoryRoot, "packages", "opencode", "src", "index.ts")], bundle: true, platform: "node", format: "esm", target: "node18", outfile: join(resourceDirectory, "opencode", "plugin.mjs") });
cpSync(join(repositoryRoot, "packages", "opencode", "agents.example.toml"), join(resourceDirectory, "opencode", "agents.example.toml"));
cpSync(join(repositoryRoot, "packages", "opencode", "src", "core", "catalog", "catalog.toml"), join(resourceDirectory, "opencode", "catalog.toml"));
cpSync(join(resourceDirectory, "opencode", "catalog.toml"), join(cliDirectory, "dist", "catalog.toml"));
writeFileSync(join(resourceDirectory, "opencode", "package.json"), JSON.stringify({ name: "opencode", version }, null, 2) + "\n");
cpSync(join(repositoryRoot, "packages", "codex", "agents"), join(resourceDirectory, "codex", "agents"), { recursive: true });
cpSync(join(repositoryRoot, "packages", "codex", "skills", "codex-orchestrator"), join(resourceDirectory, "codex", "skills", "codex-orchestrator"), { recursive: true });
writeFileSync(join(resourceDirectory, "codex", "package.json"), JSON.stringify({ name: "codex", version }, null, 2) + "\n");
cpSync(join(repositoryRoot, "packages", "claude-code", "agents"), join(resourceDirectory, "claude-code", "agents"), { recursive: true });
cpSync(join(repositoryRoot, "packages", "claude-code", "skills", "claude-code-orchestrator"), join(resourceDirectory, "claude-code", "skills", "claude-code-orchestrator"), { recursive: true });
const claudeCodePackage = JSON.parse(readFileSync(join(repositoryRoot, "packages", "claude-code", "package.json"), "utf8"));
writeFileSync(join(resourceDirectory, "claude-code", "package.json"), JSON.stringify({ name: "claude-code", version: claudeCodePackage.version }, null, 2) + "\n");

tarGz(cliDirectory, join(outputDirectory, `agents-cli-${version}.tar.gz`));
const npmCliDirectory = join(outputDirectory, "npm-cli");
cpSync(cliDirectory, npmCliDirectory, { recursive: true });
writeFileSync(join(npmCliDirectory, "package.json"), JSON.stringify({
  name: "@livteam/agents-cli",
  version,
  description: "Install and manage Codex and Claude Code agents and the OpenCode agents plugin.",
  type: "module",
  bin: { agents: "bin/agents" },
  engines: { node: ">=18" },
  keywords: ["codex", "claude-code", "opencode", "agents", "cli", "plugin", "ai-agents"],
  repository: { type: "git", url: "git+https://github.com/buYoung/agents.git" },
  homepage: "https://github.com/buYoung/agents#readme",
  bugs: { url: "https://github.com/buYoung/agents/issues" },
  publishConfig: { access: "public", registry: "https://registry.npmjs.org" },
}, null, 2) + "\n");
cpSync(join(repositoryRoot, "README.md"), join(npmCliDirectory, "README.md"));
tarGz(npmCliDirectory, join(outputDirectory, `livteam-agents-cli-${version}.tar.gz`));
rmSync(npmCliDirectory, { recursive: true, force: true });
tarGz(join(resourceDirectory, "opencode"), join(outputDirectory, `agents-opencode-${version}.tar.gz`));
tarGz(join(resourceDirectory, "codex"), join(outputDirectory, `agents-codex-${version}.tar.gz`));
tarGz(join(resourceDirectory, "claude-code"), join(outputDirectory, `agents-claude-code-${version}.tar.gz`));
cpSync(join(resourceDirectory, "opencode", "catalog.toml"), join(outputDirectory, `catalog-${version}.toml`));
const catalogVersion = /^catalogVersion\s*=\s*"([^"]+)"/m.exec(readFileSync(join(resourceDirectory, "opencode", "catalog.toml"), "utf8"))?.[1];
if (!catalogVersion) throw new Error("catalogVersion을 찾을 수 없습니다.");
const npmManifest = {
  formatVersion: 1,
  cliVersion: version,
  npmCli: artifactRecord(`livteam-agents-cli-${version}.tar.gz`, version, ["package.json", "README.md", "bin/agents", "dist/cli.mjs", "dist/catalog.toml", "resources/opencode/plugin.mjs", "resources/codex/agents/versions.json", "resources/claude-code/agents/versions.json"]),
};
const manifest = {
  formatVersion: 2,
  cliVersion: version,
  catalogVersion,
  minimumCliVersion,
  minimumPluginVersion: "0.1.0",
  publishedAt: new Date().toISOString(),
  catalog: artifactRecord(`catalog-${version}.toml`, catalogVersion, ["catalog.toml"]),
  cli: artifactRecord(`agents-cli-${version}.tar.gz`, version, ["package.json", "bin/agents", "dist/cli.mjs", "dist/catalog.toml", "resources/opencode/plugin.mjs", "resources/codex/agents/versions.json", "resources/codex/skills/codex-orchestrator/SKILL.md", "resources/claude-code/agents/versions.json", "resources/claude-code/skills/claude-code-orchestrator/SKILL.md"]),
  opencode: artifactRecord(`agents-opencode-${version}.tar.gz`, JSON.parse(readFileSync(join(resourceDirectory, "opencode", "package.json"), "utf8")).version, ["plugin.mjs", "agents.example.toml", "catalog.toml", "package.json"]),
  claudeCodeAgents: artifactRecord(`agents-claude-code-${version}.tar.gz`, JSON.parse(readFileSync(join(resourceDirectory, "claude-code", "package.json"), "utf8")).version, ["agents/versions.json", ...["adversarial-review", "code-explorer", "constructive-feedback", "idea-generator", "intent-checker", "planner", "research", "worker"].map((name) => `agents/${name}.md`), "skills/claude-code-orchestrator/SKILL.md"]),
  codexAgents: artifactRecord(`agents-codex-${version}.tar.gz`, JSON.parse(readFileSync(join(resourceDirectory, "codex", "package.json"), "utf8")).version, ["agents/versions.json", "agents/worker.toml", "skills/codex-orchestrator/SKILL.md", "skills/codex-orchestrator/agents/openai.yaml"])
};
writeFileSync(join(outputDirectory, "latest.json"), JSON.stringify(signManifest(manifest, publicKey), null, 2) + "\n");
writeFileSync(join(outputDirectory, "npm-latest.json"), JSON.stringify(signManifest(npmManifest, publicKey), null, 2) + "\n");
console.log(outputDirectory);
