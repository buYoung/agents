import { afterEach, describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { executeLifecycle } from "@cli/lifecycle/orchestrator";

const claudeAgentNames = [
  "adversarial-review",
  "code-explorer",
  "constructive-feedback",
  "idea-generator",
  "intent-checker",
  "planner",
  "research",
  "worker",
];
const claudeAgentModels: Record<string, string> = {
  "adversarial-review": "claude-opus-4-8",
  "code-explorer": "claude-sonnet-5",
  "constructive-feedback": "claude-sonnet-5",
  "idea-generator": "claude-sonnet-5",
  "intent-checker": "claude-sonnet-5",
  "planner": "claude-opus-4-8",
  "research": "claude-sonnet-5",
  "worker": "claude-sonnet-5",
};

describe("Claude Code 수명주기 artifact 전파", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("caller artifact/env를 최종 CLAUDE_CONFIG_DIR 및 state와 안전한 uninstall까지 보존한다", () => {
    const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "agents-claude-project-"));
    const claudeConfigDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "agents-claude-config-"));
    const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "agents-claude-state-"));
    temporaryDirectories.push(projectDirectory, claudeConfigDirectory, stateDirectory);
    const sourceRoot = path.resolve(process.cwd(), "..", "..", "packages", "claude-code");
    const environment = {
      ...process.env,
      AGENTS_CLAUDE_CODE_ARTIFACT_ROOT: sourceRoot,
      CLAUDE_CONFIG_DIR: claudeConfigDirectory,
      XDG_STATE_HOME: stateDirectory,
    };
    const unrelatedPath = path.join(claudeConfigDirectory, "agents", "user-owned.md");
    fs.mkdirSync(path.dirname(unrelatedPath), { recursive: true });
    fs.writeFileSync(unrelatedPath, "# user-owned\n", "utf8");

    const installation = executeLifecycle(["claude-code"], "install", projectDirectory, environment);
    expect(installation[0]?.target).toBe("claude-code");
    expect(environment.CLAUDE_CONFIG_DIR).toBe(claudeConfigDirectory);
    expect(environment.AGENTS_CLAUDE_CODE_ARTIFACT_ROOT).toBe(sourceRoot);

    const expectedRelativePaths = [
      "agents/versions.json",
      ...claudeAgentNames.map((name) => `agents/${name}.md`),
      "skills/claude-code-orchestrator/SKILL.md",
    ];
    for (const relativePath of expectedRelativePaths) {
      expect(fs.readFileSync(path.join(claudeConfigDirectory, relativePath), "utf8")).toBe(
        fs.readFileSync(path.join(sourceRoot, relativePath), "utf8"),
      );
    }
    for (const [name, model] of Object.entries(claudeAgentModels)) {
      expect(fs.readFileSync(path.join(claudeConfigDirectory, "agents", `${name}.md`), "utf8")).toContain(`model: ${model}`);
    }
    const state = JSON.parse(
      fs.readFileSync(path.join(claudeConfigDirectory, ".agents-lifecycle", "claude-code.json"), "utf8"),
    ) as { schemaVersion: number; target: string; version: string; files: Array<{ path: string }> };
    expect(state.schemaVersion).toBe(2);
    expect(state.target).toBe("claude-code");
    expect(state.version).toBe("0.1.2");
    expect(state.files.map((file) => file.path)).toHaveLength(expectedRelativePaths.length);
    expect(fs.readFileSync(unrelatedPath, "utf8")).toBe("# user-owned\n");

    const modifiedManagedPath = path.join(claudeConfigDirectory, "agents", "worker.md");
    fs.appendFileSync(modifiedManagedPath, "\n# user modification\n", "utf8");
    executeLifecycle(["claude-code"], "uninstall", projectDirectory, environment);
    expect(fs.existsSync(unrelatedPath)).toBe(true);
    expect(fs.existsSync(modifiedManagedPath)).toBe(true);
    expect(fs.existsSync(path.join(claudeConfigDirectory, "agents", "planner.md"))).toBe(false);
    expect(fs.existsSync(path.join(claudeConfigDirectory, ".agents-lifecycle", "claude-code.json"))).toBe(false);
  });
});
