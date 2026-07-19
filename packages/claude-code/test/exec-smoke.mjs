import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryWorkingDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "claude-code-orchestrator-smoke-"),
);
const temporaryProjectConfigDirectory = path.join(
  temporaryWorkingDirectory,
  ".claude",
);

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(sourcePath, destinationPath);
    else fs.copyFileSync(sourcePath, destinationPath);
  }
}

function collectValues(value, predicate, found = []) {
  if (predicate(value)) found.push(value);
  if (Array.isArray(value)) value.forEach((item) => collectValues(item, predicate, found));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectValues(item, predicate, found));
  return found;
}

try {
  copyDirectory(path.join(packageRoot, "agents"), path.join(temporaryProjectConfigDirectory, "agents"));
  copyDirectory(path.join(packageRoot, "skills"), path.join(temporaryProjectConfigDirectory, "skills"));
  const command = spawnSync("claude", [
    "-p",
    "/claude-code-orchestrator Classify this exact request only: \"Explain hello in one sentence.\" Do not inspect files. Follow the skill contract and invoke intent-checker as the first action.",
    "--model",
    "haiku",
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--tools",
    "Agent",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--max-budget-usd",
    "0.10",
    "--output-format",
    "stream-json",
    "--verbose",
  ], {
    cwd: temporaryWorkingDirectory,
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_CODE_SUBAGENT_MODEL: "haiku",
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
    },
  });
  if (command.error) throw new Error(`Claude Code smoke could not start: ${command.error.message}`);
  if (command.status !== 0) {
    throw new Error(`Claude Code smoke failed (exit ${command.status}): ${(command.stderr || command.stdout).trim()}`);
  }

  const events = command.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Claude Code smoke emitted non-JSON stream output: ${line}`);
    }
  });
  const agentUses = collectValues(events, (value) => value && typeof value === "object" && value.name === "Agent");
  assert.ok(agentUses.length > 0, "the slash skill must invoke the Agent tool");
  assert.ok(JSON.stringify(agentUses).includes("intent-checker"), "the first subagent must be intent-checker");
  const modelValues = collectValues(events, (value) => typeof value === "string" && /haiku/i.test(value));
  assert.ok(modelValues.length > 0, "the observed stream must confirm Haiku");
  process.stdout.write("Claude Code Haiku intent-gate smoke passed.\n");
} finally {
  fs.rmSync(temporaryWorkingDirectory, { recursive: true, force: true });
}
