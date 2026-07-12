import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";

const argumentsByName = new Map(process.argv.slice(2).flatMap((value, index, values) => value.startsWith("--") && value !== "--" ? [[value, values[index + 1]]] : []));
const remote = argumentsByName.has("--remote");
const requiresSignature = argumentsByName.has("--require-signature");
const maxArtifactBytes = 50 * 1024 * 1024;
const maxUnpackedArtifactBytes = 200 * 1024 * 1024;
const codexAgentNames = ["adversarial-review", "code-explorer", "constructive-feedback", "idea-generator", "intent-checker", "planner", "research", "worker"];
let directory = resolve(process.cwd(), argumentsByName.get("--directory") ?? "dist/release");
let temporaryDirectory = null;

function sha256(content) { return createHash("sha256").update(content).digest("hex"); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function runInteractiveCli(executablePath, cwd, command) {
  const pseudoTerminalRunner = [
    "import errno, os, pty, sys",
    "node, executable, command = sys.argv[1:]",
    "process_id, terminal = pty.fork()",
    "if process_id == 0: os.execvp(node, [node, executable, command])",
    "os.write(terminal, b'0\\n')",
    "output = bytearray()",
    "while True:",
    "  try: chunk = os.read(terminal, 4096)",
    "  except OSError as error:",
    "    if error.errno == errno.EIO: break",
    "    raise",
    "  if not chunk: break",
    "  output.extend(chunk)",
    "_, status = os.waitpid(process_id, 0)",
    "sys.stdout.buffer.write(output)",
    "sys.exit(os.waitstatus_to_exitcode(status))",
  ].join("\n");
  return spawnSync(process.env.PYTHON ?? "python3", ["-c", pseudoTerminalRunner, process.execPath, executablePath, command], { cwd, encoding: "utf8" });
}
function isVersion(value) { return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value); }
function compareVersions(left, right) {
  const parse = (value) => { const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value); assert(match, `올바르지 않은 버전: ${value}`); return { core: match.slice(1, 4).map(Number), prerelease: match[4]?.split(".") ?? [] }; };
  const a = parse(left); const b = parse(right);
  for (let index = 0; index < 3; index += 1) if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    if (a.prerelease[index] === undefined) return -1; if (b.prerelease[index] === undefined) return 1;
    if (a.prerelease[index] === b.prerelease[index]) continue;
    const aNumber = /^\d+$/.test(a.prerelease[index]); const bNumber = /^\d+$/.test(b.prerelease[index]);
    if (aNumber && bNumber) return Number(a.prerelease[index]) > Number(b.prerelease[index]) ? 1 : -1;
    return aNumber ? -1 : bNumber ? 1 : a.prerelease[index] > b.prerelease[index] ? 1 : -1;
  }
  return 0;
}
function canonicalManifest(value) {
  const { signing, ...unsigned } = value;
  const sortObject = (input) => Array.isArray(input) ? input.map(sortObject) : input && typeof input === "object" ? Object.fromEntries(Object.keys(input).sort().map((key) => [key, sortObject(input[key])])) : input;
  return Buffer.from(JSON.stringify(sortObject(unsigned)));
}
function tarEntries(archive) {
  const content = gunzipSync(archive, { maxOutputLength: maxUnpackedArtifactBytes });
  const entries = new Map(); let offset = 0; let unpackedBytes = 0;
  while (offset + 512 <= content.length) {
    const header = content.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const entryName = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim() || "0", 8);
    const typeFlag = header.subarray(156, 157).toString("utf8") || "0";
    assert(entryName && !entryName.startsWith("/") && !entryName.includes("..") && !/^[A-Za-z]:/.test(entryName), `안전하지 않은 tar 경로: ${entryName}`);
    assert(typeFlag === "0" || typeFlag === "\0", `지원하지 않는 tar 항목 형식: ${entryName}`);
    assert(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= content.length, `손상된 tar 항목: ${entryName}`);
    unpackedBytes += size; assert(unpackedBytes <= maxUnpackedArtifactBytes, "artifact 압축 해제 크기가 허용 범위를 벗어났습니다.");
    assert(!entries.has(entryName), `중복 tar 항목: ${entryName}`);
    entries.set(entryName, content.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}
function extractEntries(entries, destination) {
  for (const [entryName, content] of entries) {
    const destinationPath = join(destination, entryName);
    const parent = resolve(destinationPath, "..");
    assert(parent === resolve(destination) || parent.startsWith(`${resolve(destination)}/`), `안전하지 않은 추출 경로: ${entryName}`);
    mkdirSync(parent, { recursive: true }); writeFileSync(destinationPath, content);
  }
}
async function download(location) {
  assert(location.startsWith("https://"), `원격 artifact는 HTTPS여야 합니다: ${location}`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(location);
    if (response.ok) {
      const length = response.headers.get("content-length");
      assert(!length || (/^\d+$/.test(length) && Number(length) <= maxArtifactBytes), `${location}의 응답 크기가 허용 범위를 벗어났습니다.`);
      assert(response.body, `${location}의 응답 본문이 없습니다.`);
      const reader = response.body.getReader(); const chunks = []; let totalBytes = 0;
      try {
        for (;;) {
          const next = await reader.read(); if (next.done) break;
          totalBytes += next.value.byteLength; assert(totalBytes <= maxArtifactBytes, `${location}의 응답 크기가 허용 범위를 벗어났습니다.`);
          chunks.push(Buffer.from(next.value));
        }
      } finally { reader.releaseLock(); }
      const content = Buffer.concat(chunks, totalBytes);
      assert(content.length > 0 && content.length <= maxArtifactBytes, `${location}의 응답 크기가 허용 범위를 벗어났습니다.`);
      return content;
    }
    if (attempt === 2) throw new Error(`${location} 응답 실패: ${response.status}`);
    await new Promise((resolveAttempt) => setTimeout(resolveAttempt, 1000));
  }
  throw new Error(`${location} 다운로드에 실패했습니다.`);
}
async function prepareRemoteDirectory() {
  const tag = argumentsByName.get("--tag"); assert(tag && /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag), "원격 검증에는 --tag vX.Y.Z가 필요합니다.");
  const base = process.env.AGENTS_RELEASE_BASE_URL ?? `https://github.com/buYoung/agents/releases/download/${encodeURIComponent(tag)}/`;
  assert(base === `https://github.com/buYoung/agents/releases/download/${encodeURIComponent(tag)}/` || base.includes(`/releases/download/${encodeURIComponent(tag)}/`), "원격 검증 주소는 현재 release tag를 가리켜야 합니다.");
  temporaryDirectory = mkdtempSync(join(tmpdir(), "agents-release-remote-")); directory = temporaryDirectory;
  const latest = await download(new URL("latest.json", base).toString()); writeFileSync(join(directory, "latest.json"), latest);
  const manifest = JSON.parse(latest.toString("utf8"));
  for (const artifact of Object.values({ catalog: manifest.catalog, cli: manifest.cli, opencode: manifest.opencode, codexAgents: manifest.codexAgents })) {
    assert(artifact && typeof artifact.url === "string", "원격 latest.json artifact가 올바르지 않습니다.");
    assert(artifact.url.includes(`/releases/download/${encodeURIComponent(tag)}/`), "원격 artifact URL이 현재 release tag를 가리키지 않습니다.");
    const fileName = new URL(artifact.url).pathname.split("/").at(-1); assert(fileName, "원격 artifact 파일 이름이 없습니다.");
    writeFileSync(join(directory, fileName), await download(artifact.url));
  }
}

