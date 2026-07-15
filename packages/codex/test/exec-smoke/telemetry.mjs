import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

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
    argumentsObject?.target,
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

function callsOnlyTargetThread(calls, threadId) {
  const observedTargetThreadIds = calls.flatMap(
    (call) => call.targetThreadIds ?? [],
  );
  return (
    observedTargetThreadIds.length === 0 ||
    observedTargetThreadIds.every(
      (observedThreadId) => observedThreadId === threadId,
    )
  );
}

const nonDeliveryAgentTools = new Set([
  "wait",
  "wait_agent",
  "list_agents",
  "interrupt_agent",
  "close_agent",
]);

function isAgentDeliveryToolCall(toolCall) {
  if (["spawn_agent", "followup_task", "send_message"].includes(toolCall.tool)) {
    return true;
  }
  return (
    toolCall.namespace === "agents" &&
    !nonDeliveryAgentTools.has(toolCall.tool)
  );
}

function inferToolLifecyclePhase({ eventType, payloadType, itemType }) {
  const lifecycleText = [eventType, payloadType, itemType]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/(output|result|completed|complete|end)/.test(lifecycleText)) {
    return "end";
  }
  if (/(function_call|tool_call|response_item|started|start|begin|requested)/.test(lifecycleText)) {
    return "start";
  }
  return "unknown";
}

function mergeToolCallLifecycleRecords(records) {
  const recordsByInvocation = new Map();
  for (const record of records) {
    const invocationRecords = recordsByInvocation.get(record.invocationKey) ?? [];
    if (!invocationRecords.some((item) => item.eventKey === record.eventKey)) {
      invocationRecords.push(record);
    }
    recordsByInvocation.set(record.invocationKey, invocationRecords);
  }
  return [...recordsByInvocation.entries()].map(
    ([invocationKey, invocationRecords]) => {
      const startEvents = invocationRecords.filter(
        (record) =>
          record.lifecyclePhase === "start" &&
          Number.isFinite(record.timestampMs),
      );
      const endEvents = invocationRecords.filter(
        (record) =>
          record.lifecyclePhase === "end" &&
          Number.isFinite(record.timestampMs),
      );
      const earliestStart = startEvents.sort(
        (left, right) => left.timestampMs - right.timestampMs,
      )[0];
      const latestEnd = endEvents.sort(
        (left, right) => right.timestampMs - left.timestampMs,
      )[0];
      const representative = earliestStart ?? invocationRecords[0];
      return {
        ...representative,
        eventKey: invocationKey,
        lifecycleEvents: invocationRecords,
        startEventKey: earliestStart?.eventKey ?? null,
        startTimestampMs: earliestStart?.timestampMs ?? null,
        endEventKey: latestEnd?.eventKey ?? null,
        endTimestampMs: latestEnd?.timestampMs ?? null,
        timestampMs: earliestStart?.timestampMs ?? null,
      };
    },
  );
}

function messageContainsExecutionContract(message, executionContract) {
  if (!executionContract.outputPath) return true;
  if (typeof message !== "string") return false;
  return [
    executionContract.taskId,
    executionContract.workItemId,
    executionContract.outputPath,
  ].every((value) => message.includes(value));
}

function isEncryptedMessageEnvelope(message) {
  return (
    typeof message === "string" &&
    /^gAAAA[A-Za-z0-9_-]{32,}={0,2}$/.test(message)
  );
}

function spawnMessageContainsExecutionContract(spawnCall, executionContract) {
  return messageContainsExecutionContract(
    spawnCall?.message,
    executionContract,
  );
}

