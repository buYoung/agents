/**
 * permission.test.ts — enforcePermission 권한 매트릭스, 위임, fail-safe
 */

import { describe, test, expect } from "vitest";
import {
  classifyPath,
  compileConfiguredMcpPolicy,
  enforcePermission,
  createSessionAgentMap,
  getTaskExecutionContext,
  type AgentName,
  type ExecutionAssignment,
} from "@opencode/core/permissions";

function executionAssignment(
  agent: ExecutionAssignment["agent"],
  taskId: string,
  workItemId: string,
  filename: string,
): ExecutionAssignment {
  return {
    agent,
    taskId,
    workItemId,
    artifactPath: `.agents/${taskId}/${workItemId}/${filename}`,
  };
}

function artifactTaskArgs(
  agent: ExecutionAssignment["agent"],
  workItemId: string,
  filename: string,
  inputs: readonly string[] = [],
): Record<string, unknown> {
  return {
    subagent_type: agent,
    prompt: [
      `taskId=20260702-test workItemId=${workItemId}`,
      `Output: .agents/20260702-test/${workItemId}/${filename}`,
      ...inputs.map((input) => `Input: ${input}`),
    ].join("\n"),
  };
}

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
  const testAssignments = new Map<string, ExecutionAssignment>([
    [
      "session-orch",
      executionAssignment(
        "orchestrator",
        "20260702-test",
        "orchestrator-index",
        "task.md",
      ),
    ],
    [
      "session-explore",
      executionAssignment(
        "code-explorer",
        "20260702-test",
        "explorer-01",
        "explore.md",
      ),
    ],
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

  test("orchestrator: 읽기 전용 bash 허용", () => {
    const commands = [
      "ls .agents/20260702-test/orchestrator-index/task.md",
      "wc -l .agents/20260702-test/orchestrator-index/task.md",
      "test -f .agents/20260702-test/orchestrator-index/task.md",
      "rg --files .agents/20260702-test/orchestrator-index/task.md | wc -l",
      "git --no-pager log --oneline -5",
    ];

    for (const command of commands) {
      const result = enforcePermission(
        {
          tool: "bash",
          sessionID: "session-orch",
          args: { command },
        },
        testMap,
      );
      expect(result.allowed, command).toBe(true);
    }

    for (const command of [
      "git --no-pager log --pretty=%H -1",
      "git --no-pager log --format=%H -1",
      "git --no-pager log --pretty %H -1",
      "git --no-pager log --format %H -1",
      "git ls-files --format=%H",
    ]) {
      const result = enforcePermission(
        {
          tool: "bash",
          sessionID: "session-orch",
          args: { command },
        },
        testMap,
      );
      expect(result.allowed, command).toBe(false);
    }
  });

  test("orchestrator: .agents 루트 열람 거부", () => {
    const readTargets = [".agents", ".agents/", ".agents/*", ".agents/**"];

    for (const targetPath of readTargets) {
      const result = enforcePermission(
        {
          tool: "read",
          sessionID: "session-orch",
          args: { path: targetPath },
        },
        testMap,
        { workspaceRoot: "/Users/buyong/workspace/private/buyong-agents" },
      );
      expect(result.allowed, targetPath).toBe(false);
    }
  });

  test("orchestrator: 자기 task.md만 read 허용", () => {
    const taskIndex = enforcePermission(
      {
        tool: "read",
        sessionID: "session-orch",
        args: {
          path: ".agents/20260702-test/orchestrator-index/task.md",
        },
      },
      testMap,
    );
    const subagentArtifact = enforcePermission(
      {
        tool: "read",
        sessionID: "session-orch",
        args: {
          path: ".agents/20260702-test/explorer-01/explore.md",
        },
      },
      testMap,
    );

    expect(taskIndex.allowed).toBe(true);
    expect(subagentArtifact.allowed).toBe(false);
  });

  test("orchestrator: bash .agents 루트 나열 거부", () => {
    const commands = [
      "ls .agents",
      "ls -la .agents/",
      "find .agents -maxdepth 1 -type f",
      "date +%Y%m%d && ls .agents",
    ];

    for (const command of commands) {
      const result = enforcePermission(
        {
          tool: "bash",
          sessionID: "session-orch",
          args: { command },
        },
        testMap,
        { workspaceRoot: "/Users/buyong/workspace/private/buyong-agents" },
      );
      expect(result.allowed, command).toBe(false);
    }
  });

  test("orchestrator: 쓰기 가능 bash 거부", () => {
    const commands = [
      "mkdir -p .agents/20260702-test",
      "rm -rf .agents/20260702-test",
      "cat .agents/20260702-test/task.md > /tmp/task.md",
      "sed -i '' 's/a/b/' .agents/20260702-test/task.md",
      "find .agents/20260702-test -type f -delete",
      "git checkout -- packages/opencode/src/core/permissions.ts",
      "git status --short",
    ];

    for (const command of commands) {
      const result = enforcePermission(
        {
          tool: "bash",
          sessionID: "session-orch",
          args: { command },
        },
        testMap,
      );
      expect(result.allowed, command).toBe(false);
    }
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
          path: "/Users/buyong/workspace/private/buyong-agents/.agents/20260702-test/orchestrator-index/task.md",
        },
      },
      testMap,
      {
        workspaceRoot: "/Users/buyong/workspace/private/buyong-agents",
        sessionAssignments: testAssignments,
      },
    );
    expect(result.allowed).toBe(true);
    expect(classifyPath("src/not.agents.md")).toBe("source");
  });

  test("code-explorer: .agents/** write 허용 (baseline)", () => {
    const result = enforcePermission(
      {
        tool: "write",
        sessionID: "session-explore",
        args: {
          path: ".agents/20260702-test/explorer-01/explore.md",
        },
      },
      testMap,
      { sessionAssignments: testAssignments },
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
    expect(
      enforcePermission(
        {
          tool: "read",
          sessionID: "session-unknown",
          args: { path: ".agents/20260702-test/worker-01/work.md" },
        },
        testMap,
      ).allowed,
    ).toBe(false);
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
        args: artifactTaskArgs("worker", "worker-01", "work.md"),
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
        args: artifactTaskArgs("planner", "planner-01", "plan.md"),
      },
      testMap,
    );
    expect(result.allowed).toBe(true);

    const disabledPlannerResult = enforcePermission(
      {
        tool: "task",
        sessionID: "session-orch",
        args: artifactTaskArgs("planner", "planner-01", "plan.md"),
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
  const fullAssignments = new Map<string, ExecutionAssignment>([
    [
      "s-research",
      executionAssignment(
        "research",
        "20260702-test",
        "research-01",
        "research.md",
      ),
    ],
    [
      "s-planner",
      executionAssignment(
        "planner",
        "20260707-test",
        "planner-01",
        "plan.md",
      ),
    ],
  ]);

  test("research: webfetch 허용", () => {
    const result = enforcePermission(
      { tool: "webfetch", sessionID: "s-research", args: {} },
      fullMap,
    );
    expect(result.allowed).toBe(true);

    const configuredMcpPolicy = compileConfiguredMcpPolicy(
      {
        "Code.Map": { type: "local", command: ["codemap-search", "mcp"] },
        browser: { type: "remote", url: "https://example.test/mcp" },
      },
      { agents: { planner: { disabled_mcp: ["browser"] } } },
      [...fullMap.values()],
    );
    expect(
      enforcePermission(
        { tool: "Code_Map_search", sessionID: "s-research", args: {} },
        fullMap,
        { configuredMcpPolicy },
      ).allowed,
    ).toBe(true);
    expect(
      enforcePermission(
        { tool: "browser_open", sessionID: "s-planner", args: {} },
        fullMap,
        { configuredMcpPolicy },
      ).allowed,
    ).toBe(false);
    for (const sessionID of ["s-orch", "s-intent"]) {
      expect(
        enforcePermission(
          { tool: "Code_Map_read", sessionID, args: {} },
          fullMap,
          { configuredMcpPolicy },
        ).allowed,
      ).toBe(false);
    }
    for (const tool of [
      "code_Map_search",
      "other_Code_Map_search",
      "mcp__Code_Map__search",
      "unconfigured_read",
    ]) {
      expect(
        enforcePermission(
          { tool, sessionID: "s-research", args: {} },
          fullMap,
          { configuredMcpPolicy },
        ).allowed,
      ).toBe(false);
    }
    expect(
      enforcePermission(
        { tool: "Code_Map_search", sessionID: "unknown", args: {} },
        fullMap,
        { configuredMcpPolicy },
      ).allowed,
    ).toBe(false);
    const unmanagedRolePolicy = compileConfiguredMcpPolicy(
      { "Code.Map": { type: "local", command: ["codemap-search", "mcp"] } },
      {},
      ["worker"],
    );
    expect(
      enforcePermission(
        { tool: "Code_Map_search", sessionID: "s-research", args: {} },
        fullMap,
        { configuredMcpPolicy: unmanagedRolePolicy },
      ).allowed,
    ).toBe(false);
  });

  test("research: source 쓰기 거부, workspace 내부 산출물 쓰기만 허용", () => {
    const options = {
      workspaceRoot: "/repo/project",
      sessionAssignments: fullAssignments,
    };

    expect(
      enforcePermission(
        {
          tool: "write",
          sessionID: "s-research",
          args: { path: "/repo/project/src/research.ts" },
        },
        fullMap,
        options,
      ).allowed,
    ).toBe(false);
    expect(
      enforcePermission(
        {
          tool: "write",
          sessionID: "s-research",
          args: {
            path: "/repo/project/.agents/20260702-test/research-01/research.md",
          },
        },
        fullMap,
        options,
      ).allowed,
    ).toBe(true);
    expect(
      enforcePermission(
        {
          tool: "write",
          sessionID: "s-research",
          args: {
            path: "/tmp/.agents/20260702-test/research-01/research.md",
          },
        },
        fullMap,
        options,
      ).allowed,
    ).toBe(false);
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

  test("planner/adversarial-review/constructive-feedback: 읽기 전용 bash만 허용", () => {
    for (const sessionID of ["s-planner", "s-adv", "s-cf"]) {
      expect(
        enforcePermission(
          {
            tool: "bash",
            sessionID,
            args: {
              command:
                "wc -l .agents/20260707-test/planner-01/plan.md",
            },
          },
          fullMap,
        ).allowed,
      ).toBe(true);
      expect(
        enforcePermission(
          {
            tool: "bash",
            sessionID,
            args: { command: "mkdir -p .agents/x" },
          },
          fullMap,
        ).allowed,
      ).toBe(false);
    }
  });

  test("planner: 읽기 전용 bash 허용, 파일시스템 변경 bash 거부", () => {
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
    ).toBe(true);
    expect(
      enforcePermission(
        {
          tool: "bash",
          sessionID: "s-planner",
          args: { command: "git --no-pager log --oneline -5" },
        },
        fullMap,
      ).allowed,
    ).toBe(true);
    expect(
      enforcePermission(
        {
          tool: "bash",
          sessionID: "s-planner",
          args: { command: "date +%Y%m%d" },
        },
        fullMap,
      ).allowed,
    ).toBe(true);
    expect(
      enforcePermission(
        {
          tool: "bash",
          sessionID: "s-planner",
          args: { command: "echo \"$(date +%Y%m%d)-task\"" },
        },
        fullMap,
      ).allowed,
    ).toBe(false);
  });

  test("worker: workspace/temp 밖 경로 쓰기 거부", () => {
    const options = {
      workspaceRoot: "/repo/project",
      tempRoots: ["/tmp"],
    };

    expect(
      enforcePermission(
        {
          tool: "write",
          sessionID: "s-worker",
          args: { path: "/repo/project/src/service.ts" },
        },
        fullMap,
        options,
      ).allowed,
    ).toBe(true);
    expect(
      enforcePermission(
        {
          tool: "write",
          sessionID: "s-worker",
          args: { path: "/tmp/worker-output.txt" },
        },
        fullMap,
        options,
      ).allowed,
    ).toBe(true);
    expect(
      enforcePermission(
        {
          tool: "write",
          sessionID: "s-worker",
          args: { path: "/Users/other/outside.txt" },
        },
        fullMap,
        options,
      ).allowed,
    ).toBe(false);
  });

  test("worker: 직접 조회 명령만 허용하고 외부 접근·실행 래퍼 거부", () => {
    const options = {
      workspaceRoot: "/repo/project",
      tempRoots: ["/tmp"],
    };

    expect(
      enforcePermission(
        {
          tool: "bash",
          sessionID: "s-worker",
          args: { command: "rg --files src" },
        },
        fullMap,
      ).allowed,
    ).toBe(false);
    expect(
      enforcePermission(
        {
          tool: "bash",
          sessionID: "s-worker",
          args: {
            command: "rg --files src",
            workdir: "/repo/project",
          },
        },
        fullMap,
        options,
      ).allowed,
    ).toBe(true);
    expect(
      enforcePermission(
        {
          tool: "bash",
          sessionID: "s-worker",
          args: {
            command: "cat /tmp/worker-output.txt",
            workdir: "/repo/project",
          },
        },
        fullMap,
        options,
      ).allowed,
    ).toBe(true);
    expect(
      enforcePermission(
        {
          tool: "bash",
          sessionID: "s-worker",
          args: {
            command: "pnpm check",
            workdir: "/repo/project",
          },
        },
        fullMap,
        options,
      ).allowed,
    ).toBe(false);
    expect(
      enforcePermission(
        {
          tool: "bash",
          sessionID: "s-worker",
          args: {
            command: "cp src/a.ts /tmp/a.ts",
            workdir: "/repo/project",
          },
        },
        fullMap,
        options,
      ).allowed,
    ).toBe(false);
    for (const command of [
      "date -s 2030-01-01",
      "diff src/a.ts src/b.ts --output=src/result.diff",
    ]) {
      expect(
        enforcePermission(
          {
            tool: "bash",
            sessionID: "s-worker",
            args: { command, workdir: "/repo/project" },
          },
          fullMap,
          options,
        ).allowed,
        command,
      ).toBe(false);
    }
    expect(
      enforcePermission(
        {
          tool: "bash",
          sessionID: "s-worker",
          args: {
            command: 'nice sh -c "cat /Users/other/outside.txt"',
            workdir: "/repo/project",
          },
        },
        fullMap,
        options,
      ).allowed,
    ).toBe(false);
    expect(
      enforcePermission(
        {
          tool: "bash",
          sessionID: "s-worker",
          args: {
            command: "cat /Users/other/outside.txt",
            workdir: "/repo/project",
          },
        },
        fullMap,
        options,
      ).allowed,
    ).toBe(false);
    expect(
      enforcePermission(
        {
          tool: "bash",
          sessionID: "s-worker",
          args: {
            command: "rg --files src",
            workdir: "/Users/other",
          },
        },
        fullMap,
        options,
      ).allowed,
    ).toBe(false);
    expect(
      enforcePermission(
        {
          tool: "bash",
          sessionID: "s-worker",
          args: {
            command: "python -c \"open('x', 'w').write('x')\"",
            workdir: "/repo/project",
          },
        },
        fullMap,
        options,
      ).allowed,
    ).toBe(false);
  });

  test("planner: 자기 work-item 산출물 continuation edit/write 허용", () => {
    expect(
      enforcePermission(
        {
          tool: "edit",
          sessionID: "s-planner",
          args: { path: ".agents/20260707-test/planner-01/plan.md" },
        },
        fullMap,
        { sessionAssignments: fullAssignments },
      ).allowed,
    ).toBe(true);
    expect(
      enforcePermission(
        {
          tool: "write",
          sessionID: "s-planner",
          args: { path: ".agents/20260707-test/planner-01/plan.md" },
        },
        fullMap,
        { sessionAssignments: fullAssignments },
      ).allowed,
    ).toBe(true);

    const lifecycle = createSessionAgentMap();
    expect(lifecycle.updateSessionAgent("parent", "orchestrator")).toBe(true);
    const delegatedInput =
      ".agents/20260702-test/worker-input-01/work.md";
    const firstContext = getTaskExecutionContext(
      artifactTaskArgs(
        "planner",
        "planner-session-01",
        "plan.md",
        [delegatedInput],
      ),
    );
    if (!firstContext) throw new Error("first context must parse");
    expect(
      lifecycle.registerDelegation({
        parentSessionID: "parent",
        callID: "call-1",
        context: firstContext,
      }),
    ).toBe(true);
    expect(
      lifecycle.completeDelegation({
        parentSessionID: "parent",
        callID: "call-1",
        childSessionID: "planner-child",
        context: firstContext,
      }),
    ).toBe(true);
    expect(lifecycle.assignmentMap.get("planner-child")).toEqual(
      firstContext.output,
    );

    const lifecycleOptions = {
      sessionAssignments: lifecycle.assignmentMap,
      sessionExecution: lifecycle,
    };
    expect(
      enforcePermission(
        {
          tool: "read",
          sessionID: "planner-child",
          args: { path: delegatedInput },
        },
        lifecycle.map,
        lifecycleOptions,
      ).allowed,
    ).toBe(true);
    expect(
      enforcePermission(
        {
          tool: "read",
          sessionID: "planner-child",
          args: {
            path: ".agents/20260702-test/unregistered-worker/work.md",
          },
        },
        lifecycle.map,
        lifecycleOptions,
      ).allowed,
    ).toBe(false);

    const secondContext = getTaskExecutionContext(
      artifactTaskArgs(
        "planner",
        "planner-session-02",
        "plan.md",
        [firstContext.output.artifactPath],
      ),
    );
    if (!secondContext) throw new Error("second context must parse");
    expect(
      lifecycle.registerDelegation({
        parentSessionID: "parent",
        callID: "call-2",
        continuedSessionID: "planner-child",
        context: secondContext,
      }),
    ).toBe(true);
    expect(
      lifecycle.completeDelegation({
        parentSessionID: "parent",
        callID: "call-2",
        childSessionID: "planner-child",
        context: secondContext,
      }),
    ).toBe(true);
    expect(
      lifecycle.stateMap.get("planner-child")?.historicalAssignments.size,
    ).toBe(1);
    expect(lifecycle.assignmentMap.get("planner-child")).toEqual(
      secondContext.output,
    );

    for (const path of [
      firstContext.output.artifactPath,
      secondContext.output.artifactPath,
    ]) {
      expect(
        enforcePermission(
          { tool: "read", sessionID: "planner-child", args: { path } },
          lifecycle.map,
          lifecycleOptions,
        ).allowed,
      ).toBe(true);
    }
    expect(
      enforcePermission(
        {
          tool: "edit",
          sessionID: "planner-child",
          args: { path: firstContext.output.artifactPath },
        },
        lifecycle.map,
        lifecycleOptions,
      ).allowed,
    ).toBe(false);
    expect(
      enforcePermission(
        {
          tool: "edit",
          sessionID: "planner-child",
          args: { path: secondContext.output.artifactPath },
        },
        lifecycle.map,
        lifecycleOptions,
      ).allowed,
    ).toBe(true);

    const roleChangeContext = getTaskExecutionContext(
      artifactTaskArgs("worker", "worker-session-03", "work.md"),
    );
    if (!roleChangeContext) throw new Error("role context must parse");
    expect(
      lifecycle.canRegisterDelegation({
        parentSessionID: "parent",
        callID: "call-role-change",
        continuedSessionID: "planner-child",
        context: roleChangeContext,
      }),
    ).toBe(false);
    const taskChangeContext = {
      output: executionAssignment(
        "planner",
        "20260703-other",
        "planner-session-03",
        "plan.md",
      ),
      inputs: [],
      protocol: "explicit" as const,
    };
    expect(
      lifecycle.canRegisterDelegation({
        parentSessionID: "parent",
        callID: "call-task-change",
        continuedSessionID: "planner-child",
        context: taskChangeContext,
      }),
    ).toBe(false);
    const duplicateAcrossRoles = getTaskExecutionContext({
      subagent_type: "worker",
      prompt: [
        "taskId=20260702-test workItemId=planner-session-02",
        "Output: .agents/20260702-test/planner-session-02/work.md",
      ].join("\n"),
    });
    if (!duplicateAcrossRoles) throw new Error("duplicate context must parse");
    expect(
      lifecycle.canRegisterDelegation({
        parentSessionID: "parent",
        callID: "call-duplicate",
        context: duplicateAcrossRoles,
      }),
    ).toBe(false);

    expect(
      getTaskExecutionContext({
        subagent_type: "planner",
        prompt: [
          "Output: .agents/20260702-test/planner-a/plan.md",
          "Output: .agents/20260702-test/planner-b/plan.md",
        ].join("\n"),
      }),
    ).toBeUndefined();
    expect(
      getTaskExecutionContext({
        subagent_type: "planner",
        prompt:
          ".agents/20260702-test/planner-a/plan.md .agents/20260702-test/planner-b/plan.md",
      }),
    ).toBeUndefined();

    const reactivationContext = getTaskExecutionContext(
      artifactTaskArgs(
        "planner",
        "planner-session-01",
        "plan.md",
        [secondContext.output.artifactPath],
      ),
    );
    if (!reactivationContext) throw new Error("reactivation must parse");
    expect(
      lifecycle.registerDelegation({
        parentSessionID: "parent",
        callID: "call-3",
        continuedSessionID: "planner-child",
        context: reactivationContext,
      }),
    ).toBe(true);
    expect(
      lifecycle.completeDelegation({
        parentSessionID: "parent",
        callID: "call-3",
        childSessionID: "planner-child",
        context: reactivationContext,
      }),
    ).toBe(true);
    expect(lifecycle.assignmentMap.get("planner-child")).toEqual(
      firstContext.output,
    );
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

  test("intent-checker: .agents/**도 읽기 거부 (role read policy)", () => {
    const result = enforcePermission(
      {
        tool: "read",
        sessionID: "s-intent",
        args: { path: ".agents/20260702-test/worker-01/work.md" },
      },
      fullMap,
    );
    expect(result.allowed).toBe(false);
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