try {
  if (remote) await prepareRemoteDirectory();
  const manifest = JSON.parse(readFileSync(join(directory, "latest.json"), "utf8"));
  assert(manifest.formatVersion === 2, "latest.json formatVersion은 2여야 합니다.");
  assert(isVersion(manifest.cliVersion) && isVersion(manifest.minimumCliVersion) && isVersion(manifest.minimumPluginVersion), "latest.json의 CLI/Plugin 버전이 올바르지 않습니다.");
  assert(typeof manifest.catalogVersion === "string" && manifest.catalogVersion.length > 0, "latest.json catalogVersion이 없습니다.");
  for (const [name, artifact] of Object.entries({ catalog: manifest.catalog, cli: manifest.cli, opencode: manifest.opencode, codexAgents: manifest.codexAgents })) {
    assert(artifact && typeof artifact === "object", `${name} artifact가 없습니다.`);
    assert(typeof artifact.url === "string" && typeof artifact.sha256 === "string", `${name} artifact URL 또는 SHA-256이 없습니다.`);
    assert(Number.isSafeInteger(artifact.size) && artifact.size > 0 && artifact.size <= maxArtifactBytes, `${name} artifact size 계약이 올바르지 않습니다.`);
    assert(name === "catalog" ? typeof artifact.version === "string" && artifact.version.length > 0 : isVersion(artifact.version), `${name} artifact 실제 버전이 올바르지 않습니다.`);
    assert(artifact.compatibility && isVersion(artifact.compatibility.minimumCliVersion) && isVersion(artifact.compatibility.maximumCliVersion) && compareVersions(artifact.compatibility.minimumCliVersion, artifact.compatibility.maximumCliVersion) <= 0, `${name} artifact 호환 범위가 올바르지 않습니다.`);
    assert(Array.isArray(artifact.requiredFiles) && artifact.requiredFiles.length > 0 && artifact.requiredFiles.every((file) => typeof file === "string" && file && !file.includes("..") && !file.startsWith("/")), `${name} artifact 필수 파일 목록이 안전하지 않습니다.`);
    const fileName = new URL(artifact.url).pathname.split("/").at(-1);
    assert(fileName && !fileName.includes(".."), `${name} artifact URL이 안전하지 않습니다.`);
    const artifactPath = join(directory, fileName); assert(existsSync(artifactPath), `${name} artifact 파일이 없습니다.`);
    const content = readFileSync(artifactPath); assert(content.length === artifact.size && statSync(artifactPath).size === artifact.size, `${name} artifact 크기가 배포 목록과 일치하지 않습니다.`);
    assert(sha256(content) === artifact.sha256, `${name} artifact SHA-256이 일치하지 않습니다.`);
    if (fileName.endsWith(".tar.gz")) {
      const entries = tarEntries(content);
      for (const requiredFile of artifact.requiredFiles) assert(entries.has(requiredFile), `${name} 묶음의 필수 파일이 없습니다: ${requiredFile}`);
      const extracted = mkdtempSync(join(tmpdir(), `agents-release-${name}-`));
      try {
        extractEntries(entries, extracted);
        const packageJson = JSON.parse(readFileSync(join(extracted, "package.json"), "utf8"));
        assert(packageJson.version === artifact.version, `${name} artifact package.json 버전이 배포 목록과 일치하지 않습니다.`);
        if (name === "cli") {
          assert(packageJson.name === "cli", "CLI artifact package 이름이 올바르지 않습니다.");
          const smoke = spawnSync(process.execPath, [join(extracted, "bin", "agents"), "--help"], { cwd: extracted, encoding: "utf8" });
          assert(smoke.status === 0, `CLI artifact 독립 실행 확인 실패: ${smoke.stderr || smoke.error?.message || "알 수 없는 오류"}`);
          assert(smoke.stdout.includes("사용법: agents"), "CLI artifact --help가 필수 도움말을 출력하지 않았습니다.");
          const unknownCommand = spawnSync(process.execPath, [join(extracted, "bin", "agents"), "unknown-command"], { cwd: extracted, encoding: "utf8" });
          assert(unknownCommand.status === 3 && unknownCommand.stderr.includes("알 수 없는 명령: unknown-command"), "CLI artifact가 명령 인수 또는 종료 코드를 올바르게 전달하지 않았습니다.");
          for (const command of ["install", "update"]) {
            const interactive = runInteractiveCli(join(extracted, "bin", "agents"), extracted, command);
            const output = `${interactive.stdout}${interactive.stderr}`;
            assert(interactive.status === 0 && output.includes("처리할 대상을 선택하세요."), `CLI artifact ${command} 대화형 선택 화면 확인 실패: ${interactive.error?.message || output}`);
          }
        }
        if (name === "opencode") {
          assert(packageJson.name === "opencode", "OpenCode artifact package 이름이 올바르지 않습니다.");
          await import(`${pathToFileURL(join(extracted, "plugin.mjs")).href}?verify=${Date.now()}`);
          assert(/catalogVersion\s*=\s*"([^"]+)"/.test(readFileSync(join(extracted, "catalog.toml"), "utf8")), "OpenCode catalog을 읽을 수 없습니다.");
        }
        if (name === "codexAgents") {
          assert(packageJson.name === "codex", "Codex artifact package 이름이 올바르지 않습니다.");
          const versions = JSON.parse(readFileSync(join(extracted, "agents", "versions.json"), "utf8"));
          assert(Object.keys(versions).sort().join(",") === codexAgentNames.join(","), "Codex versions.json이 8개 agent와 일치하지 않습니다.");
          for (const agentName of codexAgentNames) {
            const agent = readFileSync(join(extracted, "agents", `${agentName}.toml`), "utf8");
            assert(new RegExp(`^name\\s*=\\s*"${agentName}"`, "m").test(agent) && typeof versions[agentName] === "string", `Codex agent가 올바르지 않습니다: ${agentName}`);
          }
        }
      } finally { rmSync(extracted, { recursive: true, force: true }); }
    } else if (name === "catalog") {
      const catalogVersion = /^catalogVersion\s*=\s*"([^"]+)"/m.exec(content.toString("utf8"))?.[1];
      assert(catalogVersion === manifest.catalogVersion && catalogVersion === artifact.version, "catalog artifact 버전이 배포 목록과 일치하지 않습니다.");
    }
  }
  if (manifest.signing) {
    const encodedKey = process.env.AGENTS_RELEASE_PUBLIC_KEY_BASE64; assert(encodedKey, "서명 검증에는 AGENTS_RELEASE_PUBLIC_KEY_BASE64가 필요합니다.");
    const publicKey = Buffer.from(encodedKey, "base64").toString("utf8");
    assert(manifest.signing.algorithm === "ed25519", "지원하지 않는 manifest 서명 알고리즘입니다.");
    assert(verify(null, canonicalManifest(manifest), createPublicKey(publicKey), Buffer.from(manifest.signing.signature, "base64")), "latest.json 서명 검증에 실패했습니다.");
  } else assert(!requiresSignature, "게시 배포에는 서명된 latest.json이 필요합니다.");
  console.log(directory);
} finally {
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
}
