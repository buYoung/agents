/**
 * permissions.ts — agents plugin 레이어 권한 정책 모듈
 *
 * 설계 원칙:
 * - 단일 PERMISSION_POLICY 테이블: 에이전트 한 줄 수정으로 권한 조정 가능.
 * - 기본(baseline): 모든 에이전트에게 `.agents/<taskId>/**` 읽기+쓰기 허용.
 * - 각 에이전트는 베이스라인 위에 추가 델타(delta)를 가진다.
 * - sessionID → 에이전트명 매핑은 chat.message 훅으로 유지 (tool.execute.before 입력에 에이전트명 없음).
 * - Fail-safe: 에이전트 미확인 시 변경 도구(edit/write/bash/task) 거부, 읽기 허용.
 */

// ---------------------------------------------------------------------------
// 타입 정의
// ---------------------------------------------------------------------------

import os from "node:os";
import path from "node:path";

// AgentName SSOT: doc-protocol.ts에서 import한다 (중복 선언 금지).
// 기존 소비자가 permissions.ts에서 AgentName을 import해도 계속 동작하도록 re-export한다.
export type { AgentName } from "./doc-protocol";
// AGENT_NAMES도 doc-protocol.ts가 SSOT이므로 re-export (중복 선언 금지).
export { AGENT_NAMES } from "./doc-protocol";
import type { AgentName } from "@opencode/core/doc-protocol";
import { AGENT_NAMES as AGENT_NAMES_IMPL } from "@opencode/core/doc-protocol";

/** 에이전트별 source 읽기 정책 */
export type SourceReadPolicy = "allow" | "deny" | "docs-only";

/** task 위임 정책 */
export type TaskPolicy = "allow" | "deny" | "to-subagents";

/** 단순 이진 허용/거부 정책 */
export type BinaryPolicy = "allow" | "deny";

/** bash 실행 정책 */
export type BashPolicy = BinaryPolicy | "read-only";

/** 경로 접근 경계 정책 */
export type PathBoundaryPolicy = "any" | "workspace-or-temp";

export interface ToolPermissionPolicy {
  /** source 파일 읽기 — allow | deny | docs-only(docs/** 만 허용) */
  sourceRead: SourceReadPolicy;
  /** bash 실행 — allow | deny | read-only */
  bash: BashPolicy;
  /** source 파일 편집/쓰기 — allow | deny */
  sourceEdit: BinaryPolicy;
  /** webfetch 사용 — allow | deny */
  webfetch: BinaryPolicy;
  /**
   * task 위임 — allow | deny | to-subagents
   * to-subagents: orchestrator 전용, 7개 서브에이전트에게만 위임 허용
   */
  task: TaskPolicy;
}

export interface PathPermissionPolicy {
  /** 읽기 도구 대상 경계 */
  sourceRead: PathBoundaryPolicy;
  /** 편집/쓰기 도구 대상 경계 */
  sourceEdit: PathBoundaryPolicy;
  /** bash workdir/명령 인자 경계 */
  bash: PathBoundaryPolicy;
}

/**
 * 에이전트 한 행(row)의 권한 정책.
 * 베이스라인(.agents/** 읽기+쓰기) 위에 적용되는 델타.
 */
export interface PermissionPolicy {
  /** 에이전트 이름 */
  agent: AgentName;
  /** 도구별 권한 */
  tools: ToolPermissionPolicy;
  /** 경로 기반 도구/명령 경계 */
  paths: PathPermissionPolicy;
}

// ---------------------------------------------------------------------------
// 에이전트 목록 상수
// ---------------------------------------------------------------------------

// AGENT_NAMES는 doc-protocol.ts에서 re-export한다 (위에서 export).
// 여기서는 구현체(AGENT_NAMES_IMPL)를 SUBAGENT_NAMES 도출에만 사용한다.

/** orchestrator가 위임할 수 있는 서브에이전트 목록 */
export const SUBAGENT_NAMES: readonly AgentName[] = AGENT_NAMES_IMPL.filter(
  (name): name is AgentName => name !== "orchestrator",
);

// ---------------------------------------------------------------------------
// 권한 정책 테이블 (단일 진실 원천)
// ---------------------------------------------------------------------------

/**
 * 전체 9개 에이전트 권한 정책 테이블.
 * 권한 변경은 이 테이블만 수정한다.
 *
 * 베이스라인 (모든 에이전트 공통):
 *   - `.agents/<taskId>/**` 읽기+쓰기: 항상 허용 (여기서는 delta만 인코딩)
 */
