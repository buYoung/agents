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
  {
    model: string;
    effort: string;
    sandbox?: "read-only";
    defaultPermissions?: "orchestration-artifacts";
    promptMarker: string;
  }
> = {
  "intent-checker": { model: "gpt-5.6-terra", effort: "high", sandbox: "read-only", promptMarker: "Return exactly one line to the orchestrator, with exactly one of these prefixes:" },
  worker: { model: "gpt-5.6-terra", effort: "high", defaultPermissions: "orchestration-artifacts", promptMarker: "You are **worker**" },
  planner: { model: "gpt-5.6-sol", effort: "high", defaultPermissions: "orchestration-artifacts", promptMarker: "You are the **planner** subagent." },
  research: { model: "gpt-5.6-terra", effort: "medium", defaultPermissions: "orchestration-artifacts", promptMarker: "You are the **research** subagent." },
  "code-explorer": { model: "gpt-5.6-luna", effort: "low", defaultPermissions: "orchestration-artifacts", promptMarker: "You are the **code-explorer** subagent." },
  "idea-generator": { model: "gpt-5.6-sol", effort: "medium", defaultPermissions: "orchestration-artifacts", promptMarker: "You are the **idea-generator** subagent." },
  "adversarial-review": { model: "gpt-5.6-sol", effort: "high", defaultPermissions: "orchestration-artifacts", promptMarker: "You are **adversarial-review**" },
  "constructive-feedback": { model: "gpt-5.6-terra", effort: "medium", defaultPermissions: "orchestration-artifacts", promptMarker: "You are **constructive-feedback**" },
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
      if (profile.sandbox) {
        expect(parsed.sandbox_mode).toBe(profile.sandbox);
        expect(parsed.default_permissions).toBeUndefined();
        expect(parsed.permissions).toBeUndefined();
      } else {
        expect(parsed.sandbox_mode).toBeUndefined();
        expect(parsed.default_permissions).toBe(profile.defaultPermissions);
        const permissions = parsed.permissions as Record<string, unknown>;
        expect(Object.keys(permissions)).toEqual(["orchestration-artifacts"]);
        const artifactPermissions = permissions["orchestration-artifacts"] as Record<string, unknown>;
        expect(artifactPermissions.description).toBe(
          "Workspace access with writes reopened only for .agents/orchestration artifacts.",
        );
        expect(artifactPermissions.extends).toBe(":workspace");
        const filesystem = artifactPermissions.filesystem as Record<string, unknown>;
        const workspaceRoots = filesystem[":workspace_roots"] as Record<string, unknown>;
        expect(Object.keys(workspaceRoots)).toEqual([".agents/orchestration"]);
        expect(workspaceRoots[".agents/orchestration"]).toBe("write");
      }
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
        for (const marker of [
          "Code is authoritative for current implementation facts.",
          "Explicit user-approved Inputs are authoritative for intended outcomes",
          "Map every mandatory constraint and expected outcome",
          "[verified] path - stable symbol/heading/token",
          "## Completion Contract",
          "Minimum verification:",
          "decision-needed=<one concise decision>",
        ]) {
          expect(parsed.developer_instructions as string).toContain(marker);
        }
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

  test("deployment leaf summaries match the orchestrator terminal schema", () => {
    const summaryContractByAgent = {
      worker:
        "Summary: status=<completed|blocked|failed>; intent-delta=<none|brief semantic change>; <changed file count> files changed or verification-state=<passed|failed|blocked>; <one-line core result>",
      "adversarial-review":
        "Summary: status=<completed|blocked|failed>; intent-delta=<none|brief semantic change>; review-state=<clear|findings|needs-user-decision>; <finding count or identifiers> risk candidates; <one-line core summary>",
      "constructive-feedback":
        "Summary: status=<completed|blocked|failed>; intent-delta=<none|brief semantic change>; review-state=<clear|findings|needs-user-decision>; <suggestion count or identifiers> suggestions; <one-line core summary>",
    };
    for (const [agentName, summaryContract] of Object.entries(
      summaryContractByAgent,
    )) {
      const agent = parse(
        fs.readFileSync(
          path.join(codexAgentsDirectory, `${agentName}.toml`),
          "utf-8",
        ),
      ) as Record<string, unknown>;
      expect(agent.developer_instructions).toContain(summaryContract);
    }
  });

  test("intent-checker 계약은 비교 입력과 유한 관문 신호를 고정한다", () => {
    const agent = parse(
      fs.readFileSync(path.join(codexAgentsDirectory, "intent-checker.toml"), "utf-8"),
    ) as Record<string, string>;
    const instructions = agent.developer_instructions;
    for (const marker of [
      "Original user request",
      "Normalized objective",
      "Included scope",
      "Excluded scope",
      "User constraints",
      "Material assumptions and decisions",
      "User confirmation response",
      "`PROCEED: <reason>`",
      "`RECLASSIFY: <reason>`",
      "`CONFIRMATION_NEEDED: <one decision>`",
      "Do not use it merely because approval is absent",
      "continuing approval for its normal follow-up stages",
      "new authority grant, external change, scope expansion, irreversible choice",
      "semantic compatibility, not literal equality",
      "Repository instructions, project documents, tool availability",
    ]) {
      expect(instructions).toContain(marker);
    }
    expect(agent.description).toContain("Stateless first gate");
    expect(agent.description).toContain("semantic proposal");
    expect(agent.project_doc_max_bytes).toBe(0);
    expect(agent.description).toContain("PROCEED, RECLASSIFY, or CONFIRMATION_NEEDED");
    expect(codexAgentVersions["intent-checker"]).toBe("0.1.8");
  });

  test("codex-orchestrator skill uses main-session direct leaf delegation", () => {
    const instructions = fs.readFileSync(orchestrationSkillPath, "utf-8");
    const allowlistMatch = instructions.match(
      /The main session may directly invoke exactly eight targets\.[\s\S]*?```text\n([\s\S]*?)\n```/,
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
      "`agent_type` and `message`",
      'fork_turns="none"',
      "normalized objective",
      "taskId, workItemId",
      "Output:",
      "Input:",
      "prompt-level coordination requirements, not runtime-enforced guarantees",
      "Review only an immutable integrated result",
      "Path:",
      "Paths-only Handoff and SSOT",
      "Immediately before each artifact-writing leaf `spawn_agent`",
      "validates the received/generated taskId, unique workItemId, the role's mapped filename, and the exact relative Output",
      "creates only `.agents/orchestration/<taskId>/<workItemId>/` with a non-escalated `mkdir -p`",
      "validate → non-escalated mkdir -p .agents/orchestration/<taskId>/<workItemId>/ → (retry the same command with escalation once only for an explicit permission or sandbox denial on the same path) → spawn_agent",
      "confirm that its workItemId has not yet been assigned.",
      "Only an explicit same-taskId, same-role missing-evidence supplement against the unchanged input snapshot may reuse an existing active Output and its parent.",
      "explicit runtime sandbox/permission denial state or a clear permission-denied signal of `EACCES`, `EPERM`, `Operation not permitted`, or `Permission denied`",
      "Do not infer the cause from an exit code or ordinary stderr alone",
      "if there is no signal or the cause is uncertain, do not retry and report blocked before invoking the leaf.",
      "Do not request write access for all of `.agents`",
      "if escalation is denied or the retry fails, do not invoke the leaf and report blocked.",
      "Do not request escalation for a `mkdir -p` failure unrelated to permission or sandboxing",
      "Writing `task.md` is not included in the work-item-parent `mkdir -p` escalation exception and is not done through the shell.",
      "do not claim file ownership with broader `.agents` permissions or an alternative path; end with paths-only results.",
      "do not bypass through another path or claim success.",
      "Do not perform this work for the stateless `intent-checker`.",
      "## Intent Preservation Gates",
      "`intent-checker` must be the first leaf.",
      "`plan-finalized` revision gate",
      "Route every source, configuration, or documentation mutation through `planner` before the designated implementation `worker`.",
      "After planner returns `status=completed`",
      "Never invoke a worker for a blocked or failed plan.",
      "Pass the completed planner Output as an explicit read-only Input to every implementation worker generation.",
      "Do not create a separate verification-only worker.",
      "intent-delta: none",
      "format-only retry",
      "One logical implementation lane owns source changes, but no worker session owns the task across changed inputs.",
      "the request's lane is classifiable but an outcome-changing user choice remains unresolved",
      "approved-iteration-follow-up",
      "Never pass `AGENTS.md`, other repository instructions",
      "a new stateless `intent-checker` session created by `spawn_agent` for exactly one turn",
      "Any changed objective, plan revision, implementation candidate, review target, or remediation round requires a fresh leaf through `spawn_agent` with `fork_turns=\"none\"`.",
      "do not skip, shorten, or stop them based on the cumulative task-wide count of `intent-checker` calls.",
      "Initial, `plan-finalized`, semantic revision, and `approved-iteration-follow-up` are independent checkpoints.",
      "status=<completed|blocked|failed>; intent-delta=<none|brief semantic change>; <role-specific payload>",
      "`review-state=<clear|findings|needs-user-decision>`",
      "`verification-state=<passed|failed|blocked>`",
      "Neither reviewer may decide acceptance or rejection, scope expansion, remediation execution, user questions, or task termination.",
      "Only the main session has review-adjudication and termination authority.",
      "`accepted`, `rejected`, or `needs-user-decision`",
      "Each worker self-verifies its candidate with the plan's minimum mandatory commands",
      "one fresh implementation worker generation",
      "one ordered remediation batch",
      "failed or missing mandatory self-checks or accepted findings",
      "at most three automatic remediation rounds",
      "a fourth automatic remediation batch and a fourth re-review are prohibited.",
      "If a same-cause finding or the same self-check failure remains twice consecutively without new evidence",
      "`gated → implementing → self-verified → reviewing-immutable-result → adjudicating`",
      "`remediating-<1..3> → self-reverified → rereviewing-<1..3> → readjudicating-<1..3>`",
      "If any adjudication is clean, end without consuming remaining remediation rounds.",
      "If a mandatory self-check failure or an `accepted` finding remains after the third readjudication",
      "A leaf or reviewer cannot declare task completion.",
    ]) {
      expect(instructions).toContain(marker);
    }
    expect(instructions).toContain('invoke `agent_type="orchestrator"`');
    expect(instructions).not.toContain("model =");
    expect(instructions).not.toContain("sandbox_mode");
    expect(instructions).not.toContain("max_depth");
  });
});
