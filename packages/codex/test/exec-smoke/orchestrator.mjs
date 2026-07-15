import fs from "node:fs";
import path from "node:path";
import {
  defaultFixtureByAgent,
  packageRoot,
  readAgentNames,
} from "./configuration.mjs";
import {
  buildIndividualPlan,
  buildSinglePlan,
  parseArgs,
} from "./cli.mjs";
import {
  runPlanItems,
  writeAggregateSummary,
} from "./case-runner.mjs";
import {
  assertCheckpointTransitionEvaluator,
  runIntentGateFlow,
} from "./intent-gate.mjs";

export async function runExecSmoke(argv) {
  assertCheckpointTransitionEvaluator();
  const options = parseArgs(argv);
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
  } else if (options.flow === "intent-gate") {
    await runIntentGateFlow({
      aggregateSummary,
      outputDirectory,
      options,
      runId,
    });
  }

  aggregateSummary.finishedAt = new Date().toISOString();
  aggregateSummary.success = aggregateSummary.phases.every(
    (phase) => phase.status === "passed",
  );
  writeAggregateSummary({ aggregatePath, summary: aggregateSummary });

  console.log(JSON.stringify({ aggregateSummaryPath: aggregatePath }, null, 2));
  return aggregateSummary.success;
}
