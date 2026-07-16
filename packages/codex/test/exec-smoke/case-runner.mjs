import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildExecutionContract,
  buildPrompt,
  readFixtureInput,
} from "./configuration.mjs";
import {
  codexExecArgs,
  prepareCodexHome,
  prepareWorkspace,
  runCodexExec,
} from "./runtime.mjs";
import {
  callsOnlyTargetThread,
  isEncryptedMessageEnvelope,
  messageContainsExecutionContract,
  spawnMessageContainsExecutionContract,
  summarizeJsonl,
  summarizeSessionHistory,
} from "./telemetry.mjs";

async function runCase({
  agent,
  caseName,
  expectedIntentSignal,
  fixture,
  fixtureInputOverride,
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

  const fixtureInput = fixtureInputOverride ?? readFixtureInput(fixture);
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
    const artifactParentAbsolutePath = artifactAbsolutePath
      ? path.dirname(artifactAbsolutePath)
      : null;
    const artifactParentInitiallyExists = artifactParentAbsolutePath
      ? fs.existsSync(artifactParentAbsolutePath)
      : false;
    fs.writeFileSync(path.join(runOutputDirectory, "prompt.txt"), prompt, "utf-8");

    const startedAt = new Date().toISOString();
    const startedAtHrtime = process.hrtime.bigint();
    const result = await runCodexExec({
      args: codexExecArgs({
        caseName,
        model: options.model,
        prompt,
        temporaryWorkspace,
      }),
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
    summary.artifactParentInitiallyExists = artifactParentInitiallyExists;
    summary.artifactParentExists = artifactParentAbsolutePath
      ? fs.existsSync(artifactParentAbsolutePath)
      : false;
    summary.artifactParentCreatedAtMs = summary.artifactParentExists
      ? fs.statSync(artifactParentAbsolutePath).birthtimeMs
      : null;
    summary.rootPromptContainsExecutionContract =
      messageContainsExecutionContract(prompt, executionContract);

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
      const rootSession = summary.sessionSummaries.find(
        (session) => session.sessionId === summary.rootThreadId,
      );
      const rootSessionSpawnCalls =
        rootSession?.toolCalls.filter(
          (toolCall) => toolCall.tool === "spawn_agent",
        ) ?? [];
      const completedStdoutSpawnCalls = summary.spawnCalls.filter(
        (spawnCall) => (spawnCall.receiverThreadIds?.length ?? 0) > 0,
      );
      const observedRootSpawnCalls =
        rootSessionSpawnCalls.length > 0
          ? rootSessionSpawnCalls
          : completedStdoutSpawnCalls;
      const rootSessionSpawn = observedRootSpawnCalls[0];
      const rootSpawnMessageIsEncrypted = isEncryptedMessageEnvelope(
        rootSessionSpawn?.message,
      );
      const directChildSessions = summary.sessionSummaries.filter((session) => {
        const threadSpawn = session.source?.subagent?.thread_spawn;
        return (
          session.threadSource === "subagent" &&
          threadSpawn?.depth === 1 &&
          session.parentThreadId === summary.rootThreadId &&
          threadSpawn.parent_thread_id === summary.rootThreadId
        );
      });
      const childSession = directChildSessions[0];
      const childThreadSpawn = childSession?.source?.subagent?.thread_spawn;
      const childThreadId = childSession?.sessionId;
      const stdoutSpawnReceiverThreadIds = new Set(
        summary.spawnCalls.flatMap(
          (spawnCall) => spawnCall.receiverThreadIds ?? [],
        ),
      );
      const delegatedGrandchildSessions = childThreadId
        ? summary.sessionSummaries.filter((session) => {
            const threadSpawn = session.source?.subagent?.thread_spawn;
            return (
              threadSpawn &&
              (session.parentThreadId === childThreadId ||
                threadSpawn.parent_thread_id === childThreadId)
            );
          })
        : [];

      summary.childObservationSource =
        summary.spawnCalls.length > 0
          ? "stdout+session"
          : "session-history-fallback";
      summary.rootSessionFound = Boolean(rootSession);
      summary.rootSessionSpawnCallCount = rootSessionSpawnCalls.length;
      summary.rootSpawnObservationSource =
        rootSessionSpawnCalls.length > 0
          ? "session-history"
          : completedStdoutSpawnCalls.length > 0
            ? "stdout-collab-event"
            : "missing";
      summary.rootSpawnMessageEncoding = rootSpawnMessageIsEncrypted
        ? "encrypted-envelope"
        : "plaintext";
      summary.directChildCount = directChildSessions.length;
      summary.directChildSessionId = childThreadId ?? null;
      summary.directChildParentThreadId = childSession?.parentThreadId ?? null;
      summary.directChildDepth = childThreadSpawn?.depth ?? null;
      summary.directChildRole = childSession?.agentRole ?? null;
      summary.directChildSpawnRole = childThreadSpawn?.agent_role ?? null;
      summary.directChildDelegationMessage =
        rootSpawnMessageIsEncrypted
          ? "[encrypted-envelope]"
          : (rootSessionSpawn?.message ?? null);
      summary.delegatedGrandchildCount = delegatedGrandchildSessions.length;
      summary.childSessionCreatedAtMs = childSession?.sessionCreatedAtMs ?? null;
      summary.artifactParentCreatedBeforeChildSpawn =
        summary.artifactParentCreatedAtMs !== null &&
        summary.childSessionCreatedAtMs !== null &&
        summary.artifactParentCreatedAtMs <= summary.childSessionCreatedAtMs;
      const childSpawnCalls =
        childSession?.toolCalls.filter(
          (toolCall) => toolCall.tool === "spawn_agent",
        ) ?? [];

      if (!summary.rootThreadId) {
        summary.error = "missing root thread ID from codex exec output";
      } else if (!rootSession) {
        summary.error = "missing persisted root session for codex exec thread";
      } else if (observedRootSpawnCalls.length < 1) {
        summary.error = "missing root spawn_agent observation";
      } else if (directChildSessions.length !== 1) {
        summary.error = `expected one depth-1 direct child session, saw ${directChildSessions.length}`;
      } else if (
        observedRootSpawnCalls.some(
          (call) => call.agentType !== null && call.agentType !== agent,
        )
      ) {
        summary.error = `expected every observed root agent_type to be ${agent}`;
      } else if (
        observedRootSpawnCalls.some(
          (call) => call.forkTurns !== null && call.forkTurns !== "none",
        )
      ) {
        summary.error = "expected every observed root fork_turns value to be none";
      } else if (
        typeof rootSessionSpawn.message !== "string" ||
        rootSessionSpawn.message.length === 0
      ) {
        summary.error = "observed root spawn message was empty";
      } else if (
        rootSpawnMessageIsEncrypted &&
        !summary.rootPromptContainsExecutionContract
      ) {
        summary.error = "encrypted root spawn did not originate from a prompt containing the exact execution contract";
      } else if (
        !rootSpawnMessageIsEncrypted &&
        !spawnMessageContainsExecutionContract(
          rootSessionSpawn,
          executionContract,
        )
      ) {
        summary.error = "plaintext observed root spawn omitted its assigned taskId, workItemId, or exact output path";
      } else if (childSession.agentRole !== agent) {
        summary.error = `expected child role ${agent}, saw ${childSession.agentRole ?? "missing"}`;
      } else if (childThreadSpawn?.agent_role !== agent) {
        summary.error = `expected child spawn role ${agent}, saw ${childThreadSpawn?.agent_role ?? "missing"}`;
      } else if (
        summary.spawnCalls.length > 0 &&
        summary.spawnCalls.some(
          (spawnCall) =>
            spawnCall.agentType !== null && spawnCall.agentType !== agent,
        )
      ) {
        summary.error = `stdout spawn event did not use root agent_type ${agent}`;
      } else if (
        summary.spawnCalls.length > 0 &&
        summary.spawnCalls.some(
          (spawnCall) =>
            !spawnMessageContainsExecutionContract(
              spawnCall,
              executionContract,
            ),
        )
      ) {
        summary.error = "stdout spawn event omitted its assigned taskId, workItemId, or exact output path";
      } else if (
        summary.spawnCalls.length > 0 &&
        (stdoutSpawnReceiverThreadIds.size !== 1 ||
          !stdoutSpawnReceiverThreadIds.has(childThreadId))
      ) {
        summary.error = "stdout spawn receiver did not match the direct child session";
      } else if (
        executionContract.outputPath &&
        summary.artifactParentInitiallyExists
      ) {
        summary.error = `assigned artifact parent existed before codex exec: ${executionContract.outputParentPath}`;
      } else if (
        executionContract.outputPath &&
        !summary.artifactParentExists
      ) {
        summary.error = `missing exact artifact parent: ${executionContract.outputParentPath}`;
      } else if (
        executionContract.outputPath &&
        !summary.artifactParentCreatedBeforeChildSpawn
      ) {
        summary.error = `exact artifact parent was not created before child spawn: ${executionContract.outputParentPath}`;
      } else if (
        childSession.finalMessage.trim() === "" ||
        childSession.terminalEventCount === 0
      ) {
        summary.error = "custom agent child is missing a terminal final result";
      } else if (!callsOnlyTargetThread(summary.waitCalls, childThreadId)) {
        summary.error = "root wait telemetry targeted a different custom-agent thread";
      } else if (!callsOnlyTargetThread(summary.closeAgentCalls, childThreadId)) {
        summary.error = "root close telemetry targeted a different custom-agent thread";
      } else if (childSpawnCalls.length > 0) {
        summary.error = "leaf custom agent attempted to spawn another agent";
      } else if (delegatedGrandchildSessions.length > 0) {
        summary.error = "leaf custom agent created a delegated grandchild session";
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
        agent === "intent-checker" &&
        expectedIntentSignal &&
        !new RegExp(`^${expectedIntentSignal}: [^\\n]+$`).test(
          childSession.finalMessage.trim(),
        )
      ) {
        summary.error = `intent-checker did not return exact ${expectedIntentSignal} one-line signal`;
      } else if (
        agent === "intent-checker" &&
        childSession.toolCalls.length !== 0
      ) {
        summary.error = "intent-checker attempted a tool call";
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


export {
  runCase,
  runPlanItems,
  runWithConcurrency,
  writeAggregateSummary,
};
