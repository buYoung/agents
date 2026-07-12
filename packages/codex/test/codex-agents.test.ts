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
  "intent-checker": { model: "gpt-5.6-terra", effort: "high", sandbox: "read-only", promptMarker: "Return exactly one line to the orchestrator." },
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
      "artifact-writing leaf의 `spawn_agent` 직전",
      "정확한 상대 Output을 모두 검증한 뒤",
      "정확히 `.agents/orchestration/<taskId>/<workItemId>/`만 일반 권한의 `mkdir -p`",
      "검증 → 일반 권한 mkdir -p .agents/orchestration/<taskId>/<workItemId>/ → (명시적 권한·sandbox 거부 시에만 동일 명령·동일 경로 권한 상승 재시도 1회) → spawn_agent",
      "coordinator의 task-wide 할당 기록으로 아직 할당되지 않은 workItemId인지 확인한다.",
      "명시적인 same-taskId, same-role follow-up만 기존 active Output과 그 부모를 재사용할 수 있다.",
      "runtime의 명시적 sandbox/permission 거부 상태를 반환하거나 `EACCES`, `EPERM`, `Operation not permitted`, `Permission denied`",
      "종료 코드나 일반 stderr만으로 원인을 추론하지 않으며",
      "신호가 없거나 원인이 불확실하면 재시도하지 않고 leaf 호출 전 차단 상태로 보고한다.",
      "`.agents` 전체 쓰기 권한을 요청하지 않으며",
      "권한 상승이 거부되거나 그 재시도가 실패하면 leaf를 호출하지 않고 차단 상태로 보고한다.",
      "권한·sandbox 이외의 `mkdir -p` 실패에는 권한 상승을 요청하지 않으며",
      "`task.md` 쓰기는 work-item 부모 `mkdir -p` 권한 상승 예외에 포함되지 않으며 shell로 쓰지 않는다.",
      "`.agents` 전체 권한 확대나 대체 경로 없이 파일 소유를 주장하지 말고 paths-only 결과로 끝낸다.",
      "다른 경로로 우회하거나 성공을 주장하지 않는다.",
      "stateless `intent-checker`에는 이 작업을 하지 않는다.",
    ]) {
      expect(instructions).toContain(marker);
    }
    expect(instructions).toContain('`agent_type="orchestrator"`를 호출하거나');
    expect(instructions).not.toContain("model =");
    expect(instructions).not.toContain("sandbox_mode");
    expect(instructions).not.toContain("max_depth");
  });
});
