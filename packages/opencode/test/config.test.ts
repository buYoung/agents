/**
 * config.test.ts — loadPluginConfig + applyAgentOverrides
 */

import { describe, test, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadPluginConfig, applyAgentOverrides } from "@opencode/core/config";
import {
  getCatalogModelIds,
  getReasoningEffortsByModel,
} from "@opencode/core/catalog";
import type { AgentDefinition } from "@opencode/core/types";

function writeProjectToml(dir: string, content: string): string {
  const opencodeDir = path.join(dir, ".opencode");
  fs.mkdirSync(opencodeDir, { recursive: true });
  const filePath = path.join(opencodeDir, "agents.toml");
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

const fakeAgents: Record<string, AgentDefinition> = Object.fromEntries(
  [
    "orchestrator",
    "intent-checker",
    "worker",
    "planner",
    "research",
    "explore",
    "ideator",
    "adversarial-review",
    "constructive-feedback",
  ].map((name) => [
    name,
    {
      name,
      mode: name === "orchestrator" ? "primary" : "subagent",
      model: "ollama-cloud/kimi-k2.6",
      prompt: `${name} base prompt`,
    } satisfies AgentDefinition,
  ]),
);

describe("loadPluginConfig + applyAgentOverrides 기본", () => {
  test("explore 모델 오버라이드 + reasoning_effort, ideator 비활성화, planner prompt_append", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-cfg-"));
    writeProjectToml(
      tempDir,
      [
        "[agents.explore]",
        'model = "ollama-cloud/deepseek-v4-pro"',
        'reasoning_effort = "high"',
        "",
        "[agents.ideator]",
        "enable = false",
        "",
        "[agents.planner]",
        'prompt_append = "TEST_APPEND_MARKER_42"',
      ].join("\n"),
    );

    const loaded = loadPluginConfig(tempDir, { silent: true });
    expect(loaded.agents?.["explore"]?.model).toBe(
      "ollama-cloud/deepseek-v4-pro",
    );
    expect(loaded.agents?.["ideator"]?.enable).toBe(false);

    const { record, disabledNames } = applyAgentOverrides(fakeAgents, loaded);

    expect("ideator" in record).toBe(false);
    expect(disabledNames).toContain("ideator");

    expect(record["explore"]?.model).toBe("ollama-cloud/deepseek-v4-pro");
    const exploreOptions = record["explore"]?.options as
      | { extraBody?: { reasoning_effort?: string } }
      | undefined;
    expect(exploreOptions?.extraBody?.reasoning_effort).toBe("high");

    // orchestrator는 변경 없음
    expect(record["orchestrator"]?.model).toBe("ollama-cloud/kimi-k2.6");
    // ideator 제외 8개
    expect(Object.keys(record)).toHaveLength(8);

    // prompt_append
    expect(record["planner"]?.prompt).toContain("TEST_APPEND_MARKER_42");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("preset 해소", () => {
  test("케이스A: root가 preset보다 우선", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-preset-a-"));
    writeProjectToml(
      tempDir,
      [
        'preset = "fast"',
        "",
        "[presets.fast.explore]",
        'model = "ollama-cloud/deepseek-v4-pro"',
        "",
        "[agents.explore]",
        'model = "ollama-cloud/kimi-k2.6"',
      ].join("\n"),
    );
    const config = loadPluginConfig(tempDir, { silent: true });
    expect(config.agents?.["explore"]?.model).toBe("ollama-cloud/kimi-k2.6");
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("케이스B: root 없으면 preset 적용", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-preset-b-"));
    writeProjectToml(
      tempDir,
      [
        'preset = "fast"',
        "",
        "[presets.fast.explore]",
        'model = "ollama-cloud/deepseek-v4-pro"',
      ].join("\n"),
    );
    const config = loadPluginConfig(tempDir, { silent: true });
    expect(config.agents?.["explore"]?.model).toBe(
      "ollama-cloud/deepseek-v4-pro",
    );
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("reasoning_effort 허용값 검증", () => {
  test("미지원 모델(kimi-k2.6)에 reasoning_effort → 무시, model은 적용", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-kimi-"));
    writeProjectToml(
      tempDir,
      [
        "[agents.worker]",
        'model = "ollama-cloud/kimi-k2.6"',
        'reasoning_effort = "high"',
      ].join("\n"),
    );
    const config = loadPluginConfig(tempDir, { silent: true });
    const { record } = applyAgentOverrides(fakeAgents, config);
    const options = record["worker"]?.options as
      | { extraBody?: { reasoning_effort?: string } }
      | undefined;
    expect(options?.extraBody?.reasoning_effort).toBeUndefined();
    expect(record["worker"]?.model).toBe("ollama-cloud/kimi-k2.6");
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("deepseek-v4-pro에 low(허용 아님) → 무시 / glm-5.2에 high → 적용 / deepseek-v4-flash에 none → 적용 / minimax-m3에 high → 무시", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-effort-"));
    writeProjectToml(
      tempDir,
      [
        "[agents.worker]",
        'model = "ollama-cloud/deepseek-v4-pro"',
        'reasoning_effort = "low"',
        "",
        "[agents.adversarial-review]",
        'model = "ollama-cloud/glm-5.2"',
        'reasoning_effort = "high"',
        "",
        "[agents.research]",
        'model = "ollama-cloud/deepseek-v4-flash"',
        'reasoning_effort = "none"',
        "",
        "[agents.planner]",
        'model = "ollama-cloud/deepseek-v4-flash"',
        'reasoning_effort = "high"',
        "",
        "[agents.ideator]",
        'model = "ollama-cloud/minimax-m3"',
        'reasoning_effort = "high"',
      ].join("\n"),
    );
    const config = loadPluginConfig(tempDir, { silent: true });
    const { record } = applyAgentOverrides(fakeAgents, config);

    const dsOptions = record["worker"]?.options as
      | { extraBody?: { reasoning_effort?: string } }
      | undefined;
    expect(dsOptions?.extraBody?.reasoning_effort).toBeUndefined();

    const glmOptions = record["adversarial-review"]?.options as
      | { extraBody?: { reasoning_effort?: string } }
      | undefined;
    expect(glmOptions?.extraBody?.reasoning_effort).toBe("high");

    const flashOptions = record["research"]?.options as
      | { extraBody?: { reasoning_effort?: string } }
      | undefined;
    expect(flashOptions?.extraBody?.reasoning_effort).toBe("none");

    const flashHighOptions = record["planner"]?.options as
      | { extraBody?: { reasoning_effort?: string } }
      | undefined;
    expect(flashHighOptions?.extraBody?.reasoning_effort).toBe("high");

    const minimaxOptions = record["ideator"]?.options as
      | { extraBody?: { reasoning_effort?: string } }
      | undefined;
    expect(minimaxOptions?.extraBody?.reasoning_effort).toBeUndefined();

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("catalog 검증", () => {
  test("모델 6개 / reasoning_efforts 파생값", () => {
    expect(getCatalogModelIds()).toHaveLength(6);
    const efforts = getReasoningEffortsByModel();
    expect(efforts["ollama-cloud/glm-5.2"]?.includes("high")).toBe(true);
    expect(efforts["ollama-cloud/kimi-k2.6"]?.length).toBe(0);
  });

  test("catalog에 없는 model id → invalid-model 경고", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-invalid-"));
    writeProjectToml(
      tempDir,
      ["[agents.worker]", 'model = "ollama-cloud/not-in-catalog"'].join("\n"),
    );
    const warnings: string[] = [];
    const config = loadPluginConfig(tempDir, {
      silent: true,
      onWarning: (w) => warnings.push(w.kind),
    });
    expect(warnings).toContain("invalid-model");
    expect(config.agents?.["worker"]).toBeUndefined();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("오버라이드 없는 경우", () => {
  test("설정 없는 디렉터리 → 빈 설정 → 9개 에이전트 유지, 비활성화 0개", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-empty-"));
    const config = loadPluginConfig(emptyDir, { silent: true });
    expect(config).toBeTypeOf("object");
    expect(config).not.toBeNull();

    const { record, disabledNames } = applyAgentOverrides(fakeAgents, config);
    expect(Object.keys(record)).toHaveLength(9);
    expect(disabledNames).toHaveLength(0);

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