export const PERMISSION_POLICY: readonly PermissionPolicy[] = [
  {
    agent: "orchestrator",
    tools: {
      sourceRead: "docs-only", // docs/** 와 briefs/** 에 한정
      bash: "read-only",
      sourceEdit: "deny",
      webfetch: "deny",
      task: "to-subagents", // 8개 서브에이전트에게만 위임 가능
    },
    paths: { sourceRead: "any", sourceEdit: "any", bash: "any" },
  },
  {
    agent: "intent-checker",
    tools: {
      sourceRead: "deny", // 게이트 에이전트 — 읽기 불필요 (오케스트레이터가 텍스트로 넘겨줌)
      bash: "deny",
      sourceEdit: "deny",
      webfetch: "deny",
      task: "deny", // 재위임 금지
    },
    paths: { sourceRead: "any", sourceEdit: "any", bash: "any" },
  },
  {
    agent: "worker",
    tools: {
      sourceRead: "allow",
      bash: "allow",
      sourceEdit: "allow",
      webfetch: "allow",
      task: "deny", // 재위임 금지
    },
    paths: {
      sourceRead: "workspace-or-temp",
      sourceEdit: "workspace-or-temp",
      bash: "workspace-or-temp",
    },
  },
  {
    agent: "planner",
    tools: {
      sourceRead: "allow",
      bash: "read-only",
      sourceEdit: "deny",
      webfetch: "deny",
      task: "deny",
    },
    paths: { sourceRead: "any", sourceEdit: "any", bash: "any" },
  },
  {
    agent: "research",
    tools: {
      sourceRead: "allow",
      bash: "allow",
      sourceEdit: "deny",
      webfetch: "allow",
      task: "deny",
    },
    paths: { sourceRead: "any", sourceEdit: "any", bash: "any" },
  },
  {
    agent: "code-explorer",
    tools: {
      sourceRead: "allow",
      bash: "deny",
      sourceEdit: "deny",
      webfetch: "deny",
      task: "deny",
    },
    paths: { sourceRead: "any", sourceEdit: "any", bash: "any" },
  },
  {
    agent: "idea-generator",
    tools: {
      sourceRead: "allow",
      bash: "deny",
      sourceEdit: "deny",
      webfetch: "deny",
      task: "deny",
    },
    paths: { sourceRead: "any", sourceEdit: "any", bash: "any" },
  },
  {
    agent: "adversarial-review",
    tools: {
      sourceRead: "allow",
      bash: "read-only",
      sourceEdit: "deny",
      webfetch: "deny",
      task: "deny",
    },
    paths: { sourceRead: "any", sourceEdit: "any", bash: "any" },
  },
  {
    agent: "constructive-feedback",
    tools: {
      sourceRead: "allow",
      bash: "read-only",
      sourceEdit: "deny",
      webfetch: "deny",
      task: "deny",
    },
    paths: { sourceRead: "any", sourceEdit: "any", bash: "any" },
  },
] as const;

// 빠른 조회를 위한 Map (초기화 시 1회 빌드)
const POLICY_MAP = new Map<AgentName, PermissionPolicy>(
  PERMISSION_POLICY.map((policy) => [policy.agent, policy]),
);

// ---------------------------------------------------------------------------
// 경로 분류기
// ---------------------------------------------------------------------------

/** 경로 분류 결과 */
export type PathCategory = "agents" | "docs" | "source";

/**
 * 대상 경로를 세 가지 카테고리로 분류한다.
 *
 * - "agents"  : `.agents` 세그먼트를 포함하는 경로 (태스크 런 디렉터리)
 * - "docs"    : `docs/`로 시작하는 경로 (briefs 포함)
 * - "source"  : 그 외 모든 경로 (소스 코드, 설정 파일 등)
 *
 * @param targetPath - 분류할 경로 (절대 또는 상대 경로 모두 허용)
 * @returns PathCategory
 *
 * @example
 * classifyPath('.agents/2026-07-01/coder.md') // → "agents"
 * classifyPath('docs/briefs/my-brief.md')     // → "docs"
 * classifyPath('src/index.ts')                // → "source"
 */
export function classifyPath(targetPath: string): PathCategory {
  const normalized = targetPath.replace(/\\/g, "/");
  const pathSegments = normalized.split("/").filter(Boolean);

  if (pathSegments.includes(".agents")) {
    return "agents";
  }

  if (normalized.startsWith("docs/") || normalized === "docs") {
    return "docs";
  }

  return "source";
}

// ---------------------------------------------------------------------------
// 세션 → 에이전트 맵 관리
// ---------------------------------------------------------------------------

/**
 * 세션→에이전트 맵과 업데이트 함수를 함께 반환한다.
 * chat.message 훅에서 `updateSessionAgent`를 호출해 맵을 유지하고,
 * tool.execute.before 훅에서 `resolveAgent`로 호출자를 조회한다.
 */
