import path from "node:path";
import {
  defaultConcurrency,
  defaultFixtureByAgent,
  defaultTimeoutSeconds,
} from "./configuration.mjs";

function parseArgs(argv) {
  const options = {
    agent: undefined,
    caseName: "no-mcp",
    caseNameSpecified: false,
    concurrency: defaultConcurrency,
    fixture: undefined,
    flow: "single",
    intentGateDirectOnly: false,
    intentGateFullCase: undefined,
    intentGateSkipDirect: false,
    keepWorkspace: false,
    model: undefined,
    repeat: 1,
    timeoutSeconds: defaultTimeoutSeconds,
    workspaceCommit: undefined,
    workspaceSource: undefined,
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
    } else if (arg === "--intent-gate-full-case") {
      options.intentGateFullCase = argv[++index];
    } else if (arg === "--intent-gate-direct-only") {
      options.intentGateDirectOnly = true;
    } else if (arg === "--intent-gate-skip-direct") {
      options.intentGateSkipDirect = true;
    } else if (arg === "--all-agents") {
      options.flow = "individual";
    } else if (arg === "--timeout-sec") {
      options.timeoutSeconds = Number(argv[++index]);
    } else if (arg === "--keep-workspace") {
      options.keepWorkspace = true;
    } else if (arg === "--model") {
      options.model = argv[++index];
    } else if (arg === "--repeat") {
      options.repeat = Number(argv[++index]);
    } else if (arg === "--workspace-source") {
      options.workspaceSource = path.resolve(argv[++index]);
    } else if (arg === "--workspace-commit") {
      options.workspaceCommit = argv[++index];
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["single", "individual", "intent-gate"].includes(options.flow)) {
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
  if (!Number.isInteger(options.repeat) || options.repeat <= 0) {
    throw new Error(`Invalid repeat: ${options.repeat}`);
  }
  if (!options.model?.trim()) {
    throw new Error("--model <id> is required");
  }
  if (options.agent && options.flow !== "single") {
    throw new Error("--agent can only be used with --flow single");
  }
  if (options.fixture && options.flow !== "single") {
    throw new Error("--fixture can only be used with --flow single");
  }
  if (options.intentGateFullCase && options.flow !== "intent-gate") {
    throw new Error("--intent-gate-full-case requires --flow intent-gate");
  }
  if (options.intentGateDirectOnly && options.flow !== "intent-gate") {
    throw new Error("--intent-gate-direct-only requires --flow intent-gate");
  }
  if (options.intentGateDirectOnly && options.intentGateFullCase) {
    throw new Error(
      "--intent-gate-direct-only cannot be combined with --intent-gate-full-case",
    );
  }
  if (options.intentGateSkipDirect && options.flow !== "intent-gate") {
    throw new Error("--intent-gate-skip-direct requires --flow intent-gate");
  }
  if (options.intentGateSkipDirect && options.intentGateDirectOnly) {
    throw new Error(
      "--intent-gate-skip-direct cannot be combined with --intent-gate-direct-only",
    );
  }
  if (options.flow === "intent-gate") {
    if (
      !options.intentGateDirectOnly &&
      (!options.workspaceSource || !options.workspaceCommit)
    ) {
      throw new Error(
        "--workspace-source and --workspace-commit are required for --flow intent-gate",
      );
    }
    if (options.concurrency !== 1) {
      throw new Error("--flow intent-gate requires --concurrency 1");
    }
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
  --flow <name>        single, individual, or intent-gate. Default: single
  --all-agents         Alias for --flow individual
  --agent <name>       Custom agent for single flow. Default: code-explorer
  --case <name>        no-mcp, mcp, or both. Default: no-mcp
  --fixture <id>       Fixture id from evals/agent-prompts/fixtures.md
  --timeout-sec <n>    Per-case timeout in seconds. Default: 240
  --concurrency <n>    Individual-agent concurrency. Default: 3
  --repeat <n>         Sequential repetitions for intent-gate. Default: 1
  --model <id>         Required root codex exec model
  --workspace-source <path>  Generic git source for isolated intent-gate runs
  --workspace-commit <sha>   Commit forced only inside isolated intent-gate clones
  --intent-gate-full-case <id>  Run only one named full-flow case after the direct matrix
  --intent-gate-direct-only  Stop after the direct checker matrix
  --intent-gate-skip-direct  Run selected full-flow cases without the direct checker matrix
  --keep-workspace     Keep temporary workspaces for inspection

Flows:
  single        Run one agent with --case no-mcp, mcp, or both.
  individual    Run every leaf custom agent, 3 at a time:
                code-explorer uses mcp; all others use no-mcp.
  intent-gate  Run direct checker and full orchestrator gate cases in isolated
                clones. Requires --workspace-source, --workspace-commit, and
                --concurrency 1 unless --intent-gate-direct-only stops before
                isolated full-flow cases.
`);
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


export {
  buildIndividualPlan,
  buildSinglePlan,
  caseNamesFromOption,
  individualCaseForAgent,
  parseArgs,
  printHelp,
};
