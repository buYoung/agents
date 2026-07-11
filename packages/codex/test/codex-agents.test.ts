/**
 * codex-agents.test.ts - Codex custom agent TOML and orchestration skill checks.
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
const orchestrationSkillPath = path.join(
  packageRoot,
  "skills",
  "codex-orchestrator",
  "SKILL.md",
);
const semanticVersionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

const expectedModelProfiles: Record<
  string,
  { model: string; effort: string; sandbox: string; promptMarker: string }
> = {
  "intent-checker": { model: "gpt-5.6-terra", effort: "high", sandbox: "read-only", promptMarker: "Return exactly one line to the orchestrator." },
  worker: { model: "gpt-5.6-terra", effort: "high", sandbox: "workspace-write", promptMarker: "You are **worker**" },
  planner: { model: "gpt-5.6-sol", effort: "high", sandbox: "workspace-write", promptMarker: "You are the **planner** subagent." },
  research: { model: "gpt-5.6-terra", effort: "medium", sandbox: "workspace-write", promptMarker: "You are the **research** subagent." },
  "code-explorer": { model: "gpt-5.6-luna", effort: "low", sandbox: "workspace-write", promptMarker: "You are the **code-explorer** subagent." },
  "idea-generator": { model: "gpt-5.6-sol", effort: "medium", sandbox: "workspace-write", promptMarker: "You are the **idea-generator** subagent." },
  "adversarial-review": { model: "gpt-5.6-sol", effort: "high", sandbox: "workspace-write", promptMarker: "You are **adversarial-review**" },
  "constructive-feedback": { model: "gpt-5.6-terra", effort: "medium", sandbox: "workspace-write", promptMarker: "You are **constructive-feedback**" },
};

describe("Codex custom agent TOML", () => {
  test("agents directory contains valid Codex leaf custom agent TOML files", () => {
    const expectedNames = Object.keys(expectedModelProfiles).sort();
    const actualFiles = fs.readdirSync(codexAgentsDirectory).filter((fileName) => fileName.endsWith(".toml")).sort();
    expect(actualFiles).toEqual(expectedNames.map((agentName) => `${agentName}.toml`));

    for (const agentName of expectedNames) {
      const parsed = parse(fs.readFileSync(path.join(codexAgentsDirectory, `${agentName}.toml`), "utf-8")) as Record<string, unknown>;
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
      if (agentName !== "intent-checker") {
        expect(parsed.developer_instructions as string).toContain(
          "An explicit same-taskId, same-role follow-up may reactivate a historical Output by reassigning that exact path as the current Output; the reassigned Output becomes active and writable again, and the prior active Output becomes read-only history.",
        );
      }
      if (agentName === "planner") {
        expect(parsed.description as string).toContain(
          "validating the received execution identity",
        );
        expect(parsed.description as string).not.toContain("taskId generation");
        expect(parsed.developer_instructions as string).toContain(
          "## Received Execution Identity",
        );
      }
      expect(Array.isArray(parsed.nickname_candidates)).toBe(true);
      expect((parsed.nickname_candidates as unknown[]).length).toBeGreaterThan(0);
      expect(
        (parsed.nickname_candidates as unknown[]).every(
          (candidate) =>
            typeof candidate === "string" && candidate.length > 0,
        ),
      ).toBe(true);
    }
    expect(codexAgentVersions).not.toHaveProperty("orchestrator");
  });

  test("codex-orchestrator skill uses main-session direct leaf delegation", () => {
    const instructions = fs.readFileSync(orchestrationSkillPath, "utf-8");
    const allowlistMatch = instructions.match(
      /main session이 직접 호출할 수 있는 대상은 정확히 8개다\.[\s\S]*?```text\n([\s\S]*?)\n```/,
    );
    expect(allowlistMatch).not.toBeNull();
    const allowedAgentNames = allowlistMatch![1]
      .split("\n")
      .map((agentName) => agentName.trim())
      .filter(Boolean);
    expect(allowedAgentNames).toHaveLength(8);
    expect(new Set(allowedAgentNames).size).toBe(8);
    expect([...allowedAgentNames].sort()).toEqual(
      Object.keys(expectedModelProfiles).sort(),
    );
    expect(allowedAgentNames).not.toContain("orchestrator");
    for (const marker of [
      "`agent_type`과 `message`",
      'fork_turns="none"',
      "정규화한 목표",
      "taskId, workItemId",
      "Output:",
      "Input:",
      "prompt-level coordination requirements, not runtime-enforced guarantees",
      "Review only an immutable integrated result",
      "Path:",
      "Paths-only handoff와 SSOT",
    ]) {
      expect(instructions).toContain(marker);
    }
    expect(instructions).toContain('`agent_type="orchestrator"`를 호출하거나');
    expect(instructions).not.toContain("model =");
    expect(instructions).not.toContain("sandbox_mode");
    expect(instructions).not.toContain("max_depth");
  });
});
