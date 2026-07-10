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
        "The task call must already contain taskId, workItemId, and the exact output path",
      ],
      [
        "unique workItemId per execution",
        "Allocate a unique kebab-case workItemId for every artifact-writing delegation",
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

  test("훅 존재: config, tool.execute.before, chat.message, event", async () => {
    const hooks = await pluginFactory(stubInput, {});
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

    const cfg: Record<string, unknown> = {};
    await configHook(cfg);

    expect(typeof cfg.agent).toBe("object");
    expect(cfg.agent).not.toBeNull();
    const configAgent = cfg.agent as Record<string, unknown>;
    expect(Object.keys(configAgent)).toHaveLength(9);
    expect("orchestrator" in configAgent).toBe(true);
    expect("intent-checker" in configAgent).toBe(true);

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
