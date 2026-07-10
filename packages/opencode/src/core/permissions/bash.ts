/**
 * permissions/bash.ts — bash 토큰화·읽기전용/워크스페이스 경계 판별
 */

import {
  getRunArtifactIdentity,
  inspectPath,
  isPathWithinAllowedRoots,
  resolveTargetPath,
} from "./path";

export function getBashCommand(args: Record<string, unknown>): string {
  const command = args["command"];
  return typeof command === "string" ? command : "";
}

function getDisabledMcpCommands(): string[] {
  return (process.env.OPENCODE_DISABLED_MCP_COMMANDS ?? "")
    .split(",")
    .map((command) => command.trim())
    .filter(Boolean);
}

export function isDisabledMcpCommandUsed(command: string): string | undefined {
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
  "shasum",
  "sha1sum",
  "sha256sum",
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
  "grep",
  "log",
  "ls-files",
  "rev-list",
  "rev-parse",
  "show-ref",
  "status",
]);

const SHELL_SEPARATORS = new Set([";", "|", "&&", "||"]);

const UNSAFE_READ_ONLY_ARGS: Record<string, readonly string[]> = {
  git: ["--paginate", "--exec-path", "--config-env", "--ext-diff", "--textconv"],
  rg: ["--pre", "--pre-glob"],
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

const SCRIPT_FILE_PATTERN = /\.(?:bash|cjs|js|mjs|php|pl|py|rb|sh|zsh)$/i;
const PACKAGE_EXEC_COMMANDS = new Set(["bunx", "npx"]);
const PACKAGE_EXEC_SUBCOMMANDS = new Set(["dlx", "exec", "x"]);
const DYNAMIC_EXECUTION_COMMANDS = new Set([
  ".",
  "awk",
  "eval",
  "sed",
  "source",
  "xargs",
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

    if (character === "\n" || character === "\r") {
      return { tokens: [], error: "multi-line shell input is not safe" };
    }

    if (quote === "'") {
      if (character === "'") {
        quote = undefined;
      } else {
        token += character;
      }
      continue;
    }

    if (quote === "\"") {
      if (
        character === "`" ||
        (character === "$" && nextCharacter === "(")
      ) {
        return {
          tokens: [],
          error: "command substitution is not read-only safe",
        };
      }
      if (character === "\"") {
        quote = undefined;
      } else if (character === "\\" && index + 1 < command.length) {
        token += nextCharacter;
        index += 1;
      } else {
        token += character;
      }
      continue;
    }

    if (character === "`") {
      return { tokens: [], error: "command substitution is not read-only safe" };
    }

    if (character === "$" && nextCharacter === "(") {
      return { tokens: [], error: "command substitution is not read-only safe" };
    }

    if (character === "\\" && index + 1 < command.length) {
      token += command[index + 1];
      index += 1;
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
  return (
    typeof subcommand === "string" &&
    READ_ONLY_GIT_SUBCOMMANDS.has(subcommand) &&
    !args.some((arg) => arg === "-c" || arg.startsWith("-c="))
  );
}

function isReadOnlyBashSegment(tokens: string[]): boolean {
  if (tokens.some(isShellAssignment)) return false;

  let commandIndex = 0;
  if (commandIndex < 0) return false;

  let commandName = tokens[commandIndex];
  if (commandName === "command" || commandName === "builtin") {
    commandIndex += 1;
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

export function isReadOnlyBash(command: string): boolean {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) return false;
  if (/[\r\n]/.test(command)) return false;

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

function hasScriptExecution(tokens: string[]): boolean {
  return splitBashSegments(tokens).some((segment) => {
    const commandIndex = getSegmentCommandIndex(segment);
    if (commandIndex < 0) return false;

    const commandName = segment[commandIndex];
    const commandArgs = segment.slice(commandIndex + 1);
    if (INLINE_SCRIPT_COMMANDS.has(commandName)) return true;
    if (DYNAMIC_EXECUTION_COMMANDS.has(commandName)) return true;
    if (PACKAGE_EXEC_COMMANDS.has(commandName)) return true;
    if (
      ["bun", "npm", "pnpm", "yarn"].includes(commandName) &&
      commandArgs.some((arg) => PACKAGE_EXEC_SUBCOMMANDS.has(arg))
    ) {
      return true;
    }
    if (isPathLikeToken(commandName) || SCRIPT_FILE_PATTERN.test(commandName)) {
      return true;
    }
    if (
      commandName === "find" &&
      commandArgs.some((arg) =>
        ["-exec", "-execdir", "-ok", "-okdir"].includes(arg),
      )
    ) {
      return true;
    }
    return commandArgs.some(
      (arg) => !arg.startsWith("-") && SCRIPT_FILE_PATTERN.test(arg),
    );
  });
}

function getAssignmentValue(token: string): string | undefined {
  if (!isShellAssignment(token)) return undefined;
  return token.slice(token.indexOf("=") + 1);
}

function getEmbeddedOptionPath(token: string): string | undefined {
  if (!token.startsWith("-")) return undefined;
  const equalsIndex = token.indexOf("=");
  if (equalsIndex >= 0) return token.slice(equalsIndex + 1);
  const traversalIndex = token.indexOf("..");
  if (traversalIndex >= 0) return token.slice(traversalIndex);
  const absoluteIndex = token.indexOf("/");
  if (absoluteIndex >= 0) return token.slice(absoluteIndex);
  const homeIndex = token.indexOf("~");
  return homeIndex >= 0 ? token.slice(homeIndex) : undefined;
}

function getPotentialPathTokens(tokens: string[]): string[] {
  const pathTokens: string[] = [];
  for (const segment of splitBashSegments(tokens)) {
    const commandIndex = getSegmentCommandIndex(segment);
    if (commandIndex < 0) continue;
    for (const token of segment.slice(0, commandIndex)) {
      const assignmentValue = getAssignmentValue(token);
      if (assignmentValue) pathTokens.push(assignmentValue);
    }
    for (const token of segment.slice(commandIndex + 1)) {
      const assignmentValue = getAssignmentValue(token);
      if (assignmentValue !== undefined) {
        if (assignmentValue) pathTokens.push(assignmentValue);
        continue;
      }
      const embeddedPath = getEmbeddedOptionPath(token);
      if (embeddedPath) {
        pathTokens.push(embeddedPath);
        continue;
      }
      if (!token.startsWith("-")) pathTokens.push(token);
    }
  }
  return pathTokens;
}

export function isWorkspaceBoundedBash(
  args: Record<string, unknown>,
  workspaceRoot: string | undefined,
  tempRoots: readonly string[],
): boolean {
  if (!workspaceRoot) return true;

  const command = getBashCommand(args);
  if (!command.trim()) return false;
  const tokenizeResult = tokenizeBashCommand(command);
  if (tokenizeResult.error) return false;
  if (/\$(?:\{|[A-Za-z_0-9@*#?$!-])/.test(command)) return false;

  const workdir = args["workdir"];
  const effectiveWorkdir =
    typeof workdir === "string" && workdir.length > 0 ? workdir : workspaceRoot;
  if (!isPathWithinAllowedRoots(effectiveWorkdir, workspaceRoot, tempRoots)) {
    return false;
  }

  if (hasScriptExecution(tokenizeResult.tokens)) {
    return false;
  }

  return getPotentialPathTokens(tokenizeResult.tokens).every((token) =>
    isPathWithinAllowedRoots(
      resolveTargetPath(token, effectiveWorkdir),
      workspaceRoot,
      tempRoots,
    ),
  );
}

export function targetsRunArtifact(
  command: string,
  workspaceRoot: string | undefined,
): boolean {
  const tokenizeResult = tokenizeBashCommand(command);
  if (tokenizeResult.error) return false;

  return tokenizeResult.tokens.some((token) => {
    if (!isPathLikeToken(token)) return false;
    return inspectPath(token, workspaceRoot).category === "agents";
  });
}

export function targetsRestrictedOrchestratorArtifact(
  command: string,
  workspaceRoot: string | undefined,
): boolean {
  const tokenizeResult = tokenizeBashCommand(command);
  if (tokenizeResult.error) return false;

  return tokenizeResult.tokens.some((token) => {
    if (!isPathLikeToken(token)) return false;
    const inspectedPath = inspectPath(token, workspaceRoot);
    if (inspectedPath.category !== "agents") return false;
    return getRunArtifactIdentity(token, workspaceRoot)?.owner !== "orchestrator";
  });
}
