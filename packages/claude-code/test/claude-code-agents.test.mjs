import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentsDirectory = path.join(packageRoot, "agents");
const skillPath = path.join(
  packageRoot,
  "skills",
  "claude-code-orchestrator",
  "SKILL.md",
);
const expectedAgents = [
  "adversarial-review",
  "code-explorer",
  "constructive-feedback",
  "idea-generator",
  "intent-checker",
  "planner",
  "research",
  "worker",
];

function readFrontmatter(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  assert.equal(lines[0], "---", `${filePath} must start with frontmatter`);
  const end = lines.indexOf("---", 1);
  assert.ok(end > 1, `${filePath} must close frontmatter`);
  const fields = Object.fromEntries(
    lines.slice(1, end).map((line) => {
      const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*?)\s*$/.exec(line);
      assert.ok(match, `${filePath} contains unsupported frontmatter: ${line}`);
      return [match[1], match[2]];
    }),
  );
  return { fields, body: lines.slice(end + 1).join("\n") };
}

test("Claude Code leaf definitions preserve the eight-agent runtime contract", () => {
  const versions = JSON.parse(
    fs.readFileSync(path.join(agentsDirectory, "versions.json"), "utf8"),
  );
  assert.deepEqual(
    fs.readdirSync(agentsDirectory).filter((file) => file.endsWith(".md")).sort(),
    expectedAgents.map((name) => `${name}.md`),
  );
  assert.deepEqual(Object.keys(versions).sort(), expectedAgents);

  for (const name of expectedAgents) {
    const { fields, body } = readFrontmatter(path.join(agentsDirectory, `${name}.md`));
    assert.equal(fields.name, name);
    assert.ok(fields.description?.length > 0);
    assert.ok(fields.permissionMode?.length > 0);
    assert.equal(fields.model, undefined, `${name} must inherit the caller model`);
    assert.match(versions[name], /^0\.1\.2$/);
    if (name === "intent-checker") {
      assert.ok(fields.tools?.length > 0);
      assert.equal(fields.tools.includes("Agent"), false, `${name} must not redelegate`);
      assert.equal(fields.disallowedTools, undefined);
      assert.match(body, /Return exactly one line/);
      assert.match(body, /Do not write artifacts, edit files, redelegate/);
    } else {
      assert.equal(fields.tools, undefined, `${name} must inherit personal MCP tools`);
      assert.ok(fields.disallowedTools?.split(/,\s*/).includes("Agent"), `${name} must not redelegate`);
      assert.equal(fields.disallowedTools?.split(/,\s*/).includes("Skill"), false, `${name} must inherit personal skills`);
      assert.equal(fields.disallowedTools.includes("mcp__"), false, `${name} must not block personal MCP tools`);
      assert.match(body, /Validate the received `taskId`, unique `workItemId`, and exact Output/);
      assert.match(body, /Inputs and historical Outputs are read-only/);
      assert.match(body, /`task\.md` is coordinator-owned/);
      assert.match(body, /Return exactly:/);
    }
  }
});

test("intent gate and role-specific terminal contracts are explicit", () => {
  const intent = fs.readFileSync(path.join(agentsDirectory, "intent-checker.md"), "utf8");
  for (const marker of [
    "Original user request",
    "Normalized objective",
    "CONFIRMATION_NEEDED",
    "Return exactly one line",
    "Do not write artifacts, edit files, redelegate",
  ]) assert.ok(intent.includes(marker), marker);

  const planner = fs.readFileSync(path.join(agentsDirectory, "planner.md"), "utf8");
  assert.ok(planner.includes("caller-to-intermediate-to-final-consumer propagation"));
  assert.ok(planner.includes("Completion Contract"));

  const worker = fs.readFileSync(path.join(agentsDirectory, "worker.md"), "utf8");
  assert.ok(worker.includes("existing cancellation signals"));
  assert.ok(worker.includes("verification-state=<passed|failed|blocked>"));

  for (const name of ["adversarial-review", "constructive-feedback"]) {
    const body = fs.readFileSync(path.join(agentsDirectory, `${name}.md`), "utf8");
    assert.ok(body.includes("review-state=<clear|findings|needs-user-decision>"));
  }
});

test("orchestrator uses only the official Agent allowlist and equivalent flow", () => {
  const { fields, body } = readFrontmatter(skillPath);
  assert.equal(fields["disable-model-invocation"], "true");
  assert.equal(fields.context, undefined);
  assert.equal(fields.agent, undefined);
  assert.equal(fields.model, undefined);
  const allowedAgents = [...fields["allowed-tools"].matchAll(/Agent\(([^)]+)\)/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(allowedAgents, expectedAgents);
  assert.equal(body.includes("Task("), false);

  for (const marker of [
    "/claude-code-orchestrator",
    "official `Agent` tool",
    "intent-checker` first",
    "planner` before `worker",
    "plan-finalized",
    "self-verify",
    "adversarial-review",
    "constructive-feedback",
    "at most three progress-producing remediation rounds",
    "taskId",
    "workItemId",
    "Input:",
    "Output:",
    "Paths-only handoff",
  ]) assert.ok(body.includes(marker), marker);
});

test("package exposes dependency-free static and opt-in execution checks", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  assert.equal(packageJson.version, "0.1.2");
  assert.equal(packageJson.scripts.test, "node --test test/*.test.mjs");
  assert.equal(packageJson.scripts["test:exec-smoke"], "node test/exec-smoke.mjs");
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.devDependencies, undefined);
});
