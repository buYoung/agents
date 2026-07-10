/**
 * codex-agents.test.ts - Codex custom agent TOML smoke checks.
 */

import { describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "smol-toml";

const packageRoot = process.cwd();
const codexAgentsDirectory = path.join(packageRoot, "agents");
const codexAgentVersions = JSON.parse(
  fs.readFileSync(path.join(codexAgentsDirectory, "versions.json"), "utf-8"),
) as Record<string, string>;

const semanticVersionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

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
      expect(codexAgentVersions[agentName]).toMatch(semanticVersionPattern);
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

  test("orchestrator uses Codex-native delegation and rejects recursive orchestration", () => {
    const filePath = path.join(codexAgentsDirectory, "orchestrator.toml");
    const parsed = parse(fs.readFileSync(filePath, "utf-8")) as Record<
      string,
      unknown
    >;
    const instructions = parsed.developer_instructions as string;

    expect(instructions).toContain("agent_type");
    expect(instructions).toContain("message");
    expect(instructions).toContain(
      'Never spawn or delegate to `agent_type = "orchestrator"`',
    );
    expect(instructions).toContain("Do not paste the user's full request");
    expect(instructions).not.toContain(
      "Use only `subagent_type`, `description`, and `prompt`",
    );
    expect(instructions).not.toContain('agent: "@code-explorer"');
    expect(instructions).toContain(
      "`intent-checker`, `planner`, and `idea-generator` are optional singletons",
    );
    expect(instructions).toContain(
      "Only `worker`, `research`, and `code-explorer` may have adaptive multiple active instances",
    );
    expect(instructions).toContain(
      "At least two explicit work items are ready now",
    );
    expect(instructions).toContain(
      "Never hard-code a host slot count and never spawn to fill idle capacity",
    );
    expect(instructions).toContain(
      "independent work, independent corroboration, transient-failure replacement, or changed-input re-review",
    );
    expect(instructions).toContain("Review only an immutable integrated result");
    expect(instructions).toContain(
      "prompt-level coordination requirements, not runtime-enforced guarantees",
    );
  });
});
