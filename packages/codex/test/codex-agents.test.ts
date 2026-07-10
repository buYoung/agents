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
      "received execution identity validation",
    );
    expect(instructions).not.toContain(
      "pre-implementation convergent plan, impact scope, taskId generation",
    );
    const multiplicityPolicyMarkers = [
      [
        "single orchestrator and leaf no-spawn",
        "Exactly one logical orchestrator owns this user task: this agent. No leaf agent may spawn another agent",
      ],
      [
        "planning-role singletons",
        "`intent-checker`, `planner`, and `idea-generator` are optional singletons",
      ],
      [
        "review-type singletons",
        "`adversarial-review` and `constructive-feedback` are each optional singletons. At most one of each may be active, and one of each type may run concurrently against the same immutable integrated result",
      ],
      [
        "singleton reuse gate",
        "only after the prior instance or round is terminal and the input state changed",
      ],
      [
        "adaptive roles and default count",
        "Only `worker`, `research`, and `code-explorer` may have adaptive multiple active instances. Default to one instance",
      ],
      ["objective gate: ready items", "At least two explicit work items are ready now"],
      [
        "objective gate: bounded unique contract",
        "Every item has a unique goal, bounded input and scope, concrete output, completion criterion, and unique workItemId",
      ],
      [
        "objective gate: dependency independence",
        "The items do not depend on one another or require an unfinished predecessor",
      ],
      [
        "objective gate: ownership and verification",
        "The items have non-overlapping ownership and can be independently verified",
      ],
      [
        "objective gate: capacity bound",
        "The count does not exceed ready non-conflicting items or the runtime/configured concurrency capacity",
      ],
      [
        "uncertain independence defaults to one",
        "If independence or ownership is uncertain, use one instance",
      ],
      [
        "code-explorer split gate",
        "Split `code-explorer` only by an independent package/module/ownership boundary, call-flow question, or investigation hypothesis",
      ],
      [
        "code-explorer duplicate-scope prohibition",
        "Do not duplicate substantially identical scopes",
      ],
      [
        "research split gate",
        "Split `research` only by an independent research question/evidence domain",
      ],
      [
        "research split non-example",
        "More search terms or sources alone are not separate work items",
      ],
      [
        "worker split gate",
        "Multiple workers require disjoint files and disjoint schema, public API, generated files, lockfiles, migration ordering, and shared mutable state",
      ],
      [
        "worker serialization gate",
        "If one result changes another worker's baseline, serialize them",
      ],
      [
        "duplicate implementation prohibition",
        "Duplicate implementations are forbidden unless the explicit deliverable is a choose-one prototype comparison",
      ],
      [
        "active capacity formula",
        "The active count is the minimum of ready non-conflicting items, runtime available capacity, and configured limit",
      ],
      [
        "no-idle rule",
        "Never hard-code a host slot count and never spawn to fill idle capacity",
      ],
      [
        "ready DAG frontier",
        "Execute only the currently ready dependency-DAG frontier in parallel",
      ],
      [
        "spawn reason",
        "independent work, independent corroboration, transient-failure replacement, or changed-input re-review",
      ],
      [
        "transient failure replacement",
        "A transient harness or tool failure may be replaced once",
      ],
      [
        "genuine completion failure",
        "Never repeat the same instruction after a genuine completion failure; repartition or escalate instead",
      ],
      [
        "second same-cause failure",
        "Report a second same-cause failure as blocked",
      ],
      [
        "terminal downstream aggregation",
        "Wait for every required branch to become terminal. Route concrete result paths to one downstream planner, one designated integration worker, or a review role",
      ],
      [
        "no main-agent body merge",
        "do not read and merge phase bodies yourself",
      ],
      ["immutable review", "Review only an immutable integrated result"],
      [
        "single sequential re-review",
        "each review type may run one sequential re-review round",
      ],
      [
        "unique execution identity",
        "Every leaf call must already contain taskId, workItemId, and the exact output path",
      ],
      [
        "unique workItemId per execution",
        "Allocate a unique kebab-case workItemId for every artifact-writing delegation",
      ],
      [
        "enforcement honesty",
        "prompt-level coordination requirements, not runtime-enforced guarantees",
      ],
      [
        "Codex topology boundary",
        "Codex depth limits prevent leaf recursion in this topology; do not claim a bespoke scheduler or runtime singleton enforcement",
      ],
    ] as const;
    for (const [policy, marker] of multiplicityPolicyMarkers) {
      expect(instructions, policy).toContain(marker);
    }
  });
});
