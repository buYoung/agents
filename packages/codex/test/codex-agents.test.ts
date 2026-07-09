/**
 * codex-agents.test.ts - Codex custom agent TOML smoke checks.
 */

import { describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "smol-toml";

const packageRoot = process.cwd();
const codexAgentsDirectory = path.join(packageRoot, "agents");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(packageRoot, "package.json"), "utf-8"),
) as { version: string };
const codexAgentVersions = JSON.parse(
  fs.readFileSync(path.join(codexAgentsDirectory, "versions.json"), "utf-8"),
) as Record<string, string>;

const expectedModelProfiles: Record<
  string,
  { model: string; effort: string; sandbox: string; promptMarker: string }
> = {
  orchestrator: {
    model: "gpt-5.5",
    effort: "xhigh",
    sandbox: "workspace-write",
    promptMarker: "## Delegation Routing Table",
  },
  "intent-checker": {
    model: "gpt-5.5",
    effort: "medium",
    sandbox: "read-only",
    promptMarker: "Return exactly one line to the orchestrator.",
  },
  worker: {
    model: "gpt-5.5",
    effort: "high",
    sandbox: "workspace-write",
    promptMarker: "You are **worker**",
  },
  planner: {
    model: "gpt-5.5",
    effort: "high",
    sandbox: "workspace-write",
    promptMarker: "You are the **planner** subagent.",
  },
  research: {
    model: "gpt-5.5",
    effort: "medium",
    sandbox: "workspace-write",
    promptMarker: "You are the **research** subagent.",
  },
  "code-explorer": {
    model: "gpt-5.4",
    effort: "low",
    sandbox: "workspace-write",
    promptMarker: "You are the **code-explorer** subagent.",
  },
  "idea-generator": {
    model: "gpt-5.5",
    effort: "medium",
    sandbox: "workspace-write",
    promptMarker: "You are the **idea-generator** subagent.",
  },
  "adversarial-review": {
    model: "gpt-5.5",
    effort: "high",
    sandbox: "workspace-write",
    promptMarker: "You are **adversarial-review**",
  },
  "constructive-feedback": {
    model: "gpt-5.5",
    effort: "medium",
    sandbox: "workspace-write",
    promptMarker: "You are **constructive-feedback**",
  },
};

describe("Codex custom agent TOML", () => {
  test("agents directory contains valid Codex custom agent TOML files", () => {
    const expectedNames = Object.keys(expectedModelProfiles).sort();
    const actualFiles = fs
      .readdirSync(codexAgentsDirectory)
      .filter((fileName) => fileName.endsWith(".toml"))
      .sort();

    expect(actualFiles).toEqual(
      expectedNames.map((agentName) => `${agentName}.toml`),
    );

    for (const agentName of expectedNames) {
      const filePath = path.join(codexAgentsDirectory, `${agentName}.toml`);
      const parsed = parse(fs.readFileSync(filePath, "utf-8")) as Record<
        string,
        unknown
      >;
      const profile = expectedModelProfiles[agentName];

      expect(parsed.name).toBe(agentName);
      expect(parsed.version).toBeUndefined();
      expect(codexAgentVersions[agentName]).toBe(packageJson.version);
      expect(typeof parsed.description).toBe("string");
      expect((parsed.description as string).length).toBeGreaterThan(0);
      expect(parsed.model).toBe(profile.model);
      expect(parsed.model_reasoning_effort).toBe(profile.effort);
      expect(parsed.sandbox_mode).toBe(profile.sandbox);
      expect(typeof parsed.developer_instructions).toBe("string");
      expect(parsed.developer_instructions as string).toContain(
        profile.promptMarker,
      );
      expect(Array.isArray(parsed.nickname_candidates)).toBe(true);
      expect((parsed.nickname_candidates as unknown[]).length).toBeGreaterThan(0);
    }
  });
});
