/**
 * permission.test.ts — enforcePermission 권한 매트릭스, 위임, fail-safe
 */

import { describe, test, expect } from "vitest";
import {
  classifyPath,
  enforcePermission,
  createSessionAgentMap,
  type AgentName,
} from "@opencode/core/permissions";

function makeMap(entries: [AgentName, string][]): Map<string, AgentName> {
  const { map, updateSessionAgent } = createSessionAgentMap();
  for (const [agent, sessionID] of entries) {
    updateSessionAgent(sessionID, agent);
  }
  return map;
}

const advisoryAgents: Array<[AgentName, string]> = [
  ["intent-checker", "s-intent"],
  ["planner", "s-planner"],
  ["research", "s-research"],
  ["code-explorer", "s-explore"],
  ["idea-generator", "s-ideator"],
  ["adversarial-review", "s-adv"],
  ["constructive-feedback", "s-cf"],
];

describe("권한 매트릭스", () => {
  const testMap = makeMap([
    ["orchestrator", "session-orch"],
    ["code-explorer", "session-explore"],
    ["worker", "session-worker"],
  ]);

  test("orchestrator: source edit 거부", () => {
    const result = enforcePermission(
      {
        tool: "edit",
        sessionID: "session-orch",
        args: { path: "src/index.ts" },
      },
      testMap,
    );
    expect(result.allowed).toBe(false);
  });

  test("code-explorer: bash 거부", () => {
    const result = enforcePermission(
      { tool: "bash", sessionID: "session-explore", args: {} },
      testMap,
    );
    expect(result.allowed).toBe(false);
  });

  test("worker: source edit 허용", () => {
    const result = enforcePermission(
      {
        tool: "edit",
        sessionID: "session-worker",
        args: { path: "src/service.ts" },
      },
      testMap,
    );
    expect(result.allowed).toBe(true);
  });

  test("orchestrator: .agents/** write 허용 (baseline)", () => {
    const result = enforcePermission(
      {
        tool: "write",
        sessionID: "session-orch",
        args: {
          path: "/Users/buyong/workspace/private/buyong-agents/.agents/20260702-test/task.md",
        },
      },
      testMap,
    );
    expect(result.allowed).toBe(true);
    expect(classifyPath("src/not.agents.md")).toBe("source");
  });

  test("code-explorer: .agents/** write 허용 (baseline)", () => {
    const result = enforcePermission(
      {
        tool: "write",
        sessionID: "session-explore",
        args: { path: ".agents/20260702-test/explore.md" },
      },
      testMap,
    );
    expect(result.allowed).toBe(true);
  });
});

describe("fail-safe", () => {
  const testMap = makeMap([
    ["orchestrator", "session-orch"],
    ["code-explorer", "session-explore"],
    ["worker", "session-worker"],
  ]);

  test("미확인 세션 + edit → 거부", () => {
    const result = enforcePermission(
      {
        tool: "edit",
        sessionID: "session-unknown",
        args: { path: "src/x.ts" },
      },
      testMap,
    );
    expect(result.allowed).toBe(false);
  });

  test("미확인 세션 + read → 허용", () => {
    const result = enforcePermission(
      {
        tool: "read",
        sessionID: "session-unknown",
        args: { path: "src/x.ts" },
      },
      testMap,
    );
    expect(result.allowed).toBe(true);
  });
});

describe("위임(task 도구)", () => {
  const testMap = makeMap([
    ["orchestrator", "session-orch"],
    ["code-explorer", "session-explore"],
    ["worker", "session-worker"],
  ]);

  test("orchestrator → worker 위임 허용", () => {
    const result = enforcePermission(
      {
        tool: "task",
        sessionID: "session-orch",
        args: { subagent_type: "worker" },
      },
      testMap,
    );
    expect(result.allowed).toBe(true);
  });

  test("orchestrator → planner 위임 허용", () => {
    const result = enforcePermission(
      {
        tool: "task",
        sessionID: "session-orch",
        args: { subagent_type: "planner" },
      },
      testMap,
    );
    expect(result.allowed).toBe(true);

    const disabledPlannerResult = enforcePermission(
      {
        tool: "task",
        sessionID: "session-orch",
        args: { subagent_type: "planner" },
      },
      testMap,
      { subagentNames: ["worker"] },
    );
    expect(disabledPlannerResult.allowed).toBe(false);
    expect(disabledPlannerResult.reason).toContain(
      "허용된 서브에이전트: worker",
    );
  });

  test("worker → planner 재위임 거부", () => {
    const result = enforcePermission(
      {
        tool: "task",
        sessionID: "session-worker",
        args: { subagent_type: "planner" },
      },
      testMap,
    );
    expect(result.allowed).toBe(false);
  });

  test("code-explorer → worker 재위임 거부", () => {
    const result = enforcePermission(
      {
        tool: "task",
        sessionID: "session-explore",
        args: { subagent_type: "worker" },
      },
      testMap,
    );
    expect(result.allowed).toBe(false);
  });
});

