/**
 * plugin.test.ts — 플러그인 로드, config 훅, 권한 훅 존재, catalog fallback
 */

import { describe, test, expect } from "vitest";
import _pluginFactory from "@opencode/index";
import {
  buildProviderConfig,
  getCatalogModelIds,
} from "@opencode/core/catalog";

const pluginFactory =
  typeof _pluginFactory === "function" ? _pluginFactory : _pluginFactory.server;

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const stubInput = {
  client: {} as never,
  project: {} as never,
  directory: ".",
  worktree: ".",
  experimental_workspace: { register: () => {} },
  serverUrl: new URL("http://localhost"),
  $: {} as never,
};

describe("플러그인 로드", () => {
  test("9개 에이전트 + 모드 검증", async () => {
    const hooks = await pluginFactory(stubInput, {});
    const agentRecord = (hooks as unknown as Record<string, unknown>)
      .agent as Record<
      string,
      { name: string; description: string; mode: string; prompt: string }
    >;

    expect(agentRecord).toBeTypeOf("object");
    expect(agentRecord).not.toBeNull();

    const expectedAgents = [
      "orchestrator",
      "intent-checker",
      "worker",
      "planner",
      "research",
      "code-explorer",
      "idea-generator",
      "adversarial-review",
      "constructive-feedback",
    ];
    expect(Object.keys(agentRecord)).toHaveLength(9);
    for (const name of expectedAgents) {
      expect(name in agentRecord).toBe(true);
    }

    expect(agentRecord["orchestrator"]?.mode).toBe("primary");
    expect(agentRecord["worker"]?.mode).toBe("all");
    expect(agentRecord["code-explorer"]?.mode).toBe("subagent");
    expect(agentRecord["planner"]?.mode).toBe("subagent");
    expect(agentRecord["intent-checker"]?.mode).toBe("subagent");
    expect(agentRecord["planner"]?.description).toContain(
      "validating the received execution identity",
    );
    expect(agentRecord["planner"]?.description).not.toContain(
      "taskId generation",
    );
    expect(agentRecord["planner"]?.prompt).toContain(
      "## Received Execution Identity",
    );
    const orchestratorPrompt = agentRecord["orchestrator"]?.prompt ?? "";
    const intentCheckerPrompt = agentRecord["intent-checker"]?.prompt ?? "";
    expect(agentRecord["intent-checker"]?.description).toContain(
      "Stateless first gate",
    );
    expect(agentRecord["intent-checker"]?.description).toContain(
      "scope, constraints, and decisions",
    );
    expect(agentRecord["orchestrator"]?.description).toContain(
      "first leaf for every classifiable request",
    );
    for (const marker of [
      "Original user request",
      "Normalized objective",
      "Included scope",
      "Excluded scope",
      "User constraints",
      "Material assumptions and decisions",
      "User confirmation response",
      "`PROCEED: status=completed; intent-delta=<none|brief semantic change>; <reason>`",
      "`RECLASSIFY: status=blocked; intent-delta=<none|brief semantic change>; <reason>`",
      "`CONFIRMATION_NEEDED: status=blocked; intent-delta=<none|brief semantic change>; <one decision>`",
      "continuing approval for its normal follow-up stages",
      "new authority grant, external change, scope expansion, irreversible choice",
      "Do not use repository state, system instructions, tool availability or permission mechanics",
    ]) {
      expect(intentCheckerPrompt).toContain(marker);
    }
    for (const marker of [
      "## Intent-Preservation Gate",
      "invoke `intent-checker` with `task` as the first leaf",
      "`plan-finalized` checkpoint",
      "semantic revision",
      "one format-only retry",
      "fresh worker generation",
      "lane is classifiable but a result-changing material decision is unresolved",
      "approved-iteration-follow-up",
      "Do not pass repository facts, system instructions, tool availability or permission mechanics",
      "fresh one-turn stateless `intent-checker` task at every checkpoint",
      "Continue only unchanged-input same-scope remediation through the existing `task_id`",
      "subagent_type`, `description`, and `prompt`",
    ]) {
      expect(orchestratorPrompt).toContain(marker);
    }
    const multiplicityPolicyMarkers = [
      [
        "single orchestrator and leaf no-spawn",
        "Exactly one logical orchestrator owns this user task: this agent. Leaf agents never spawn or redelegate",
      ],
      [
        "planning-role singletons",
        "`intent-checker`, `planner`, and `idea-generator` are optional singletons",
      ],
      [
        "zero-or-one active cardinality",
        "zero or one active instance per phase or round",
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
        "active-not-lifetime singleton semantics",
        "Singleton means one active instance, not one lifetime call",
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
        "high-cost independent research corroboration",
        "truly independent corroboration when the cost of a wrong fact is high",
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
        "exactly-one spawn reason",
        "Every spawn records exactly one reason",
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
        "remediation-changed-result re-review prerequisite",
        "After remediation changes that result",
      ],
      [
        "single sequential re-review",
        "each review type may run one sequential re-review round",
      ],
      [
        "unique execution identity",
        "The task call must already contain taskId, workItemId, and the exact output path",
      ],
      [
        "unique workItemId per execution",
        "Allocate a unique kebab-case workItemId for every new artifact-writing work item",
      ],
      [
        "enforcement honesty",
        "not a bespoke runtime scheduler. Runtime enforcement covers leaf redelegation and exact artifact assignment only",
      ],
    ] as const;
    for (const [policy, marker] of multiplicityPolicyMarkers) {
      expect(orchestratorPrompt, policy).toContain(marker);
    }
  });

  test("훅 존재와 config/task/child lifecycle 결합", async () => {
    type SessionLookupResponse = {
      data?: { parentID?: string };
      error?: { message: string };
    };
    type DeferredSessionResponse = {
      promise: Promise<SessionLookupResponse>;
      resolve: (response: SessionLookupResponse) => void;
    };
    const deferredSessionResponses = new Map<
      string,
      DeferredSessionResponse[]
    >();
    const sessionLookupCounts = new Map<string, number>();
    const sessionLookupWaiters = new Map<string, Array<() => void>>();
    const deferSessionResponse = (sessionID: string) => {
      let resolveResponse!: (response: SessionLookupResponse) => void;
      const response: DeferredSessionResponse = {
        promise: new Promise<SessionLookupResponse>((resolve) => {
          resolveResponse = resolve;
        }),
        resolve: (value) => resolveResponse(value),
      };
      const queue = deferredSessionResponses.get(sessionID) ?? [];
      queue.push(response);
      deferredSessionResponses.set(sessionID, queue);
      return response.resolve;
    };
    const waitForSessionLookup = async (sessionID: string, count: number) => {
      if ((sessionLookupCounts.get(sessionID) ?? 0) >= count) return;
      await new Promise<void>((resolve) => {
        const check = () => {
          if ((sessionLookupCounts.get(sessionID) ?? 0) >= count) {
            resolve();
            return;
          }
          const waiters = sessionLookupWaiters.get(sessionID) ?? [];
          waiters.push(check);
          sessionLookupWaiters.set(sessionID, waiters);
        };
        check();
      });
    };
    const hooks = await pluginFactory(
      {
        ...stubInput,
        client: {
          session: {
            get: async ({ path }: { path: { id: string } }) => {
              sessionLookupCounts.set(
                path.id,
                (sessionLookupCounts.get(path.id) ?? 0) + 1,
              );
              const waiters = sessionLookupWaiters.get(path.id) ?? [];
              sessionLookupWaiters.delete(path.id);
              for (const waiter of waiters) waiter();
              const deferred = deferredSessionResponses.get(path.id)?.shift();
              if (deferred) return deferred.promise;
              if (
                path.id === "direct-root-worker" ||
                path.id === "quoted-direct-root-worker"
              ) {
                return { data: { parentID: undefined } };
              }
              if (
                path.id === "worker-child" ||
                path.id === "worker-child-no-context"
              ) {
                return { data: { parentID: "lifecycle-root" } };
              }
              if (path.id === "concurrent-direct-root-worker") {
                return { data: { parentID: undefined } };
              }
              return { data: undefined, error: { message: "not found" } };
            },
          },
        } as never,
      },
      {},
    );
    expect(typeof (hooks as unknown as Record<string, unknown>).config).toBe(
      "function",
    );
    expect(
      typeof (hooks as unknown as Record<string, unknown>)[
        "tool.execute.before"
      ],
    ).toBe("function");
    expect(
      typeof (hooks as unknown as Record<string, unknown>)["chat.message"],
    ).toBe("function");
    expect(typeof (hooks as unknown as Record<string, unknown>).event).toBe(
      "function",
    );

    const hookRecord = hooks as unknown as Record<string, unknown>;
    const configHook = hookRecord.config as (
      cfg: Record<string, unknown>,
    ) => Promise<void>;
    const beforeHook = hookRecord["tool.execute.before"] as (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ) => Promise<void>;
    const chatHook = hookRecord["chat.message"] as (
      input: { sessionID: string },
      output: {
        message: { agent: string };
        parts: Array<{ type: string; text: string }>;
      },
    ) => Promise<void>;
    const eventHook = hookRecord.event as (input: {
      event: { type: string; properties: Record<string, unknown> };
    }) => Promise<void>;
    const runtimeConfig: Record<string, unknown> = {
      mcp: {
        "Code.Map": {
          type: "local",
          command: ["codemap-search", "mcp"],
          enabled: true,
        },
      },
    };
    await configHook(runtimeConfig);
    const directWorkerPrompt = [
      "taskId=20260710-direct-root workItemId=direct-worker-01",
      "Output: .agents/orchestration/20260710-direct-root/direct-worker-01/work.md",
    ].join("\n");
    await chatHook(
      { sessionID: "direct-root-worker" },
      {
        message: { agent: "worker" },
        parts: [{ type: "text", text: directWorkerPrompt }],
      },
    );
    await beforeHook(
      {
        tool: "write",
        sessionID: "direct-root-worker",
        callID: "direct-worker-write",
      },
      {
        args: {
          path: ".agents/orchestration/20260710-direct-root/direct-worker-01/work.md",
        },
      },
    );
    const quotedDirectWorkerPrompt = [
      '"taskId=20260710-runtime-direct-root workItemId=direct-worker-01',
      "Output: .agents/orchestration/20260710-runtime-direct-root/direct-worker-01/work.md\"",
    ].join("\n");
    await chatHook(
      { sessionID: "quoted-direct-root-worker" },
      {
        message: { agent: "worker" },
        parts: [{ type: "text", text: quotedDirectWorkerPrompt }],
      },
    );
    await beforeHook(
      {
        tool: "write",
        sessionID: "quoted-direct-root-worker",
        callID: "quoted-direct-worker-write",
      },
      {
        args: {
          path: ".agents/orchestration/20260710-runtime-direct-root/direct-worker-01/work.md",
        },
      },
    );
    for (const sessionID of ["worker-child", "worker-session-unknown"]) {
      await expect(
        chatHook(
          { sessionID },
          {
            message: { agent: "worker" },
            parts: [{ type: "text", text: directWorkerPrompt }],
          },
        ),
      ).rejects.toThrow("실행 할당 충돌");
    }
    await expect(
      beforeHook(
        {
          tool: "edit",
          sessionID: "worker-child",
          callID: "rejected-child-source-edit",
        },
        {
          args: {
            path: "src/rejected-child.ts",
            oldString: "",
            newString: "unsafe",
          },
        },
      ),
    ).rejects.toThrow("에이전트 미확인");
    for (const sessionID of [
      "worker-child-no-context",
      "worker-session-unknown-no-context",
    ]) {
      await expect(
        chatHook(
          { sessionID },
          {
            message: { agent: "worker" },
            parts: [{ type: "text", text: "worker without execution context" }],
          },
        ),
      ).rejects.toThrow("실행 할당 충돌");
      await expect(
        beforeHook(
          {
            tool: "edit",
            sessionID,
            callID: `${sessionID}-source-edit`,
          },
          {
            args: {
              path: "src/unbound-worker.ts",
              oldString: "",
              newString: "unsafe",
            },
          },
        ),
      ).rejects.toThrow("에이전트 미확인");
    }
    const expectPendingWorkerSourceEditDenied = async (
      sessionID: string,
      response: SessionLookupResponse,
    ) => {
      const resolveSession = deferSessionResponse(sessionID);
      const pendingChat = chatHook(
        { sessionID },
        {
          message: { agent: "worker" },
          parts: [{ type: "text", text: directWorkerPrompt }],
        },
      );
      await waitForSessionLookup(sessionID, 1);
      await expect(
        beforeHook(
          {
            tool: "edit",
            sessionID,
            callID: `${sessionID}-pending-source-edit`,
          },
          {
            args: {
              path: "src/pending-unbound-worker.ts",
              oldString: "",
              newString: "unsafe",
            },
          },
        ),
      ).rejects.toThrow("에이전트 미확인");
      resolveSession(response);
      await expect(pendingChat).rejects.toThrow("실행 할당 충돌");
    };
    await expectPendingWorkerSourceEditDenied("pending-rejected-child", {
      data: { parentID: "lifecycle-root" },
    });
    await expectPendingWorkerSourceEditDenied("pending-rejected-unknown", {
      data: undefined,
      error: { message: "not found" },
    });
    const concurrentRejectedWorkerPrompt = [
      "taskId=20260710-rejected-worker workItemId=worker-01",
      "Output: .agents/orchestration/20260710-rejected-worker/worker-01/work.md",
    ].join("\n");
    const expectConcurrentRejectedWorker = async (
      sessionID: string,
      response: SessionLookupResponse,
    ) => {
      const resolveFirst = deferSessionResponse(sessionID);
      const resolveSecond = deferSessionResponse(sessionID);
      const rejection = expect(
        Promise.all([
          chatHook(
            { sessionID },
            {
              message: { agent: "worker" },
              parts: [{ type: "text", text: concurrentRejectedWorkerPrompt }],
            },
          ),
          chatHook(
            { sessionID },
            {
              message: { agent: "worker" },
              parts: [{ type: "text", text: concurrentRejectedWorkerPrompt }],
            },
          ),
        ]),
      ).rejects.toThrow("실행 할당 충돌");
      await waitForSessionLookup(sessionID, 1);
      resolveFirst(response);
      await waitForSessionLookup(sessionID, 2);
      resolveSecond(response);
      await rejection;
      await expect(
        beforeHook(
          {
            tool: "edit",
            sessionID,
            callID: `${sessionID}-concurrent-source-edit`,
          },
          {
            args: {
              path: "src/concurrent-unbound-worker.ts",
              oldString: "",
              newString: "unsafe",
            },
          },
        ),
      ).rejects.toThrow("에이전트 미확인");
    };
    await expectConcurrentRejectedWorker("concurrent-rejected-child", {
      data: { parentID: "lifecycle-root" },
    });
    await expectConcurrentRejectedWorker("concurrent-rejected-unknown", {
      data: undefined,
      error: { message: "not found" },
    });
    const concurrentRootPrompt = [
      "taskId=20260710-concurrent-root workItemId=direct-worker-01",
      "Output: .agents/orchestration/20260710-concurrent-root/direct-worker-01/work.md",
    ].join("\n");
    await expect(
      Promise.all([
        chatHook(
          { sessionID: "concurrent-direct-root-worker" },
          {
            message: { agent: "worker" },
            parts: [{ type: "text", text: concurrentRootPrompt }],
          },
        ),
        chatHook(
          { sessionID: "concurrent-direct-root-worker" },
          {
            message: { agent: "worker" },
            parts: [{ type: "text", text: concurrentRootPrompt }],
          },
        ),
      ]),
    ).resolves.toEqual([undefined, undefined]);
    await chatHook(
      { sessionID: "lifecycle-root" },
      {
        message: { agent: "orchestrator" },
        parts: [{ type: "text", text: "root request" }],
      },
    );

    const firstTaskArgs = {
      subagent_type: "planner",
      prompt: [
        "taskId=20260710-hook workItemId=planner-01",
        "Output: .agents/orchestration/20260710-hook/planner-01/plan.md",
        "Input: .agents/orchestration/20260710-hook/worker-input/work.md",
      ].join("\n"),
    };
    await beforeHook(
      { tool: "task", sessionID: "lifecycle-root", callID: "call-1" },
      { args: firstTaskArgs },
    );
    for (const sessionID of ["unrelated-child", "lifecycle-child"]) {
      await expect(
        chatHook(
          { sessionID },
          {
            message: { agent: "planner" },
            parts: [{ type: "text", text: firstTaskArgs.prompt }],
          },
        ),
      ).rejects.toThrow("실행 할당 충돌");
    }
    await eventHook({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            tool: "task",
            callID: "call-1",
            sessionID: "lifecycle-root",
            state: {
              status: "completed",
              input: firstTaskArgs,
              metadata: { sessionId: "lifecycle-child" },
            },
          },
        },
      },
    });
    await chatHook(
      { sessionID: "lifecycle-child" },
      {
        message: { agent: "planner" },
        parts: [{ type: "text", text: firstTaskArgs.prompt }],
      },
    );
    await beforeHook(
      {
        tool: "Code_Map_search",
        sessionID: "lifecycle-child",
        callID: "mcp-allow",
      },
      { args: {} },
    );
    await expect(
      beforeHook(
        {
          tool: "Code_Map_search",
          sessionID: "lifecycle-root",
          callID: "mcp-root-deny",
        },
        { args: {} },
      ),
    ).rejects.toThrow("MCP 서버 Code.Map 도구 거부");
    await expect(
      beforeHook(
        {
          tool: "code_Map_search",
          sessionID: "lifecycle-child",
          callID: "mcp-case-deny",
        },
        { args: {} },
      ),
    ).rejects.toThrow("분류되지 않은 도구");

    const secondTaskArgs = {
      subagent_type: "planner",
      task_id: "lifecycle-child",
      prompt: [
        "taskId=20260710-hook workItemId=planner-02",
        "Output: .agents/orchestration/20260710-hook/planner-02/plan.md",
        "Input: .agents/orchestration/20260710-hook/planner-01/plan.md",
      ].join("\n"),
    };
    await beforeHook(
      { tool: "task", sessionID: "lifecycle-root", callID: "call-2" },
      { args: secondTaskArgs },
    );
    await eventHook({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            tool: "task",
            callID: "call-2",
            sessionID: "lifecycle-root",
            state: {
              status: "completed",
              input: secondTaskArgs,
              metadata: { sessionId: "lifecycle-child" },
            },
          },
        },
      },
    });
    await beforeHook(
      {
        tool: "read",
        sessionID: "lifecycle-child",
        callID: "history-read",
      },
      {
        args: {
          path: ".agents/orchestration/20260710-hook/planner-01/plan.md",
        },
      },
    );
    await expect(
      beforeHook(
        {
          tool: "edit",
          sessionID: "lifecycle-child",
          callID: "history-write",
        },
        {
          args: {
            path: ".agents/orchestration/20260710-hook/planner-01/plan.md",
          },
        },
      ),
    ).rejects.toThrow("다른 실행 할당의 산출물 쓰기 거부");
    await expect(
      beforeHook(
        {
          tool: "edit",
          sessionID: "lifecycle-child",
          callID: "active-write",
        },
        {
          args: {
            path: ".agents/orchestration/20260710-hook/planner-02/plan.md",
          },
        },
      ),
    ).rejects.toThrow("oldString/newString");
    await expect(
      beforeHook(
        {
          tool: "task",
          sessionID: "lifecycle-root",
          callID: "duplicate-work-item",
        },
        {
          args: {
            subagent_type: "worker",
            prompt: [
              "taskId=20260710-hook workItemId=planner-02",
              "Output: .agents/orchestration/20260710-hook/planner-02/work.md",
            ].join("\n"),
          },
        },
      ),
    ).rejects.toThrow("task 실행 할당/예약 충돌");

    await expect(
      beforeHook(
        {
          tool: "edit",
          sessionID: "lifecycle-root",
          callID: "root-index",
        },
        {
          args: {
            path: ".agents/orchestration/20260710-hook/orchestrator-index/task.md",
          },
        },
      ),
    ).rejects.toThrow("oldString/newString");
    await expect(
      beforeHook(
        {
          tool: "edit",
          sessionID: "lifecycle-root",
          callID: "root-rotation",
        },
        {
          args: {
            path: ".agents/orchestration/20260710-other/orchestrator-index/task.md",
          },
        },
      ),
    ).rejects.toThrow("다른 실행 할당의 산출물 쓰기 거부");

    await eventHook({
      event: {
        type: "session.deleted",
        properties: { info: { id: "lifecycle-child" } },
      },
    });
    await expect(
      eventHook({
        event: {
          type: "message.part.updated",
          properties: {
            part: {
              type: "tool",
              tool: "task",
              callID: "call-2",
              sessionID: "lifecycle-root",
              state: {
                status: "completed",
                input: secondTaskArgs,
                metadata: { sessionId: "lifecycle-child" },
              },
            },
          },
        },
      }),
    ).rejects.toThrow("task lifecycle 상관관계/소유권 충돌");
    await expect(
      beforeHook(
        {
          tool: "task",
          sessionID: "lifecycle-root",
          callID: "deleted-owner-reuse",
        },
        {
          args: {
            subagent_type: "planner",
            prompt: [
              "taskId=20260710-hook workItemId=planner-02",
              "Output: .agents/orchestration/20260710-hook/planner-02/plan.md",
            ].join("\n"),
          },
        },
      ),
    ).rejects.toThrow("task 실행 할당/예약 충돌");
  });
});

