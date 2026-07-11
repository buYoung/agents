/**
 * Runs real `codex exec` smoke evaluations against copied Codex custom agents.
 *
 * This is intentionally separate from `pnpm test`: it requires Codex auth,
 * network/model access, and spends model tokens.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const packageRoot = process.cwd();
const repositoryRoot = path.resolve(packageRoot, "../..");
const userCodexHome = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
const agentsSourceDirectory = path.join(packageRoot, "agents");
const fixturePath = path.join(
  packageRoot,
  "evals",
  "agent-prompts",
  "fixtures.md",
);
const defaultTimeoutSeconds = 240;
const defaultConcurrency = 3;
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
  return {
    taskId,
    workItemId,
    outputPath: `.agents/${taskId}/${workItemId}/${artifactFile}`,
  };
}

function readAgentNames() {
  return fs
    .readdirSync(agentsSourceDirectory)
    .filter((fileName) => fileName.endsWith(".toml"))
    .map((fileName) => path.basename(fileName, ".toml"))
    .sort();
}

function parseArgs(argv) {
  const options = {
    agent: undefined,
    caseName: "no-mcp",
    caseNameSpecified: false,
    concurrency: defaultConcurrency,
    fixture: undefined,
    flow: "single",
    keepWorkspace: false,
    timeoutSeconds: defaultTimeoutSeconds,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--agent") {
      options.agent = argv[++index];
    } else if (arg === "--case") {
      options.caseName = argv[++index];
      options.caseNameSpecified = true;
    } else if (arg === "--concurrency") {
      options.concurrency = Number(argv[++index]);
    } else if (arg === "--fixture") {
      options.fixture = argv[++index];
    } else if (arg === "--flow") {
      options.flow = argv[++index];
    } else if (arg === "--all-agents") {
      options.flow = "individual";
    } else if (arg === "--timeout-sec") {
      options.timeoutSeconds = Number(argv[++index]);
    } else if (arg === "--keep-workspace") {
      options.keepWorkspace = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["single", "individual"].includes(options.flow)) {
    throw new Error(`Unknown flow: ${options.flow}`);
  }
  if (!["no-mcp", "mcp", "both"].includes(options.caseName)) {
    throw new Error(`Unknown case: ${options.caseName}`);
  }
  if (!Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds <= 0) {
    throw new Error(`Invalid timeout: ${options.timeoutSeconds}`);
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency <= 0) {
    throw new Error(`Invalid concurrency: ${options.concurrency}`);
  }
  if (options.agent && options.flow !== "single") {
    throw new Error("--agent can only be used with --flow single");
  }
  if (options.fixture && options.flow !== "single") {
    throw new Error("--fixture can only be used with --flow single");
  }

  if (options.flow === "single") {
    options.agent ??= "code-explorer";
    options.fixture ??= defaultFixtureByAgent[options.agent];
    if (!options.fixture) {
      throw new Error(`No default fixture for agent: ${options.agent}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: pnpm --filter codex test:exec-smoke -- [options]

Options:
  --flow <name>        single or individual. Default: single
  --all-agents         Alias for --flow individual
  --agent <name>       Custom agent for single flow. Default: code-explorer
  --case <name>        no-mcp, mcp, or both. Default: no-mcp
  --fixture <id>       Fixture id from evals/agent-prompts/fixtures.md
  --timeout-sec <n>    Per-case timeout in seconds. Default: 240
  --concurrency <n>    Individual-agent concurrency. Default: 3
  --keep-workspace     Keep temporary workspaces for inspection

Flows:
  single        Run one agent with --case no-mcp, mcp, or both.
  individual    Run every leaf custom agent, 3 at a time:
                code-explorer uses mcp; all others use no-mcp.
`);
}

function copyDirectory(sourceDirectory, targetDirectory) {
  fs.mkdirSync(targetDirectory, { recursive: true });
  for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(targetDirectory, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function copyFileIfExists(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) return;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function prepareCodexHome(temporaryCodexHome) {
  fs.mkdirSync(temporaryCodexHome, { recursive: true });
  copyFileIfExists(
    path.join(userCodexHome, "auth.json"),
    path.join(temporaryCodexHome, "auth.json"),
  );
  copyFileIfExists(
    path.join(userCodexHome, "config.toml"),
    path.join(temporaryCodexHome, "config.toml"),
  );
  copyFileIfExists(
    path.join(userCodexHome, "models_cache.json"),
    path.join(temporaryCodexHome, "models_cache.json"),
  );
  copyDirectory(agentsSourceDirectory, path.join(temporaryCodexHome, "agents"));
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
    `When delegating, pass taskId: ${executionContract.taskId} and the exact execution contract above to the custom subagent.`,
    "Do not solve the fixture in the root session except for delegating it to that custom agent.",
    "If the custom agent is unavailable, say so explicitly and fail the smoke evaluation.",
    mcpInstruction,
    "",
    "Use this exact evaluation input as the subagent task:",
    fixtureInput,
  ].join("\n");
}

function getTargetThreadIds(argumentsObject, item = {}) {
  const candidateValues = [
    argumentsObject?.ids,
    argumentsObject?.thread_ids,
    argumentsObject?.threadIds,
    argumentsObject?.agent_ids,
    argumentsObject?.agentIds,
    argumentsObject?.id,
    argumentsObject?.thread_id,
    argumentsObject?.threadId,
    item.receiver_thread_ids,
  ];
  const threadIds = new Set();
  for (const candidateValue of candidateValues) {
    if (Array.isArray(candidateValue)) {
      for (const threadId of candidateValue) {
        if (typeof threadId === "string") threadIds.add(threadId);
      }
    } else if (typeof candidateValue === "string") {
      threadIds.add(candidateValue);
    }
  }
  return [...threadIds];
}

function callsTargetThread(calls, threadId) {
  return calls.some((call) => call.targetThreadIds?.includes(threadId));
}

function spawnMessageContainsExecutionContract(spawnCall, executionContract) {
  if (!executionContract.outputPath) return true;
  if (typeof spawnCall?.message !== "string") return false;
  return [
    executionContract.taskId,
    executionContract.workItemId,
    executionContract.outputPath,
  ].every((value) => spawnCall.message.includes(value));
}

function summarizeJsonl(stdout) {
  let usage = null;
  const messages = [];
  const parseErrors = [];
  const spawnedAgentThreadIds = new Set();
  const spawnCalls = [];
  const closeAgentCalls = [];
  const waitCalls = [];
  let closeAgentEventCount = 0;
  let codemapToolEventCount = 0;
  let spawnAgentEventCount = 0;
  let waitEventCount = 0;

  for (const [lineIndex, line] of stdout.split("\n").entries()) {
    if (!line.trim().startsWith("{")) continue;

    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      parseErrors.push({ line: lineIndex + 1, error: error.message });
      continue;
    }

    const payload = event.payload ?? {};
    const item = event.item ?? payload.item ?? payload;
    const toolName = String(item.tool ?? item.name ?? item.server ?? "");
    if (toolName.includes("codemap")) {
      codemapToolEventCount += 1;
    }
    if (toolName === "spawn_agent") {
      spawnAgentEventCount += 1;
      let argumentsObject = null;
      if (typeof item.arguments === "string") {
        try {
          argumentsObject = JSON.parse(item.arguments);
        } catch {
          argumentsObject = null;
        }
      } else if (item.arguments && typeof item.arguments === "object") {
        argumentsObject = item.arguments;
      }
      spawnCalls.push({
        line: lineIndex + 1,
        agentType: argumentsObject?.agent_type ?? null,
        message: argumentsObject?.message ?? item.prompt ?? null,
        receiverThreadIds: item.receiver_thread_ids ?? [],
      });
      for (const threadId of item.receiver_thread_ids ?? []) {
        spawnedAgentThreadIds.add(threadId);
      }
    }
    if (toolName === "wait" || toolName === "wait_agent") {
      waitEventCount += 1;
      let argumentsObject = null;
      if (typeof item.arguments === "string") {
        try {
          argumentsObject = JSON.parse(item.arguments);
        } catch {
          argumentsObject = null;
        }
      } else if (item.arguments && typeof item.arguments === "object") {
        argumentsObject = item.arguments;
      }
      waitCalls.push({
        line: lineIndex + 1,
        targetThreadIds: getTargetThreadIds(argumentsObject, item),
      });
    }
    if (toolName === "close_agent") {
      closeAgentEventCount += 1;
      let argumentsObject = null;
      if (typeof item.arguments === "string") {
        try {
          argumentsObject = JSON.parse(item.arguments);
        } catch {
          argumentsObject = null;
        }
      } else if (item.arguments && typeof item.arguments === "object") {
        argumentsObject = item.arguments;
      }
      closeAgentCalls.push({
        line: lineIndex + 1,
        targetThreadIds: getTargetThreadIds(argumentsObject, item),
      });
    }
    if (event.type === "turn.completed" || payload.type === "turn_completed") {
      usage = event.usage ?? payload.usage ?? usage;
    }
    if (
      (event.type === "item.completed" && event.item?.type === "agent_message") ||
      (event.type === "event_msg" && payload.type === "agent_message")
    ) {
      messages.push(event.item?.text ?? payload.message ?? "");
    }
    if (event.type === "response_item" && payload.type === "message") {
      for (const contentItem of payload.content ?? []) {
        if (contentItem.type === "output_text") {
          messages.push(contentItem.text ?? "");
        }
      }
    }
  }

  return {
    usage,
    finalMessage: messages.at(-1) ?? "",
    messageCount: messages.length,
    codemapToolEventCount,
    spawnAgentEventCount,
    spawnCalls,
    waitCalls,
    closeAgentCalls,
    spawnedAgentThreadCount: spawnedAgentThreadIds.size,
    waitEventCount,
    closeAgentEventCount,
    parseErrorCount: parseErrors.length,
    parseErrors,
  };
}

function listJsonlFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsonlFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

function summarizeSessionHistory(temporaryCodexHome) {
  const sessionDirectory = path.join(temporaryCodexHome, "sessions");
  const sessionFiles = listJsonlFiles(sessionDirectory);
  const sessionSummaries = [];
  let codemapMcpToolCallEventCount = 0;
  let mcpToolCallEventCount = 0;
  let sessionParseErrorCount = 0;

  for (const sessionPath of sessionFiles) {
    const toolCalls = [];
    const messages = [];
    let metadata = null;
    let terminalEventCount = 0;

    for (const [lineIndex, line] of fs
      .readFileSync(sessionPath, "utf-8")
      .split("\n")
      .entries()) {
      if (!line.trim().startsWith("{")) continue;

      let event;
      try {
        event = JSON.parse(line);
      } catch {
        sessionParseErrorCount += 1;
        continue;
      }

      if (event.type === "session_meta") {
        metadata = event.payload;
      }

      const payload = event.payload ?? {};
      const item = payload.item ?? {};
      if (
        event.type === "turn.completed" ||
        payload.type === "turn_completed" ||
        payload.type === "task_complete"
      ) {
        terminalEventCount += 1;
      }
      if (
        (event.type === "item.completed" &&
          event.item?.type === "agent_message") ||
        (event.type === "event_msg" && payload.type === "agent_message")
      ) {
        messages.push(event.item?.text ?? payload.message ?? "");
      }
      if (event.type === "response_item" && payload.type === "message") {
        for (const contentItem of payload.content ?? []) {
          if (contentItem.type === "output_text") {
            messages.push(contentItem.text ?? "");
          }
        }
      }
      const toolName = item.tool ?? item.name ?? payload.tool ?? payload.name;
      if (toolName) {
        let argumentsObject = null;
        const rawArguments = item.arguments ?? payload.arguments;
        if (typeof rawArguments === "string") {
          try {
            argumentsObject = JSON.parse(rawArguments);
          } catch {
            argumentsObject = null;
          }
        } else if (rawArguments && typeof rawArguments === "object") {
          argumentsObject = rawArguments;
        }
        toolCalls.push({
          line: lineIndex + 1,
          type: event.type,
          tool: toolName,
          namespace: payload.namespace ?? item.namespace ?? null,
          agentType: argumentsObject?.agent_type ?? null,
          message: argumentsObject?.message ?? item.prompt ?? null,
          receiverThreadIds: item.receiver_thread_ids ?? [],
          targetThreadIds: getTargetThreadIds(argumentsObject, item),
        });
      }

      if (payload.type === "mcp_tool_call_end") {
        mcpToolCallEventCount += 1;
        const invocation = payload.invocation ?? {};
        toolCalls.push({
          line: lineIndex + 1,
          type: payload.type,
          server: invocation.server ?? null,
          tool: invocation.tool ?? null,
        });
        if (invocation.server === "codemap-search") {
          codemapMcpToolCallEventCount += 1;
        }
      }
    }

    sessionSummaries.push({
      sessionPath,
      sessionId: metadata?.id ?? null,
      parentThreadId: metadata?.parent_thread_id ?? null,
      threadSource: metadata?.thread_source ?? null,
      agentRole: metadata?.agent_role ?? null,
      agentNickname: metadata?.agent_nickname ?? null,
      source: metadata?.source ?? null,
      finalMessage: messages.at(-1) ?? "",
      terminalEventCount,
      toolCalls,
    });
  }

  return {
    sessionFileCount: sessionFiles.length,
    sessionParseErrorCount,
    mcpToolCallEventCount,
    codemapMcpToolCallEventCount,
    sessionSummaries,
  };
}

function prepareWorkspace(temporaryWorkspace) {
  fs.copyFileSync(
    path.join(repositoryRoot, "AGENTS.md"),
    path.join(temporaryWorkspace, "AGENTS.md"),
  );
  copyDirectory(
    agentsSourceDirectory,
    path.join(temporaryWorkspace, ".codex", "agents"),
  );
  fs.copyFileSync(fixturePath, path.join(temporaryWorkspace, "fixtures.md"));
  copyDirectory(
    path.join(repositoryRoot, "packages", "opencode", "src"),
    path.join(temporaryWorkspace, "packages", "opencode", "src"),
  );
  copyDirectory(
    path.join(repositoryRoot, "packages", "codex", "agents"),
    path.join(temporaryWorkspace, "packages", "codex", "agents"),
  );
  fs.mkdirSync(path.join(temporaryWorkspace, ".agents"), { recursive: true });
}

function codexExecArgs({ caseName, prompt, temporaryWorkspace }) {
  const args = [
    "exec",
    "--ephemeral",
    "--json",
    "--color",
    "never",
    "--sandbox",
    "workspace-write",
    "--skip-git-repo-check",
    "--cd",
    temporaryWorkspace,
    "-c",
    "suppress_unstable_features_warning=true",
  ];

  if (caseName === "no-mcp") {
    args.push(
      "-c",
      'mcp_servers.codemap_search.command="codemap-search"',
      "-c",
      'mcp_servers.codemap_search.args=["mcp"]',
      "-c",
      "mcp_servers.codemap_search.enabled=false",
      "-c",
      'mcp_servers."codemap-search".command="codemap-search"',
      "-c",
      'mcp_servers."codemap-search".args=["mcp"]',
      "-c",
      'mcp_servers."codemap-search".enabled=false',
    );
  } else if (caseName === "mcp") {
    args.push(
      "-c",
      'mcp_servers.codemap_search.command="codemap-search"',
      "-c",
      'mcp_servers.codemap_search.args=["mcp"]',
      "-c",
      "mcp_servers.codemap_search.startup_timeout_sec=20",
      "-c",
      "mcp_servers.codemap_search.tool_timeout_sec=60",
      "-c",
      "mcp_servers.codemap_search.required=true",
    );
  }

  args.push(prompt);
  return args;
}

function runCodexExec({ args, cwd, env, timeoutSeconds }) {
  return new Promise((resolve) => {
    const child = spawn("codex", args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 5000).unref();
    }, timeoutSeconds * 1000);

    child.on("error", (error) => {
      clearTimeout(timeout);
      settled = true;
      resolve({
        stdout,
        stderr: `${stderr}${stderr ? "\n" : ""}${error.stack ?? error.message}`,
        exitCode: null,
        signal: null,
        timedOut,
        spawnError: error.message,
      });
    });

    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      settled = true;
      resolve({ stdout, stderr, exitCode, signal, timedOut });
    });
  });
}

async function runCase({
  agent,
  caseName,
  fixture,
  flowName,
  outputDirectory,
  options,
  runId,
}) {
  const temporaryWorkspace = fs.mkdtempSync(
    path.join(os.tmpdir(), `codex-exec-smoke-${caseName}-${agent}-`),
  );
  const temporaryCodexHome = fs.mkdtempSync(
    path.join(os.tmpdir(), `codex-exec-home-${caseName}-${agent}-`),
  );
  const runOutputDirectory = path.join(
    outputDirectory,
    `${caseName}-${agent}-${fixture}`,
  );
  fs.mkdirSync(runOutputDirectory, { recursive: true });

  const fixtureInput = readFixtureInput(fixture);
  const executionContract = buildExecutionContract({ agent, caseName, fixture });
  const prompt = buildPrompt({
    agent,
    caseName,
    executionContract,
    fixture,
    fixtureInput,
  });

  try {
    prepareCodexHome(temporaryCodexHome);
    prepareWorkspace(temporaryWorkspace);
    const artifactAbsolutePath = executionContract.outputPath
      ? path.join(temporaryWorkspace, executionContract.outputPath)
      : null;
    if (artifactAbsolutePath) {
      fs.mkdirSync(path.dirname(artifactAbsolutePath), { recursive: true });
    }
    fs.writeFileSync(path.join(runOutputDirectory, "prompt.txt"), prompt, "utf-8");

    const startedAt = new Date().toISOString();
    const startedAtHrtime = process.hrtime.bigint();
    const result = await runCodexExec({
      args: codexExecArgs({ caseName, prompt, temporaryWorkspace }),
      cwd: temporaryWorkspace,
      env: {
        ...process.env,
        CODEX_HOME: temporaryCodexHome,
      },
      timeoutSeconds: options.timeoutSeconds,
    });
    const elapsedSeconds =
      Number(process.hrtime.bigint() - startedAtHrtime) / 1_000_000_000;

    fs.writeFileSync(
      path.join(runOutputDirectory, "output.jsonl"),
      result.stdout,
      "utf-8",
    );
    fs.writeFileSync(
      path.join(runOutputDirectory, "stderr.log"),
      result.stderr,
      "utf-8",
    );

    const summary = {
      runId,
      flowName,
      agent,
      caseName,
      fixture,
      executionContract,
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
      temporaryWorkspace,
      temporaryCodexHome,
      runOutputDirectory,
      summaryPath: path.join(runOutputDirectory, "summary.json"),
      ...summarizeJsonl(result.stdout),
      ...summarizeSessionHistory(temporaryCodexHome),
    };
    summary.artifactExists = artifactAbsolutePath
      ? fs.existsSync(artifactAbsolutePath)
      : false;

    if (result.spawnError) {
      summary.error = `failed to spawn codex: ${result.spawnError}`;
    } else if (result.timedOut) {
      summary.error = `codex exec timed out after ${options.timeoutSeconds}s`;
    } else if (result.signal) {
      summary.error = `codex exec terminated by ${result.signal}`;
    } else if (result.exitCode !== 0) {
      summary.error = `codex exec exited with ${result.exitCode}`;
    } else if (!summary.usage || summary.finalMessage.trim() === "") {
      summary.error = "missing usage or final message";
    } else {
      const rootSpawn = summary.spawnCalls[0];
      const childThreadIds = new Set(rootSpawn?.receiverThreadIds ?? []);
      const childSessions = summary.sessionSummaries.filter((session) =>
        childThreadIds.has(session.sessionId),
      );
      const childSession = childSessions[0];
      const childThreadId = childSession?.sessionId;
      const childSpawnCalls =
        childSession?.toolCalls.filter(
          (toolCall) => toolCall.tool === "spawn_agent",
        ) ?? [];

      if (summary.spawnedAgentThreadCount !== 1) {
        summary.error = `expected one spawned custom agent, saw ${summary.spawnedAgentThreadCount}`;
      } else if (!rootSpawn || rootSpawn.agentType !== agent) {
        summary.error = `expected root agent_type ${agent}, saw ${rootSpawn?.agentType ?? "missing"}`;
      } else if (
        executionContract.outputPath &&
        !spawnMessageContainsExecutionContract(rootSpawn, executionContract)
      ) {
        summary.error = "root custom-agent spawn omitted its assigned taskId, workItemId, or exact output path";
      } else if (childSessions.length !== 1) {
        summary.error = `expected one concrete child session, saw ${childSessions.length}`;
      } else if (childSession.agentRole !== agent) {
        summary.error = `expected child role ${agent}, saw ${childSession.agentRole ?? "missing"}`;
      } else if (
        childSession.finalMessage.trim() === "" ||
        childSession.terminalEventCount === 0
      ) {
        summary.error = "custom agent child is missing a terminal final result";
      } else if (!callsTargetThread(summary.waitCalls, childThreadId)) {
        summary.error = "root did not wait for the concrete custom-agent thread";
      } else if (!callsTargetThread(summary.closeAgentCalls, childThreadId)) {
        summary.error = "root did not close the concrete custom-agent thread";
      } else if (childSpawnCalls.length > 0) {
        summary.error = "leaf custom agent attempted to spawn another agent";
      } else if (
        executionContract.outputPath &&
        !summary.artifactExists
      ) {
        summary.error = `missing assigned artifact: ${executionContract.outputPath}`;
      } else if (
        executionContract.outputPath &&
        !childSession.finalMessage.includes(executionContract.outputPath)
      ) {
        summary.error = `child final result did not return assigned artifact path: ${executionContract.outputPath}`;
      } else if (
        agent === "code-explorer" &&
        caseName === "mcp" &&
        summary.codemapMcpToolCallEventCount === 0
      ) {
        summary.error = "expected code-explorer mcp case to call codemap-search MCP";
      } else if (
        /unknown agent_type|custom agent is unavailable|사용자 지정 하위 에이전트.*사용할 수 없습니다|실패:|부분 실패/i.test(
          summary.finalMessage,
        )
      ) {
        summary.error = "custom agent execution failed";
      }
    }

    summary.success = !summary.error;
    fs.writeFileSync(
      path.join(runOutputDirectory, "summary.json"),
      JSON.stringify(summary, null, 2),
      "utf-8",
    );

    console.log(JSON.stringify(summary, null, 2));
    return summary;
  } catch (error) {
    const summary = {
      runId,
      flowName,
      agent,
      caseName,
      fixture,
      finishedAt: new Date().toISOString(),
      temporaryWorkspace,
      temporaryCodexHome,
      runOutputDirectory,
      summaryPath: path.join(runOutputDirectory, "summary.json"),
      success: false,
      error: error.stack ?? error.message,
    };
    fs.writeFileSync(
      path.join(runOutputDirectory, "summary.json"),
      JSON.stringify(summary, null, 2),
      "utf-8",
    );
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  } finally {
    if (!options.keepWorkspace) {
      fs.rmSync(temporaryWorkspace, { recursive: true, force: true });
      fs.rmSync(temporaryCodexHome, { recursive: true, force: true });
    }
  }
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < items.length) {
      const itemIndex = nextIndex;
      nextIndex += 1;
      results[itemIndex] = await worker(items[itemIndex], itemIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runNext(),
  );
  await Promise.all(workers);
  return results;
}

function caseNamesFromOption(caseName) {
  return caseName === "both" ? ["no-mcp", "mcp"] : [caseName];
}

function individualCaseForAgent(agent) {
  return agent === "code-explorer" ? "mcp" : "no-mcp";
}

function buildSinglePlan(options) {
  return caseNamesFromOption(options.caseName).map((caseName) => ({
    phaseName: "single",
    agent: options.agent,
    caseName,
    fixture: options.fixture,
  }));
}

function buildIndividualPlan(agentNames) {
  return agentNames
    .map((agent) => ({
      phaseName: "individual",
      agent,
      caseName: individualCaseForAgent(agent),
      fixture: defaultFixtureByAgent[agent],
    }));
}

async function runPlanItems({
  flowName,
  outputDirectory,
  options,
  planItems,
  runId,
  concurrency,
}) {
  return runWithConcurrency(planItems, concurrency, (planItem) =>
    runCase({
      agent: planItem.agent,
      caseName: planItem.caseName,
      fixture: planItem.fixture,
      flowName,
      outputDirectory,
      options,
      runId,
    }),
  );
}

function writeAggregateSummary({ aggregatePath, summary }) {
  fs.writeFileSync(aggregatePath, JSON.stringify(summary, null, 2), "utf-8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const agentNames = readAgentNames();

  for (const agentName of agentNames) {
    if (!defaultFixtureByAgent[agentName]) {
      throw new Error(`No default fixture for agent: ${agentName}`);
    }
  }
  if (options.agent && !agentNames.includes(options.agent)) {
    throw new Error(`Unknown agent: ${options.agent}`);
  }

  const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const outputDirectory = path.join(
    packageRoot,
    "evals",
    "runs",
    `${runId}-${options.flow}`,
  );
  fs.mkdirSync(outputDirectory, { recursive: true });

  const aggregatePath = path.join(outputDirectory, "summary.json");
  const aggregateSummary = {
    runId,
    flowName: options.flow,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    timeoutSeconds: options.timeoutSeconds,
    concurrency: options.concurrency,
    outputDirectory,
    allAgents: agentNames,
    individualAgents: agentNames,
    phases: [],
    cases: [],
    success: false,
  };

  writeAggregateSummary({ aggregatePath, summary: aggregateSummary });

  if (options.flow === "single") {
    const planItems = buildSinglePlan(options);
    aggregateSummary.phases.push({
      name: "single",
      status: "running",
      plannedCases: planItems,
    });
    writeAggregateSummary({ aggregatePath, summary: aggregateSummary });

    const summaries = await runPlanItems({
      flowName: options.flow,
      outputDirectory,
      options,
      planItems,
      runId,
      concurrency: planItems.length,
    });
    aggregateSummary.cases.push(...summaries);
    aggregateSummary.phases.at(-1).status = summaries.some(
      (summary) => summary.error,
    )
      ? "failed"
      : "passed";
  } else if (options.flow === "individual") {
    const planItems = buildIndividualPlan(agentNames);
    aggregateSummary.phases.push({
      name: "individual",
      status: "running",
      plannedCases: planItems,
    });
    writeAggregateSummary({ aggregatePath, summary: aggregateSummary });

    const summaries = await runPlanItems({
      flowName: options.flow,
      outputDirectory,
      options,
      planItems,
      runId,
      concurrency: options.concurrency,
    });
    aggregateSummary.cases.push(...summaries);
    aggregateSummary.phases.at(-1).status = summaries.some(
      (summary) => summary.error,
    )
      ? "failed"
      : "passed";
  }

  aggregateSummary.finishedAt = new Date().toISOString();
  aggregateSummary.success = aggregateSummary.phases.every(
    (phase) => phase.status === "passed",
  );
  writeAggregateSummary({ aggregatePath, summary: aggregateSummary });

  console.log(JSON.stringify({ aggregateSummaryPath: aggregatePath }, null, 2));
  if (!aggregateSummary.success) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