export function createSessionAgentMap(): {
  map: Map<string, AgentName>;
  updateSessionAgent: (sessionID: string, agent: string | undefined) => void;
  deleteSession: (sessionID: string) => void;
} {
  const map = new Map<string, AgentName>();

  function updateSessionAgent(
    sessionID: string,
    agent: string | undefined,
  ): void {
    if (!agent) return;
    // 알려진 에이전트 이름인지 검증 후 저장
    if ((AGENT_NAMES_IMPL as readonly string[]).includes(agent)) {
      map.set(sessionID, agent as AgentName);
    }
  }

  function deleteSession(sessionID: string): void {
    map.delete(sessionID);
  }

  return { map, updateSessionAgent, deleteSession };
}

/**
 * 세션 ID로 에이전트 이름을 조회한다.
 *
 * @param sessionID - 조회할 세션 ID
 * @param sessionAgentMap - 세션→에이전트 맵
 * @returns AgentName 또는 undefined (미확인 시)
 */
export function resolveAgent(
  sessionID: string,
  sessionAgentMap: Map<string, AgentName>,
): AgentName | undefined {
  return sessionAgentMap.get(sessionID);
}

function getBashCommand(args: Record<string, unknown>): string {
  const command = args["command"];
  return typeof command === "string" ? command : "";
}

function getDisabledMcpCommands(): string[] {
  return (process.env.OPENCODE_DISABLED_MCP_COMMANDS ?? "")
    .split(",")
    .map((command) => command.trim())
    .filter(Boolean);
}

function isDisabledMcpCommandUsed(command: string): string | undefined {
  const disabledCommands = getDisabledMcpCommands();
  if (disabledCommands.length === 0) return undefined;

  const normalizedCommand = command.trim();
  if (!normalizedCommand) return undefined;

  return disabledCommands.find((disabledCommand) => {
    const escapedCommand = disabledCommand.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    return new RegExp(`(^|[^\\w.-])${escapedCommand}($|[^\\w.-])`).test(
      normalizedCommand,
    );
  });
}

const READ_ONLY_BASH_COMMANDS = new Set([
  "awk",
  "basename",
  "cat",
  "cmp",
  "comm",
  "cut",
  "date",
  "df",
  "diff",
  "dirname",
  "du",
  "echo",
  "egrep",
  "false",
  "fgrep",
  "file",
  "find",
  "git",
  "grep",
  "head",
  "id",
  "jq",
  "ls",
  "md5",
  "md5sum",
  "nl",
  "paste",
  "printf",
  "pwd",
  "rg",
  "sed",
  "shasum",
  "sha1sum",
  "sha256sum",
  "sort",
  "stat",
  "tail",
  "test",
  "tr",
  "true",
  "type",
  "uname",
  "uniq",
  "wc",
  "which",
  "whoami",
  "[",
]);

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "blame",
  "diff",
  "grep",
  "log",
  "ls-files",
  "rev-list",
  "rev-parse",
  "show",
  "show-ref",
  "status",
]);

const SHELL_SEPARATORS = new Set([";", "|", "&&", "||"]);

const UNSAFE_READ_ONLY_ARGS: Record<string, readonly string[]> = {
  awk: ["-i"],
  find: ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint"],
  sed: ["-i", "--in-place"],
};

const INLINE_SCRIPT_COMMANDS = new Set([
  "bash",
  "node",
  "perl",
  "php",
  "python",
  "python3",
  "ruby",
  "sh",
  "zsh",
]);

const INLINE_SCRIPT_FLAGS = new Set([
  "-c",
  "-e",
  "--eval",
  "--execute",
  "--command",
]);

interface BashTokenizeResult {
  tokens: string[];
  error?: string;
}

function tokenizeBashCommand(command: string): BashTokenizeResult {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | "\"" | undefined;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    const nextCharacter = command[index + 1];

    if (!quote && character === "`") {
      return { tokens: [], error: "command substitution is not read-only safe" };
    }

    if (!quote && character === "$" && nextCharacter === "(") {
      return { tokens: [], error: "command substitution is not read-only safe" };
    }

    if (character === "\\" && index + 1 < command.length) {
      token += character + command[index + 1];
      index += 1;
      continue;
    }

    if (quote) {
      if (
        quote === "\"" &&
        (character === "`" || (character === "$" && nextCharacter === "("))
      ) {
        return {
          tokens: [],
          error: "command substitution is not read-only safe",
        };
      }
      if (character === quote) {
        quote = undefined;
      } else {
        token += character;
      }
      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }

    if (character === ">" || character === "<" || character === "(" || character === ")") {
      return { tokens: [], error: "shell redirection or subshell is not read-only safe" };
    }

    if (character === ";" || character === "|") {
      if (token) {
        tokens.push(token);
        token = "";
      }

      if (character === "|" && nextCharacter === "|") {
        tokens.push("||");
        index += 1;
      } else {
        tokens.push(character);
      }
      continue;
    }

    if (character === "&") {
      if (nextCharacter === "&") {
        if (token) {
          tokens.push(token);
          token = "";
        }
        tokens.push("&&");
        index += 1;
        continue;
      }
      return { tokens: [], error: "background execution is not read-only safe" };
    }

    token += character;
  }

  if (quote) {
    return { tokens: [], error: "unterminated quote" };
  }

  if (token) {
    tokens.push(token);
  }

  return { tokens };
}

function isShellAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function isUnsafeReadOnlyArgument(commandName: string, args: string[]): boolean {
  const unsafeArgs = UNSAFE_READ_ONLY_ARGS[commandName];
  if (!unsafeArgs) return false;

  return args.some((arg) =>
    unsafeArgs.some(
      (unsafeArg) => arg === unsafeArg || arg.startsWith(`${unsafeArg}=`),
    ),
  );
}

function isReadOnlyGitCommand(args: string[]): boolean {
  const subcommand = args.find((arg) => !arg.startsWith("-"));
  return typeof subcommand === "string" && READ_ONLY_GIT_SUBCOMMANDS.has(subcommand);
}

function isReadOnlyBashSegment(tokens: string[]): boolean {
  let commandIndex = tokens.findIndex((token) => !isShellAssignment(token));
  if (commandIndex < 0) return false;

  let commandName = tokens[commandIndex];
  if (commandName === "command" || commandName === "builtin") {
    commandIndex += 1;
    commandName = tokens[commandIndex];
  }

  if (commandName === "env") {
    commandIndex += 1;
    while (
      commandIndex < tokens.length &&
      (tokens[commandIndex].startsWith("-") ||
        isShellAssignment(tokens[commandIndex]))
    ) {
      commandIndex += 1;
    }
    commandName = tokens[commandIndex];
  }

  if (!commandName || !READ_ONLY_BASH_COMMANDS.has(commandName)) {
    return false;
  }

  const args = tokens.slice(commandIndex + 1);
  if (isUnsafeReadOnlyArgument(commandName, args)) {
    return false;
  }

  if (commandName === "git") {
    return isReadOnlyGitCommand(args);
  }

  return true;
}

function isReadOnlyBash(command: string): boolean {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) return false;

  const tokenizeResult = tokenizeBashCommand(normalizedCommand);
  if (tokenizeResult.error) return false;

  const segments: string[][] = [[]];
  for (const token of tokenizeResult.tokens) {
    if (SHELL_SEPARATORS.has(token)) {
      if (segments[segments.length - 1].length === 0) return false;
      segments.push([]);
      continue;
    }
    segments[segments.length - 1].push(token);
  }

  if (segments[segments.length - 1].length === 0) return false;
  return segments.every(isReadOnlyBashSegment);
}

function getDefaultTempRoots(): string[] {
  return [os.tmpdir(), process.env.TMPDIR, process.env.TMP, process.env.TEMP]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => path.resolve(value));
}

function normalizeRoot(root: string): string {
  return path.resolve(root);
}

function isWithinRoot(candidatePath: string, root: string): boolean {
  const normalizedCandidate = path.resolve(candidatePath);
  const normalizedRoot = normalizeRoot(root);
  const relativePath = path.relative(normalizedRoot, normalizedCandidate);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function resolveTargetPath(targetPath: string, workspaceRoot?: string): string {
  if (targetPath.startsWith("~")) {
    return path.resolve(os.homedir(), targetPath.slice(1));
  }
  if (path.isAbsolute(targetPath)) {
    return path.resolve(targetPath);
  }
  return path.resolve(workspaceRoot ?? process.cwd(), targetPath);
}

function isPathWithinAllowedRoots(
  targetPath: string,
  workspaceRoot: string | undefined,
  tempRoots: readonly string[],
): boolean {
  if (!workspaceRoot) return true;

  const resolvedPath = resolveTargetPath(targetPath, workspaceRoot);
  const allowedRoots = [workspaceRoot, ...tempRoots].map(normalizeRoot);
  return allowedRoots.some((root) => isWithinRoot(resolvedPath, root));
}

function getWorkspaceRelativePath(
  targetPath: string,
  workspaceRoot: string | undefined,
): string {
  const normalizedTargetPath = targetPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!path.isAbsolute(targetPath) || !workspaceRoot) {
    return normalizedTargetPath;
  }

  return path
    .relative(path.resolve(workspaceRoot), path.resolve(targetPath))
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
}

function isAgentsRootEnumerationPath(
  targetPath: string,
  workspaceRoot: string | undefined,
): boolean {
  const relativePath = getWorkspaceRelativePath(targetPath, workspaceRoot);
  return (
    relativePath === ".agents" ||
    relativePath === ".agents/*" ||
    relativePath === ".agents/**"
  );
}