describe("config 훅", () => {
  test("default_agent: 빈 config → orchestrator", async () => {
    const hooks = await pluginFactory(stubInput, {});
    const configHook = (hooks as unknown as Record<string, unknown>).config as (
      cfg: Record<string, unknown>,
    ) => Promise<void>;

    const emptyCfg: Record<string, unknown> = {};
    await configHook(emptyCfg);
    expect(emptyCfg.default_agent).toBe("orchestrator");
  });

  test("default_agent: 기존 값 유지 (비파괴적)", async () => {
    const hooks = await pluginFactory(stubInput, {});
    const configHook = (hooks as unknown as Record<string, unknown>).config as (
      cfg: Record<string, unknown>,
    ) => Promise<void>;

    const existingCfg: Record<string, unknown> = { default_agent: "worker" };
    await configHook(existingCfg);
    expect(existingCfg.default_agent).toBe("worker");
  });

  test("agent 레코드 9개 병합 + provider[ollama-cloud] 주입", async () => {
    const hooks = await pluginFactory(stubInput, {});
    const configHook = (hooks as unknown as Record<string, unknown>).config as (
      cfg: Record<string, unknown>,
    ) => Promise<void>;

    const cfg: Record<string, unknown> = {
      mcp: {
        "Code.Map": {
          type: "local",
          command: ["codemap-search", "mcp"],
          enabled: true,
        },
      },
      agent: {
        orchestrator: { permission: { "*": "allow" } },
        worker: { permission: { "Code_Map_*": "deny" } },
      },
    };
    await configHook(cfg);

    expect(typeof cfg.agent).toBe("object");
    expect(cfg.agent).not.toBeNull();
    const configAgent = cfg.agent as Record<string, unknown>;
    expect(Object.keys(configAgent)).toHaveLength(9);
    expect("orchestrator" in configAgent).toBe(true);
    expect("intent-checker" in configAgent).toBe(true);
    const orchestratorConfig = configAgent["orchestrator"] as Record<
      string,
      unknown
    >;
    const intentCheckerConfig = configAgent["intent-checker"] as Record<
      string,
      unknown
    >;
    const workerConfig = configAgent["worker"] as Record<string, unknown>;
    expect(orchestratorConfig.permission).toMatchObject({
      "*": "allow",
      "Code_Map_*": "deny",
    });
    expect(intentCheckerConfig.permission).toMatchObject({
      "Code_Map_*": "deny",
    });
    expect(workerConfig.permission).toMatchObject({
      "Code_Map_*": "allow",
    });
    expect(workerConfig.tools).toMatchObject({ "Code_Map_*": true });
    expect(
      Object.keys(orchestratorConfig.permission as Record<string, unknown>).at(
        -1,
      ),
    ).toBe("Code_Map_*");
    expect(cfg.mcp).toMatchObject({
      "Code.Map": { enabled: true },
    });

    expect(typeof cfg.provider).toBe("object");
    expect(cfg.provider).not.toBeNull();
    const configProvider = cfg.provider as Record<
      string,
      Record<string, unknown>
    >;
    expect(typeof configProvider["ollama-cloud"]).toBe("object");
    expect(configProvider["ollama-cloud"]?.npm).toBe(
      "@ai-sdk/openai-compatible",
    );
    expect(
      "glm-5.2" in
        (configProvider["ollama-cloud"].models as Record<string, unknown>),
    ).toBe(true);

    await expect(
      configHook({
        mcp: {
          "foo.bar": { type: "local", command: ["a"] },
          foo_bar: { type: "local", command: ["b"] },
        },
      }),
    ).rejects.toThrow("MCP 서버 키 정리 충돌");
    await expect(
      configHook({
        mcp: {
          foo: { type: "local", command: ["a"] },
          foo_bar: { type: "local", command: ["b"] },
        },
      }),
    ).rejects.toThrow("MCP 서버 도구 접두사 모호성");
    for (const serverKey of ["list", "read", "apply"]) {
      await expect(
        configHook({
          mcp: {
            [serverKey]: { type: "local", command: ["reserved-collision"] },
          },
        }),
      ).resolves.toBeUndefined();
    }
  });

  test("기존 사용자 provider 설정과 병합 (덮어쓰지 않음)", async () => {
    const hooks = await pluginFactory(stubInput, {});
    const configHook = (hooks as unknown as Record<string, unknown>).config as (
      cfg: Record<string, unknown>,
    ) => Promise<void>;

    const userCfg: Record<string, unknown> = {
      provider: {
        "ollama-cloud": {
          npm: "user-provider",
          options: { baseURL: "https://user.example.test/v1" },
          models: { "ollama-cloud/custom-user-model": { name: "User Model" } },
        },
      },
    };
    await configHook(userCfg);

    const provider = (
      userCfg.provider as Record<string, Record<string, unknown>>
    )["ollama-cloud"];
    expect(provider.npm).toBe("user-provider");
    expect((provider.options as Record<string, unknown>).baseURL).toBe(
      "https://user.example.test/v1",
    );
    expect(
      "glm-5.2" in (provider.models as Record<string, unknown>) &&
        "ollama-cloud/custom-user-model" in
          (provider.models as Record<string, unknown>),
    ).toBe(true);
  });
});

