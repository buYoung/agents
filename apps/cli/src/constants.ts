import type { AgentDefinition } from "opencode/core";
import { orchestratorAgent } from "opencode";
import { workerAgent } from "opencode";
import { plannerAgent } from "opencode";
import { researchAgent } from "opencode";
import { exploreAgent } from "opencode";
import { ideatorAgent } from "opencode";
import { adversarialReviewAgent } from "opencode";
import { constructiveFeedbackAgent } from "opencode";

export const GITHUB_RELEASE_BASE =
  "https://github.com/buYoung/agents/releases/latest/download/";
export const DEFAULT_RELEASE_URL = `${GITHUB_RELEASE_BASE}latest.json`;
export const VERSION_CHECK_TIMEOUT_MS = 1500;
export const OPENCODE_PLUGIN_ENTRY = "agents";
export const OPENCODE_CONFIG_SCHEMA = "https://opencode.ai/config.json";
export const EXIT_VALID = 0;
export const EXIT_WARNING = 1;
export const EXIT_INVALID = 2;
export const EXIT_BLOCKED = 3;
export const EXIT_INTERNAL = 4;
export const SHA256_HEX_PATTERN = /^[a-fA-F0-9]{64}$/;
export const AGENT_RECORD: Record<string, AgentDefinition> = Object.fromEntries(
  [
    orchestratorAgent,
    workerAgent,
    plannerAgent,
    researchAgent,
    exploreAgent,
    ideatorAgent,
    adversarialReviewAgent,
    constructiveFeedbackAgent,
  ].map((agent) => [agent.name, agent]),
);