function isOrchestratorTaskIndexPath(
  targetPath: string,
  workspaceRoot: string | undefined,
): boolean {
  const relativePath = getWorkspaceRelativePath(targetPath, workspaceRoot);
  const pathSegments = relativePath.split("/").filter(Boolean);
  return (
    pathSegments.length === 3 &&
    pathSegments[0] === ".agents" &&
    pathSegments[2] === "task.md"
  );
}

function isPathLikeToken(token: string): boolean {
  if (!token || token.startsWith("-") || isShellAssignment(token)) return false;
  if (token.startsWith("/") || token.startsWith(".") || token.startsWith("~")) {
    return true;
  }
  return token.includes("/");
}

function splitBashSegments(tokens: string[]): string[][] {
  const segments: string[][] = [[]];
  for (const token of tokens) {
    if (SHELL_SEPARATORS.has(token)) {
      if (segments[segments.length - 1].length > 0) {
        segments.push([]);
      }
      continue;
    }
    segments[segments.length - 1].push(token);
  }
  return segments.filter((segment) => segment.length > 0);
}

function getSegmentCommandIndex(tokens: string[]): number {
  let commandIndex = tokens.findIndex((token) => !isShellAssignment(token));
  if (commandIndex < 0) return -1;

  const commandName = tokens[commandIndex];
  if (commandName === "command" || commandName === "builtin") {
    commandIndex += 1;
  }

  if (tokens[commandIndex] === "env") {
    commandIndex += 1;
    while (
      commandIndex < tokens.length &&
      (tokens[commandIndex].startsWith("-") ||
        isShellAssignment(tokens[commandIndex]))
    ) {
      commandIndex += 1;
    }
  }

  return commandIndex < tokens.length ? commandIndex : -1;
}

function hasInlineScriptExecution(tokens: string[]): boolean {
  return splitBashSegments(tokens).some((segment) => {
    const commandIndex = getSegmentCommandIndex(segment);
    if (commandIndex < 0) return false;

    const commandName = segment[commandIndex];
    if (!INLINE_SCRIPT_COMMANDS.has(commandName)) return false;

    return segment
      .slice(commandIndex + 1)
      .some(
        (arg) =>
          INLINE_SCRIPT_FLAGS.has(arg) ||
          [...INLINE_SCRIPT_FLAGS].some((flag) => arg.startsWith(`${flag}=`)),
      );
  });
}

function isWorkspaceBoundedBash(
  args: Record<string, unknown>,
  workspaceRoot: string | undefined,
  tempRoots: readonly string[],
): boolean {
  if (!workspaceRoot) return true;

  const command = getBashCommand(args);
  const tokenizeResult = tokenizeBashCommand(command);
  if (tokenizeResult.error) return false;

  const workdir = args["workdir"];
  const effectiveWorkdir =
    typeof workdir === "string" && workdir.length > 0 ? workdir : workspaceRoot;
  if (!isPathWithinAllowedRoots(effectiveWorkdir, workspaceRoot, tempRoots)) {
    return false;
  }

  if (hasInlineScriptExecution(tokenizeResult.tokens)) {
    return false;
  }

  return tokenizeResult.tokens.every((token) => {
    if (!isPathLikeToken(token)) return true;
    return isPathWithinAllowedRoots(token, effectiveWorkdir, tempRoots);
  });
}

function targetsAgentsRootEnumeration(
  command: string,
  workspaceRoot: string | undefined,
): boolean {
  const tokenizeResult = tokenizeBashCommand(command);
  if (tokenizeResult.error) return false;

  return tokenizeResult.tokens.some((token) => {
    if (!isPathLikeToken(token)) return false;
    return isAgentsRootEnumerationPath(token, workspaceRoot);
  });
}

// ---------------------------------------------------------------------------
// 권한 집행 함수
// ---------------------------------------------------------------------------

/** 집행 결과 */
export interface EnforcementResult {
  allowed: boolean;
  reason: string;
}

export interface EnforcePermissionOptions {
  /** orchestrator task 위임에 사용할 현재 활성 서브에이전트 목록. */
  subagentNames?: readonly AgentName[];
  /** 작업공간 루트. worker의 workspace/temp 경계 검증에 사용한다. */
  workspaceRoot?: string;
  /** 작업공간 밖에서 허용할 임시 디렉터리 루트. 미지정 시 OS/env 기본값을 쓴다. */
  tempRoots?: readonly string[];
}

/**
 * tool.execute.before 훅에서 호출하는 권한 집행 함수.
 *
 * 처리 흐름:
 * 1. 호출 에이전트를 sessionAgentMap에서 해석
 * 2. 도구 종류를 정규화
 * 3. `.agents/**` 대상이면 모든 에이전트에 즉시 허용 (베이스라인)
 * 4. 정책 테이블 조회 후 허용/거부 판단
 * 5. Fail-safe: 에이전트 미확인 시 변경 도구 거부, 읽기 허용
 *
 * @param input - 도구 이름, 세션 ID, 도구 인자
 * @param sessionAgentMap - 세션→에이전트 맵
 * @returns EnforcementResult
 */
