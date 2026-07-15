/**
 * Runs real `codex exec` smoke evaluations against copied Codex custom agents.
 *
 * This is intentionally separate from `pnpm test`: it requires Codex auth,
 * network/model access, and spends model tokens.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const packageRoot = process.cwd();
const repositoryRoot = path.resolve(packageRoot, "../..");
const userCodexHome = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
const agentsSourceDirectory = path.join(packageRoot, "agents");
const orchestratorSkillSourceDirectory = path.join(
    packageRoot,
    "skills",
    "codex-orchestrator",
);
const fixturePath = path.join(
    packageRoot,
    "evals",
    "agent-prompts",
    "fixtures.md",
);
const defaultTimeoutSeconds = 240;
const defaultConcurrency = 3;
const smokePermissionProfileName = "exec-smoke";
const smokePermissionProfile = `default_permissions = "orchestration-artifacts"

[permissions.orchestration-artifacts]
extends = ":workspace"

[permissions.orchestration-artifacts.filesystem.":workspace_roots"]
".agents/orchestration" = "write"
`;
const smokeRunDate = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const defaultFixtureByAgent = {
  "intent-checker": "intent-checker-normal-001",
  worker: "worker-normal-001",
  planner: "planner-normal-001",
  research: "research-normal-001",
  "code-explorer": "explore-normal-001",
  "idea-generator": "idea-generator-normal-001",
  "adversarial-review": "adversarial-review-normal-001",
  "constructive-feedback": "constructive-feedback-normal-001",
};

const artifactFileByAgent = {
  worker: "work.md",
  planner: "plan.md",
  research: "research.md",
  "code-explorer": "explore.md",
  "idea-generator": "ideas.md",
  "adversarial-review": "adversarial-review.md",
  "constructive-feedback": "constructive-feedback.md",
};

function buildExecutionContract({ agent, caseName, fixture }) {
  const taskId = `${smokeRunDate}-${fixture}`;
  const artifactFile = artifactFileByAgent[agent];
  if (!artifactFile) {
    return { taskId, workItemId: null, outputPath: null };
  }
  const workItemId = `${agent}-${caseName}-smoke`;
  const outputParentPath = `.agents/orchestration/${taskId}/${workItemId}`;
  return {
    taskId,
    workItemId,
    outputParentPath,
    outputPath: `${outputParentPath}/${artifactFile}`,
  };
}

function readAgentNames() {
  return fs
      .readdirSync(agentsSourceDirectory)
      .filter((fileName) => fileName.endsWith(".toml"))
      .map((fileName) => path.basename(fileName, ".toml"))
      .sort();
}

function splitMarkdownTableRow(line) {
  return line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
}

function readFixtureInput(fixtureId) {
  const content = fs.readFileSync(fixturePath, "utf-8");
  for (const line of content.split("\n")) {
    if (!line.startsWith("| `")) continue;
    const cells = splitMarkdownTableRow(line);
    const id = cells[0]?.replace(/^`|`$/g, "");
    if (id === fixtureId) {
      return cells[2];
    }
  }
  throw new Error(`Fixture not found: ${fixtureId}`);
}

function buildPrompt({
  agent,
  caseName,
  executionContract,
  fixture,
  fixtureInput,
}) {
  const mcpInstruction =
            caseName === "mcp"
                ? "codemap-search MCP is intentionally available in this run. If repository navigation is relevant, the subagent should use codemap-search MCP tools rather than shelling out to a same-named executable."
                : "codemap-search MCP is intentionally unavailable in this run. The subagent must not try to run a same-named codemap-search executable through shell; it should use the ordinary available tools instead.";

  const artifactInstructions = executionContract.outputPath
      ? [
        `Use workItemId: ${executionContract.workItemId}`,
        `Exact required role artifact path: ${executionContract.outputPath}`,
        `The root spawn message must pass taskId ${executionContract.taskId}, workItemId ${executionContract.workItemId}, and that exact output path.`,
        `Before spawn_agent, validate that taskId, workItemId, and the output path resolve to the exact parent ${executionContract.outputParentPath}.`,
        `Run exactly \`mkdir -p ${executionContract.outputParentPath}\` as the final tool action before spawn_agent, and do not ask the child to create or check its parent directory.`,
        "If that mkdir fails, do not spawn the child or use an alternate path.",
      ]
      : ["This stateless role has no workItemId or artifact output path."];

  return [
    `Run a Codex custom-agent smoke evaluation for agent "${agent}".`,
    `Case: ${caseName}`,
    `Fixture id: ${fixture}`,
    `Use taskId: ${executionContract.taskId}`,
    ...artifactInstructions,
    "",
    "Spawn the requested custom subagent, wait for it to finish, close it, and return a concise result summary.",
    `The spawn_agent call must set agent_type exactly to "${agent}". Do not omit agent_type and do not use any fallback agent type.`,
    'The spawn_agent call must set fork_turns exactly to "none".',
    `When delegating, pass taskId: ${executionContract.taskId} and the exact execution contract above to the custom subagent.`,
    "Do not solve the fixture in the root session except for delegating it to that custom agent.",
    "If the custom agent is unavailable, say so explicitly and fail the smoke evaluation.",
    mcpInstruction,
    "",
    "Use this exact evaluation input as the subagent task:",
    fixtureInput,
  ].join("\n");
}


export {
  agentsSourceDirectory,
  artifactFileByAgent,
  buildExecutionContract,
  buildPrompt,
  defaultConcurrency,
  defaultFixtureByAgent,
  defaultTimeoutSeconds,
  fixturePath,
  orchestratorSkillSourceDirectory,
  packageRoot,
  readAgentNames,
  readFixtureInput,
  repositoryRoot,
  smokePermissionProfile,
  smokePermissionProfileName,
  userCodexHome,
};
