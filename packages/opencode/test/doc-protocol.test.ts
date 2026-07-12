/**
 * doc-protocol.test.ts — runDocPath, AGENT_DOC_MAP round-trip
 */

import { describe, test, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { runDocPath, AGENT_DOC_MAP } from "@opencode/core/doc-protocol";

describe("runDocPath", () => {
  test("planner → .agents/orchestration/<taskId>/<workItemId>/plan.md", () => {
    const taskId = "20260702-smoke-roundtrip";
    const workItemId = "planner-01";
    expect(runDocPath(taskId, workItemId, "planner")).toBe(
      `.agents/orchestration/${taskId}/${workItemId}/plan.md`,
    );
  });
});

describe("AGENT_DOC_MAP 왕복 매핑", () => {
  test("planner === 'plan.md'", () => {
    expect(AGENT_DOC_MAP["planner"]).toBe("plan.md");
  });

  test("orchestrator === 'task.md'", () => {
    expect(AGENT_DOC_MAP["orchestrator"]).toBe("task.md");
  });

  test("intent-checker는 문서를 쓰지 않으므로 AGENT_DOC_MAP에 없음", () => {
    expect("intent-checker" in AGENT_DOC_MAP).toBe(false);
  });
});

describe("doc round-trip", () => {
  test("서브에이전트 파일 → 오케스트레이터 task.md 참조 합성", () => {
    const smokeTaskId = "20260702-smoke-roundtrip";
    const plannerWorkItemId = "planner-01";
    const orchestratorWorkItemId = "orchestrator-index";

    const smokeRunDir = path.join(".agents", "orchestration", smokeTaskId);

    const plannerDocPath = runDocPath(
      smokeTaskId,
      plannerWorkItemId,
      "planner",
    );
    fs.mkdirSync(path.dirname(plannerDocPath), { recursive: true });
    const plannerContent = `# plan.md — round-trip test\n\ntaskId: ${smokeTaskId}\nPlanned 2 files to change.\n`;
    fs.writeFileSync(plannerDocPath, plannerContent, "utf-8");

    expect(fs.existsSync(plannerDocPath)).toBe(true);
    expect(fs.readFileSync(plannerDocPath, "utf-8")).toContain(smokeTaskId);

    const orchestratorDocPath = runDocPath(
      smokeTaskId,
      orchestratorWorkItemId,
      "orchestrator",
    );
    fs.mkdirSync(path.dirname(orchestratorDocPath), { recursive: true });
    const taskMdContent = `# task.md — orchestrator index\n\ntaskId: ${smokeTaskId}\n\n## References\n- plan: ${plannerDocPath}\n`;
    fs.writeFileSync(orchestratorDocPath, taskMdContent, "utf-8");

    expect(fs.existsSync(orchestratorDocPath)).toBe(true);
    expect(fs.readFileSync(orchestratorDocPath, "utf-8")).toContain(
      plannerDocPath,
    );

    fs.rmSync(smokeRunDir, { recursive: true, force: true });
    expect(fs.existsSync(smokeRunDir)).toBe(false);
  });
});