describe("추가 정책 spot-check", () => {
  const fullMap = makeMap([
    ["orchestrator", "s-orch"],
    ["intent-checker", "s-intent"],
    ["worker", "s-worker"],
    ["planner", "s-planner"],
    ["research", "s-research"],
    ["code-explorer", "s-explore"],
    ["idea-generator", "s-ideator"],
    ["adversarial-review", "s-adv"],
    ["constructive-feedback", "s-cf"],
  ]);

  test("research: webfetch 허용", () => {
    const result = enforcePermission(
      { tool: "webfetch", sessionID: "s-research", args: {} },
      fullMap,
    );
    expect(result.allowed).toBe(true);
  });

  test("code-explorer/idea-generator: bash 거부", () => {
    expect(
      enforcePermission(
        { tool: "bash", sessionID: "s-explore", args: {} },
        fullMap,
      ).allowed,
    ).toBe(false);
    expect(
      enforcePermission(
        { tool: "bash", sessionID: "s-ideator", args: {} },
        fullMap,
      ).allowed,
    ).toBe(false);
  });

  test("planner/adversarial-review/constructive-feedback: bash 허용 (검증 목적)", () => {
    expect(
      enforcePermission(
        { tool: "bash", sessionID: "s-planner", args: {} },
        fullMap,
      ).allowed,
    ).toBe(true);
    expect(
      enforcePermission({ tool: "bash", sessionID: "s-adv", args: {} }, fullMap)
        .allowed,
    ).toBe(true);
    expect(
      enforcePermission({ tool: "bash", sessionID: "s-cf", args: {} }, fullMap)
        .allowed,
    ).toBe(true);
  });

  test("planner: 파일시스템 변경/경로 나열 bash 거부", () => {
    expect(
      enforcePermission(
        {
          tool: "bash",
          sessionID: "s-planner",
          args: { command: "mkdir -p .agents/x" },
        },
        fullMap,
      ).allowed,
    ).toBe(false);
    expect(
      enforcePermission(
        { tool: "bash", sessionID: "s-planner", args: { command: "ls docs" } },
        fullMap,
      ).allowed,
    ).toBe(false);
    expect(
      enforcePermission(
        {
          tool: "bash",
          sessionID: "s-planner",
          args: { command: "git log --oneline -5" },
        },
        fullMap,
      ).allowed,
    ).toBe(true);
  });

  test("planner: .agents/** 산출물 edit 거부, write 허용", () => {
    expect(
      enforcePermission(
        {
          tool: "edit",
          sessionID: "s-planner",
          args: { path: ".agents/20260707-test/plan.md" },
        },
        fullMap,
      ).allowed,
    ).toBe(false);
    expect(
      enforcePermission(
        {
          tool: "write",
          sessionID: "s-planner",
          args: { path: ".agents/20260707-test/plan.md" },
        },
        fullMap,
      ).allowed,
    ).toBe(true);
  });

  test("7개 advisory 에이전트: source edit 거부", () => {
    for (const [agent, sessionID] of advisoryAgents) {
      const result = enforcePermission(
        { tool: "edit", sessionID, args: { path: "src/x.ts" } },
        fullMap,
      );
      expect(result.allowed).toBe(false);
    }
  });

  test("7개 advisory 에이전트: task 위임 거부", () => {
    for (const [agent, sessionID] of advisoryAgents) {
      const result = enforcePermission(
        { tool: "task", sessionID, args: { subagent_type: "worker" } },
        fullMap,
      );
      expect(result.allowed).toBe(false);
    }
  });

  test("intent-checker: source 읽기 거부 (deny)", () => {
    const result = enforcePermission(
      { tool: "read", sessionID: "s-intent", args: { path: "src/x.ts" } },
      fullMap,
    );
    expect(result.allowed).toBe(false);
  });

  test("intent-checker: docs 읽기 거부 (deny — 게이트는 읽기 불필요)", () => {
    const result = enforcePermission(
      { tool: "read", sessionID: "s-intent", args: { path: "docs/x.md" } },
      fullMap,
    );
    expect(result.allowed).toBe(false);
  });

  test("intent-checker: .agents/** 읽기 허용 (baseline)", () => {
    const result = enforcePermission(
      {
        tool: "read",
        sessionID: "s-intent",
        args: { path: ".agents/20260702-test/work.md" },
      },
      fullMap,
    );
    expect(result.allowed).toBe(true);
  });

  test("intent-checker: bash 거부", () => {
    const result = enforcePermission(
      { tool: "bash", sessionID: "s-intent", args: {} },
      fullMap,
    );
    expect(result.allowed).toBe(false);
  });

  test("orchestrator → intent-checker 위임 허용", () => {
    const result = enforcePermission(
      {
        tool: "task",
        sessionID: "s-orch",
        args: { subagent_type: "intent-checker" },
      },
      fullMap,
    );
    expect(result.allowed).toBe(true);
  });

  test("intent-checker → orchestrator 재위임 거부", () => {
    const result = enforcePermission(
      {
        tool: "task",
        sessionID: "s-intent",
        args: { subagent_type: "orchestrator" },
      },
      fullMap,
    );
    expect(result.allowed).toBe(false);
  });
});