export function enforcePermission(
  input: {
    tool: string;
    sessionID: string;
    args: Record<string, unknown>;
  },
  sessionAgentMap: Map<string, AgentName>,
  options?: EnforcePermissionOptions,
): EnforcementResult {
  const toolName = input.tool.toLowerCase();
  const agent = resolveAgent(input.sessionID, sessionAgentMap);
  const allowedSubagentNames = options?.subagentNames ?? SUBAGENT_NAMES;
  const tempRoots = options?.tempRoots ?? getDefaultTempRoots();

  // -------------------------------------------------------------------------
  // 도구 분류
  // -------------------------------------------------------------------------
  const isReadTool =
    toolName === "read" ||
    toolName === "glob" ||
    toolName === "grep" ||
    toolName === "list" ||
    toolName === "lsp" ||
    toolName === "codesearch" ||
    toolName === "ast_grep_search";

  const isEditTool =
    toolName === "edit" ||
    toolName === "write" ||
    toolName === "apply_patch" ||
    toolName === "ast_grep_replace";

  const isBashTool = toolName === "bash";
  const isWebfetchTool = toolName === "webfetch";
  const isTaskTool = toolName === "task";

  // -------------------------------------------------------------------------
  // Fail-safe: 에이전트 미확인
  // -------------------------------------------------------------------------
  if (!agent) {
    if (isReadTool) {
      return {
        allowed: true,
        reason: `[fail-safe] 에이전트 미확인 — 읽기 전용 도구(${toolName}) 허용`,
      };
    }
    return {
      allowed: false,
      reason: `[fail-safe] 에이전트 미확인 — 변경 도구(${toolName}) 거부. sessionID=${input.sessionID}`,
    };
  }

  // -------------------------------------------------------------------------
  // 정책 테이블 조회
  // -------------------------------------------------------------------------
  const policy = POLICY_MAP.get(agent);
  if (!policy) {
    // 알 수 없는 에이전트명은 거부 (방어 코드)
    return {
      allowed: false,
      reason: `[policy] 알 수 없는 에이전트 '${agent}' — 모든 도구 거부`,
    };
  }

  // -------------------------------------------------------------------------
  // 대상 경로 추출 및 경계 집행 (edit/write/read 계열 도구)
  // -------------------------------------------------------------------------
  const targetPaths = extractTargetPaths(input.args, toolName);
  const targetPath = targetPaths[0];

  if (targetPaths.length > 0) {
    const boundaryPolicy = isEditTool
      ? policy.paths.sourceEdit
      : isReadTool
        ? policy.paths.sourceRead
        : "any";
    if (boundaryPolicy === "workspace-or-temp") {
      const outsidePath = targetPaths.find(
        (pathValue) =>
          !isPathWithinAllowedRoots(
            pathValue,
            options?.workspaceRoot,
            tempRoots,
          ),
      );
      if (outsidePath) {
        return {
          allowed: false,
          reason: `[policy] ${agent}: workspace/temp 밖 경로 접근 거부 — tool=${toolName}, path=${outsidePath}`,
        };
      }
    }
  } else if (isEditTool && policy.paths.sourceEdit === "workspace-or-temp") {
    return {
      allowed: false,
      reason: `[policy] ${agent}: 대상 경로 없는 편집/쓰기 도구 거부 — tool=${toolName}`,
    };
  }

  // -------------------------------------------------------------------------
  // 베이스라인: .agents/** 는 모든 에이전트에게 항상 허용
  // -------------------------------------------------------------------------
  if (targetPaths.length > 0) {
    const categories = targetPaths.map(classifyPath);
    if (
      categories.every((category) => category === "agents") &&
      agent === "planner" &&
      toolName === "edit"
    ) {
      return {
        allowed: false,
        reason:
          "[policy] planner는 plan.md 산출물에 write만 허용 — edit 금지",
      };
    }
    if (categories.every((category) => category === "agents")) {
      const outsideWorkspaceArtifactPath = targetPaths.find(
        (pathValue) =>
          !isPathWithinAllowedRoots(pathValue, options?.workspaceRoot, []),
      );
      if (outsideWorkspaceArtifactPath) {
        return {
          allowed: false,
          reason: `[baseline] .agents/** 산출물은 workspace 내부만 허용 — path=${outsideWorkspaceArtifactPath}`,
        };
      }
      const rootEnumerationPath = targetPaths.find((pathValue) =>
        isAgentsRootEnumerationPath(pathValue, options?.workspaceRoot),
      );
      if (agent === "orchestrator" && isReadTool && rootEnumerationPath) {
        return {
          allowed: false,
          reason: `[policy] orchestrator는 .agents 루트/전체 산출물 목록 열람 금지 — tool=${toolName}, path=${rootEnumerationPath}`,
        };
      }
      const subagentArtifactPath = targetPaths.find(
        (pathValue) =>
          agent === "orchestrator" &&
          isReadTool &&
          !isOrchestratorTaskIndexPath(pathValue, options?.workspaceRoot),
      );
      if (subagentArtifactPath) {
        return {
          allowed: false,
          reason: `[policy] orchestrator는 서브에이전트 산출물 본문 열람 금지 — tool=${toolName}, path=${subagentArtifactPath}`,
        };
      }
      return {
        allowed: true,
        reason: `[baseline] .agents/** 경로는 모든 에이전트에 허용 — agent=${agent}, tool=${toolName}, path=${targetPath}`,
      };
    }
  }

  // -------------------------------------------------------------------------
  // task 도구 집행
  // -------------------------------------------------------------------------
  if (isTaskTool) {
    if (policy.tools.task === "deny") {
      return {
        allowed: false,
        reason: `[policy] ${agent}는 task 위임 불가 (재위임 금지)`,
      };
    }

    if (policy.tools.task === "to-subagents") {
      // orchestrator만 해당: 7개 서브에이전트에게만 위임 허용
      const subagentType = input.args["subagent_type"];
      if (typeof subagentType !== "string" || subagentType.trim() === "") {
        return {
          allowed: true,
          reason: `[policy] ${agent}: task — subagent_type 미지정, 허용 (하위 처리에서 검증)`,
        };
      }
      const targetAgent = subagentType.trim();
      if ((allowedSubagentNames as readonly string[]).includes(targetAgent)) {
        return {
          allowed: true,
          reason: `[policy] ${agent}: task → ${targetAgent} 허용`,
        };
      }
      return {
        allowed: false,
        reason: `[policy] ${agent}는 '${targetAgent}'에게 위임 불가 — 허용된 서브에이전트: ${allowedSubagentNames.join(", ")}`,
      };
    }

    // policy.task === 'allow' (미래 확장용)
    return { allowed: true, reason: `[policy] ${agent}: task 허용` };
  }

  // -------------------------------------------------------------------------
  // bash 도구 집행
  // -------------------------------------------------------------------------
  if (isBashTool) {
    const bashCommand = getBashCommand(input.args);
    if (policy.tools.bash === "deny") {
      return {
        allowed: false,
        reason: `[policy] ${agent}는 bash 실행 불가`,
      };
    }
    const disabledMcpCommand = isDisabledMcpCommandUsed(bashCommand);
    if (disabledMcpCommand) {
      return {
        allowed: false,
        reason: `[policy] 비활성 MCP 명령은 bash로 우회 실행 불가 — command=${disabledMcpCommand}`,
      };
    }
    if (
      agent === "orchestrator" &&
      targetsAgentsRootEnumeration(bashCommand, options?.workspaceRoot)
    ) {
      return {
        allowed: false,
        reason: "[policy] orchestrator는 bash로 .agents 루트/전체 산출물 목록 열람 금지",
      };
    }
    if (policy.tools.bash === "read-only") {
      if (isReadOnlyBash(bashCommand)) {
        return {
          allowed: true,
          reason: `[policy] ${agent}: 읽기 전용 bash 허용`,
        };
      }
      return {
        allowed: false,
        reason: `[policy] ${agent}: 읽기 전용으로 분류되지 않은 bash 거부`,
      };
    }
    if (policy.paths.bash === "workspace-or-temp") {
      if (!isWorkspaceBoundedBash(input.args, options?.workspaceRoot, tempRoots)) {
        return {
          allowed: false,
          reason: `[policy] ${agent}: workspace/temp 밖 bash 접근 또는 안전하지 않은 인라인 실행 거부`,
        };
      }
    }
    return { allowed: true, reason: `[policy] ${agent}: bash 허용` };
  }

  // -------------------------------------------------------------------------
  // webfetch 도구 집행
  // -------------------------------------------------------------------------
  if (isWebfetchTool) {
    if (policy.tools.webfetch === "deny") {
      return {
        allowed: false,
        reason: `[policy] ${agent}는 webfetch 불가`,
      };
    }
    return { allowed: true, reason: `[policy] ${agent}: webfetch 허용` };
  }

  // -------------------------------------------------------------------------
  // 편집/쓰기 도구 집행
  // -------------------------------------------------------------------------
  if (isEditTool) {
    if (policy.tools.sourceEdit === "deny") {
      return {
        allowed: false,
        reason: `[policy] ${agent}는 source 편집/쓰기 불가 — tool=${toolName}${targetPath ? `, path=${targetPath}` : ""}`,
      };
    }
    return {
      allowed: true,
      reason: `[policy] ${agent}: source 편집/쓰기 허용 — tool=${toolName}`,
    };
  }

  // -------------------------------------------------------------------------
  // 읽기 도구 집행
  // -------------------------------------------------------------------------
  if (isReadTool) {
    if (policy.tools.sourceRead === "deny") {
      return {
        allowed: false,
        reason: `[policy] ${agent}는 source 읽기 불가`,
      };
    }

    if (policy.tools.sourceRead === "docs-only") {
      // targetPath가 없으면(glob/grep에 범위 미지정 → repo 전체 탐색) 거부
      if (!targetPath) {
        return {
          allowed: false,
          reason: `[policy] ${agent}는 docs/**만 읽기 허용 — 탐색 범위 미지정(repo 전체) 거부: tool=${toolName}. docs/ 하위 경로를 명시하라`,
        };
      }
      const category = classifyPath(targetPath);
      if (category === "source") {
        return {
          allowed: false,
          reason: `[policy] ${agent}는 docs/**만 읽기 허용 — 거부된 경로: ${targetPath}`,
        };
      }
    }

    return {
      allowed: true,
      reason: `[policy] ${agent}: 읽기 허용 — tool=${toolName}`,
    };
  }

  // -------------------------------------------------------------------------
  // 그 외 도구: 기본 허용 (glob, list, lsp 등 조회 도구)
  // -------------------------------------------------------------------------
  return {
    allowed: true,
    reason: `[policy] ${agent}: 기타 도구(${toolName}) 기본 허용`,
  };
}