function summarizeJsonl(stdout) {
  let usage = null;
  let rootThreadId = null;
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
    if (event.type === "thread.started") {
      rootThreadId = event.thread_id ?? payload.thread_id ?? rootThreadId;
    }
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
        forkTurns: argumentsObject?.fork_turns ?? null,
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
    rootThreadId,
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
    const terminalEvents = [];
    let metadata = null;
    let sessionStartEvent = null;

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

      const payload = event.payload ?? {};
      const item = payload.item ?? {};
      const eventTimestamp =
        event.timestamp ?? payload.timestamp ?? item.timestamp ?? null;
      const eventTimestampMs = Date.parse(eventTimestamp ?? "");
      const rawEventKey = createHash("sha256").update(line).digest("hex");
      const invocationKey =
        event.id ??
        payload.id ??
        item.id ??
        rawEventKey;
      if (event.type === "session_meta") {
        metadata = event.payload;
        sessionStartEvent = {
          eventKey: rawEventKey,
          timestamp: eventTimestamp,
          timestampMs: Number.isFinite(eventTimestampMs)
            ? eventTimestampMs
            : null,
          provenance: "session_meta",
        };
      }
      if (
        event.type === "turn.completed" ||
        payload.type === "turn_completed" ||
        payload.type === "task_complete"
      ) {
        terminalEvents.push({
          eventKey: rawEventKey,
          line: lineIndex + 1,
          timestamp: eventTimestamp,
          timestampMs: Number.isFinite(eventTimestampMs)
            ? eventTimestampMs
            : null,
        });
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
        const rawArguments =
          item.arguments ?? payload.arguments ?? payload.input;
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
          eventKey: rawEventKey,
          invocationKey,
          line: lineIndex + 1,
          timestamp: eventTimestamp,
          timestampMs: Number.isFinite(eventTimestampMs)
            ? eventTimestampMs
            : null,
          type: event.type,
          lifecyclePhase: inferToolLifecyclePhase({
            eventType: event.type,
            payloadType: payload.type,
            itemType: item.type,
          }),
          tool: toolName,
          namespace: payload.namespace ?? item.namespace ?? null,
          agentType: argumentsObject?.agent_type ?? null,
          forkTurns: argumentsObject?.fork_turns ?? null,
          message: argumentsObject?.message ?? item.prompt ?? null,
          receiverThreadIds: item.receiver_thread_ids ?? [],
          targetThreadIds: getTargetThreadIds(argumentsObject, item),
        });
      }

      if (payload.type === "mcp_tool_call_end") {
        mcpToolCallEventCount += 1;
        const invocation = payload.invocation ?? {};
        toolCalls.push({
          eventKey: rawEventKey,
          invocationKey,
          line: lineIndex + 1,
          timestamp: eventTimestamp,
          timestampMs: Number.isFinite(eventTimestampMs)
            ? eventTimestampMs
            : null,
          type: payload.type,
          lifecyclePhase: inferToolLifecyclePhase({
            eventType: event.type,
            payloadType: payload.type,
            itemType: item.type,
          }),
          server: invocation.server ?? null,
          tool: invocation.tool ?? null,
        });
        if (invocation.server === "codemap-search") {
          codemapMcpToolCallEventCount += 1;
        }
      }
    }

    const sessionMetadataTimestamp = metadata?.timestamp ?? null;
    const sessionCreatedAtMs = sessionStartEvent?.timestampMs ?? null;

    const uniqueTerminalEvents = [
      ...new Map(
        terminalEvents.map((terminalEvent) => [terminalEvent.eventKey, terminalEvent]),
      ).values(),
    ];
    const uniqueToolCalls = mergeToolCallLifecycleRecords(toolCalls);
    sessionSummaries.push({
      sessionPath,
      sessionCreatedAtMs,
      sessionStartEvent,
      sessionStartEvents: sessionStartEvent ? [sessionStartEvent] : [],
      sessionMetadataTimestamp,
      sessionId: metadata?.id ?? null,
      parentThreadId: metadata?.parent_thread_id ?? null,
      threadSource: metadata?.thread_source ?? null,
      agentRole: metadata?.agent_role ?? null,
      agentNickname: metadata?.agent_nickname ?? null,
      source: metadata?.source ?? null,
      finalMessage: messages.at(-1) ?? "",
      terminalEvents: uniqueTerminalEvents,
      terminalEventCount: uniqueTerminalEvents.length,
      terminalTimestampMs:
        uniqueTerminalEvents.length === 1
          ? uniqueTerminalEvents[0].timestampMs
          : null,
      toolCalls: uniqueToolCalls,
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


export {
  callsOnlyTargetThread,
  isEncryptedMessageEnvelope,
  messageContainsExecutionContract,
  spawnMessageContainsExecutionContract,
  summarizeJsonl,
  summarizeSessionHistory,
};
