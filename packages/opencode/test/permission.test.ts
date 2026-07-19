/**
 * permission.test.ts — enforcePermission 권한 매트릭스, 위임, fail-safe
 */

import { describe, test, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  classifyPath,
  compileConfiguredMcpPolicy,
  enforcePermission,
  createSessionAgentMap,
  getTaskExecutionContext,
  type AgentName,
  type ConfiguredMcpPolicy,
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
    artifactPath: `.agents/orchestration/${taskId}/${workItemId}/${filename}`,
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
      `Output: .agents/orchestration/20260702-test/${workItemId}/${filename}`,
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
    const sessionExecution = createSessionAgentMap();
    expect(
      sessionExecution.updateSessionAgent("session-orch", "orchestrator"),
    ).toBe(true);
    const assignment = testAssignments.get("session-orch");
    if (!assignment) throw new Error("orchestrator assignment must exist");
    expect(
      sessionExecution.bindRootAssignment("session-orch", assignment),
    ).toBe(true);
    const options = {
      sessionAssignments: sessionExecution.assignmentMap,
      sessionExecution,
    };
    const commands = [
      "ls .agents/orchestration/20260702-test/orchestrator-index/task.md",
      "wc -l .agents/orchestration/20260702-test/orchestrator-index/task.md",
      "test -f .agents/orchestration/20260702-test/orchestrator-index/task.md",
      "rg --files .agents/orchestration/20260702-test/orchestrator-index/task.md | wc -l",
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
        options,
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
        options,
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
          path: ".agents/orchestration/20260702-test/orchestrator-index/task.md",
        },
      },
      testMap,
    );
    const subagentArtifact = enforcePermission(
      {
        tool: "read",
        sessionID: "session-orch",
        args: {
          path: ".agents/orchestration/20260702-test/explorer-01/explore.md",
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
      "mkdir -p .agents/orchestration/20260702-test",
      "rm -rf .agents/orchestration/20260702-test",
      "cat .agents/orchestration/20260702-test/task.md > /tmp/task.md",
      "sed -i '' 's/a/b/' .agents/orchestration/20260702-test/task.md",
      "find .agents/orchestration/20260702-test -type f -delete",
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

  test("orchestrator: .agents/orchestration/** write 허용 (baseline)", () => {
    const result = enforcePermission(
      {
        tool: "write",
        sessionID: "session-orch",
        args: {
          path: "/Users/buyong/workspace/private/buyong-agents/.agents/orchestration/20260702-test/orchestrator-index/task.md",
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

  test("code-explorer: .agents/orchestration/** write 허용 (baseline)", () => {
    const result = enforcePermission(
      {
        tool: "write",
        sessionID: "session-explore",
        args: {
          path: ".agents/orchestration/20260702-test/explorer-01/explore.md",
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
          args: {
            path: ".agents/orchestration/20260702-test/worker-01/work.md",
          },
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
    const reservedCollisionPolicy: ConfiguredMcpPolicy = {
      servers: [
        {
          serverKey: "apply",
          sanitizedServerKey: "apply",
          toolPrefix: "apply_",
          nativePermissionKey: "apply_*",
        },
        {
          serverKey: "list",
          sanitizedServerKey: "list",
          toolPrefix: "list_",
          nativePermissionKey: "list_*",
        },
        {
          serverKey: "read",
          sanitizedServerKey: "read",
          toolPrefix: "read_",
          nativePermissionKey: "read_*",
        },
      ],
      disabledByAgent: new Map<AgentName, ReadonlySet<string>>(
        [...new Set(fullMap.values())].map((agentName) => [
          agentName,
          new Set<string>(),
        ]),
      ),
    };
    expect(
      enforcePermission(
        {
          tool: "apply_patch",
          sessionID: "s-planner",
          args: {
            patchText:
              "*** Begin Patch\n*** Update File: packages/opencode/src/index.ts\n@@\n-old\n+new\n*** End Patch",
          },
        },
        fullMap,
        { configuredMcpPolicy: reservedCollisionPolicy },
      ).allowed,
    ).toBe(false);
    expect(
      enforcePermission(
        {
          tool: "apply_patch",
          sessionID: "s-planner",
          args: {
            patchText:
              "*** Begin Patch\n*** Update File: .agents/orchestration/20260707-test/planner-01/plan.md\n@@\n-old\n+new\n*** End Patch",
          },
        },
        fullMap,
        {
          configuredMcpPolicy: reservedCollisionPolicy,
          sessionAssignments: fullAssignments,
        },
      ).allowed,
    ).toBe(false);
    for (const tool of [
      "list_mcp_resources",
      "list_mcp_resource_templates",
      "read_mcp_resource",
    ]) {
      expect(
        enforcePermission(
          { tool, sessionID: "s-planner", args: {} },
          fullMap,
          { configuredMcpPolicy: reservedCollisionPolicy },
      ).allowed,
    ).toBe(false);
    }
    const actualCollisionPolicy: ConfiguredMcpPolicy = {
      ...reservedCollisionPolicy,
      mcpCatalogToolIds: new Set(["apply_patch"]),
    };
    expect(
      enforcePermission(
        {
          tool: "apply_patch",
          sessionID: "s-planner",
          args: { operation: "server-defined MCP input" },
        },
        fullMap,
        { configuredMcpPolicy: actualCollisionPolicy },
      ).allowed,
    ).toBe(true);
    expect(
      enforcePermission(
        {
          tool: "apply_patch",
          sessionID: "s-worker",
          args: {
            patchText:
              "*** Begin Patch\n*** Update File: packages/opencode/src/index.ts\n@@\n-old\n+new\n*** End Patch",
          },
        },
        fullMap,
      ).allowed,
    ).toBe(true);
    expect(
      enforcePermission(
        {
          tool: "apply_patch",
          sessionID: "s-worker",
          args: {
            patchText:
              "*** Begin Patch\n*** Update File: ../../outside.ts\n@@\n-old\n+new\n*** End Patch",
          },
        },
        fullMap,
      ).allowed,
    ).toBe(false);
    expect(
      enforcePermission(
        {
          tool: "apply_patch",
          sessionID: "s-worker",
          args: {
            patchText:
              "*** Begin Patch\n*** Update File: packages/opencode/src/index.ts\n@@\n-old\n+new\n*** Update File:.agents/orchestration/20260707-test/planner-01/plan.md\n@@\n-old\n+new\n*** End Patch",
          },
        },
        fullMap,
        { sessionAssignments: fullAssignments },
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
            path: "/repo/project/.agents/orchestration/20260702-test/research-01/research.md",
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
            path: "/tmp/.agents/orchestration/20260702-test/research-01/research.md",
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
            args: { command: "wc -l README.md" },
          },
          fullMap,
        ).allowed,
      ).toBe(true);
      expect(
        enforcePermission(
          {
            tool: "bash",
            sessionID,
            args: {
              command:
                "wc -l .agents/orchestration/20260707-test/planner-01/plan.md",
            },
          },
          fullMap,
        ).allowed,
      ).toBe(false);
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

  test("worker: 실제 구현·빌드·검증을 위한 일반 bash 실행 허용", () => {
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
    ).toBe(true);
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
    ).toBe(true);
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
    ).toBe(true);
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
      ).toBe(true);
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
    ).toBe(true);
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
    ).toBe(true);
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
    ).toBe(true);
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
    ).toBe(true);
  });

  test("planner: 자기 work-item 산출물 continuation은 완전한 append-only edit만 허용", () => {
    expect(
      enforcePermission(
        {
          tool: "edit",
          sessionID: "s-planner",
          args: {
            path: ".agents/orchestration/20260707-test/planner-01/plan.md",
          },
        },
        fullMap,
        { sessionAssignments: fullAssignments },
      ).allowed,
    ).toBe(false);
    expect(
      enforcePermission(
        {
          tool: "edit",
          sessionID: "s-planner",
          args: {
            path: ".agents/orchestration/20260707-test/planner-01/plan.md",
            oldString: "existing plan",
          },
        },
        fullMap,
        { sessionAssignments: fullAssignments },
      ).allowed,
    ).toBe(false);
    const temporaryWorkspace = fs.mkdtempSync(
      path.join(os.tmpdir(), "opencode-append-only-"),
    );
    const artifactPath = path.join(
      temporaryWorkspace,
      ".agents/orchestration/20260707-test/planner-01/plan.md",
    );
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, "existing plan\r\n");
    try {
      expect(
        enforcePermission(
          {
            tool: "edit",
            sessionID: "s-planner",
            args: {
              filePath: artifactPath,
              oldString: "existing plan\n",
              newString: "existing plan\n\ncontinuation entry\n",
            },
          },
          fullMap,
          {
            workspaceRoot: temporaryWorkspace,
            sessionAssignments: fullAssignments,
          },
        ).allowed,
      ).toBe(true);
      expect(
        enforcePermission(
          {
            tool: "edit",
            sessionID: "s-planner",
            args: {
              filePath: artifactPath,
              oldString: "existing plan\n",
              newString: "replacement plan",
            },
          },
          fullMap,
          {
            workspaceRoot: temporaryWorkspace,
            sessionAssignments: fullAssignments,
          },
        ).allowed,
      ).toBe(false);
    } finally {
      fs.rmSync(temporaryWorkspace, { recursive: true, force: true });
    }
    expect(
      enforcePermission(
        {
          tool: "write",
          sessionID: "s-planner",
          args: {
            path: ".agents/orchestration/20260707-test/planner-01/plan.md",
          },
        },
        fullMap,
        { sessionAssignments: fullAssignments },
      ).allowed,
    ).toBe(true);

    const lifecycle = createSessionAgentMap();
    expect(lifecycle.updateSessionAgent("parent", "orchestrator")).toBe(true);
    const delegatedInput =
      ".agents/orchestration/20260702-test/worker-input-01/work.md";
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
      lifecycle.bindSessionExecutionContext("unrelated-planner", firstContext),
    ).toBe(false);
    expect(
      lifecycle.bindSessionExecutionContext("planner-child", firstContext),
    ).toBe(false);
    const directWorker = createSessionAgentMap();
    expect(directWorker.updateSessionAgent("direct-worker", "worker")).toBe(
      true,
    );
    const directWorkerContext = getTaskExecutionContext(
      artifactTaskArgs("worker", "direct-worker-01", "work.md"),
    );
    if (!directWorkerContext) throw new Error("direct worker context must parse");
    expect(
      directWorker.bindSessionExecutionContext("direct-worker", directWorkerContext),
    ).toBe(false);
    expect(
      directWorker.bindRootExecutionContext("direct-worker", directWorkerContext),
    ).toBe(true);
    expect(
      directWorker.bindRootExecutionContext("direct-worker", directWorkerContext),
    ).toBe(true);
    expect(directWorker.assignmentMap.get("direct-worker")).toEqual(
      directWorkerContext.output,
    );
    expect(
      enforcePermission(
        {
          tool: "write",
          sessionID: "direct-worker",
          args: { path: directWorkerContext.output.artifactPath },
        },
        directWorker.map,
        {
          sessionAssignments: directWorker.assignmentMap,
          sessionExecution: directWorker,
        },
      ).allowed,
    ).toBe(true);
    const nonWorkerRoot = createSessionAgentMap();
    const plannerRootContext = getTaskExecutionContext(
      artifactTaskArgs("planner", "planner-root-01", "plan.md"),
    );
    if (!plannerRootContext) throw new Error("planner root context must parse");
    expect(
      nonWorkerRoot.bindRootExecutionContext("planner-root", plannerRootContext),
    ).toBe(false);
    const differentTaskContext = {
      ...directWorkerContext,
      output: executionAssignment(
        "worker",
        "20260703-other",
        "direct-worker-02",
        "work.md",
      ),
    };
    expect(
      directWorker.bindRootExecutionContext("direct-worker", differentTaskContext),
    ).toBe(false);
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
            path: ".agents/orchestration/20260702-test/unregistered-worker/work.md",
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
      lifecycle.bindSessionExecutionContext("planner-child", secondContext),
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
    for (const path of [
      delegatedInput,
      firstContext.output.artifactPath,
      secondContext.output.artifactPath,
    ]) {
      expect(
        enforcePermission(
          {
            tool: "bash",
            sessionID: "planner-child",
            args: { command: `wc -l ${path}` },
          },
          lifecycle.map,
          lifecycleOptions,
        ).allowed,
      ).toBe(true);
    }
    for (const path of [
      ".agents/orchestration/20260702-test/planner-unregistered/plan.md",
      ".agents/orchestration/20260702-test/worker-unregistered/work.md",
      ".agents/orchestration/20260703-other/planner-unregistered/plan.md",
    ]) {
      expect(
        enforcePermission(
          {
            tool: "bash",
            sessionID: "planner-child",
            args: { command: `wc -l ${path}` },
          },
          lifecycle.map,
          lifecycleOptions,
        ).allowed,
      ).toBe(false);
    }
    const rootLifecycle = createSessionAgentMap();
    expect(
      rootLifecycle.updateSessionAgent("root-session", "orchestrator"),
    ).toBe(true);
    const rootAssignment = executionAssignment(
      "orchestrator",
      "20260702-test",
      "orchestrator-index",
      "task.md",
    );
    expect(
      rootLifecycle.bindRootAssignment("root-session", rootAssignment),
    ).toBe(true);
    expect(
      enforcePermission(
        {
          tool: "bash",
          sessionID: "root-session",
          args: { command: `wc -l ${rootAssignment.artifactPath}` },
        },
        rootLifecycle.map,
        {
          sessionAssignments: rootLifecycle.assignmentMap,
          sessionExecution: rootLifecycle,
        },
      ).allowed,
    ).toBe(true);
    expect(
      enforcePermission(
        {
          tool: "bash",
          sessionID: "root-session",
          args: {
            command:
              "wc -l .agents/orchestration/20260703-other/orchestrator-index/task.md",
          },
        },
        rootLifecycle.map,
        {
          sessionAssignments: rootLifecycle.assignmentMap,
          sessionExecution: rootLifecycle,
        },
      ).allowed,
    ).toBe(false);
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
    ).toBe(false);

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
        "Output: .agents/orchestration/20260702-test/planner-session-02/work.md",
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
          "Output: .agents/orchestration/20260702-test/planner-a/plan.md",
          "Output: .agents/orchestration/20260702-test/planner-b/plan.md",
        ].join("\n"),
      }),
    ).toBeUndefined();
    expect(
      getTaskExecutionContext({
        subagent_type: "planner",
        prompt:
          ".agents/orchestration/20260702-test/planner-a/plan.md .agents/orchestration/20260702-test/planner-b/plan.md",
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
        args: {
          path: ".agents/orchestration/20260702-test/worker-01/work.md",
        },
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