// ---------------------------------------------------------------------------
// 내부 유틸: 도구 인자에서 대상 경로 추출
// ---------------------------------------------------------------------------

/**
 * 도구 인자 객체에서 대상 파일/디렉터리 경로를 추출한다.
 * 도구마다 경로 키 이름이 다르므로 알려진 키를 순서대로 시도한다.
 *
 * glob/grep: 탐색 범위 경로(path 키)를 반환한다. 미지정이면 undefined.
 * apply_patch: diff 본문(`input` 또는 `patchText`)에서 단일 대상 경로를 파싱한다.
 */
function extractTargetPaths(
  args: Record<string, unknown>,
  toolName: string,
): string[] {
  if (toolName === "bash") {
    // bash는 경로가 아니라 명령어이므로 별도 분류
    return [];
  }

  if (toolName === "webfetch") {
    // webfetch는 URL이므로 경로 분류 불필요
    return [];
  }

  if (toolName === "task") {
    // task는 subagent_type으로 처리 (enforcePermission에서 직접 처리)
    return [];
  }

  // -----------------------------------------------------------------------
  // glob: 탐색 범위는 `path` 또는 `glob` 키
  // -----------------------------------------------------------------------
  if (toolName === "glob") {
    const scopePath = args["path"] ?? args["glob"];
    return typeof scopePath === "string" && scopePath.length > 0
      ? [scopePath]
      : [];
  }

  // -----------------------------------------------------------------------
  // grep: 탐색 범위는 `path` 키; `include`/`glob`은 파일 패턴이므로 경로로 보지 않음
  // -----------------------------------------------------------------------
  if (toolName === "grep") {
    const scopePath = args["path"];
    return typeof scopePath === "string" && scopePath.length > 0
      ? [scopePath]
      : [];
  }

  // -----------------------------------------------------------------------
  // apply_patch: `input` 또는 `patchText` 인자(diff 본문)에서 단일 대상 경로를 파싱
  // -----------------------------------------------------------------------
  if (toolName === "apply_patch") {
    const input = args["input"] ?? args["patchText"];
    if (typeof input === "string") {
      const paths = new Set<string>();
      const patterns = [
        /^\*\*\* Add File: (.+)$/gm,
        /^\*\*\* Update File: (.+)$/gm,
        /^\*\*\* Delete File: (.+)$/gm,
        /^\+\+\+ b\/(.+)$/gm,
      ];

      for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(input)) !== null) {
          if (match[1]) paths.add(match[1].trim());
        }
      }

      return [...paths];
    }
    // input이 없거나 파싱 불가 — 경로 미확정 (edit 분기에서 sourceEdit=deny로 처리)
    return [];
  }

  // -----------------------------------------------------------------------
  // 그 외 도구: 일반적인 파일 경로 키 이름들 (우선순위 순)
  // -----------------------------------------------------------------------
  const pathKeys = [
    "path",
    "filePath",
    "file_path",
    "file",
    "directory",
    "dir",
  ] as const;
  for (const key of pathKeys) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) {
      return [value];
    }
  }

  return [];
}