describe("catalog 파생값", () => {
  test("provider config id=ollama-cloud, models에 glm-5.2 포함", () => {
    const provider = buildProviderConfig();
    expect(provider.id).toBe("ollama-cloud");
    expect("glm-5.2" in provider.models).toBe(true);
    expect(provider.models["glm-5.2"]?.id).toBe("glm-5.2");
  });

  test("catalog 모델 6개", () => {
    expect(getCatalogModelIds()).toHaveLength(6);
  });
});

describe("손상된 managed catalog fallback", () => {
  test("bundled catalog로 fallback + 경고 출력", async () => {
    const corruptDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "agents-corrupt-runtime-"),
    );
    const managedCatalogPath = path.join(
      corruptDir,
      ".opencode",
      "agents",
      "catalog.toml",
    );
    fs.mkdirSync(path.dirname(managedCatalogPath), { recursive: true });
    fs.writeFileSync(
      managedCatalogPath,
      'catalogVersion = "broken"\nmodels = "not-an-array"\n',
      "utf-8",
    );

    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) =>
      warnings.push(args.map(String).join(" "));
    try {
      const hooks = await pluginFactory(
        { ...stubInput, directory: corruptDir, worktree: corruptDir },
        {},
      );
      const cfg: Record<string, unknown> = {};
      await hooks.config?.(cfg as never);

      const provider = (
        cfg.provider as Record<string, Record<string, unknown>>
      )?.["ollama-cloud"];
      const models = provider?.models as Record<string, unknown> | undefined;
      expect(models?.["glm-5.2"]).toBeTruthy();
      expect(
        Object.keys((cfg.agent as Record<string, unknown> | undefined) ?? {}),
      ).toHaveLength(9);
      expect(
        warnings.some((line) => line.includes("managed catalog load failed")),
      ).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
    fs.rmSync(corruptDir, { recursive: true, force: true });
  });
});
