/**
 * permissions/bash.ts — bash 토큰화·읽기전용/워크스페이스 경계 판별
 */

import path from "node:path";
import {
  getRunArtifactIdentity,
  inspectPath,
  isPathWithinAllowedRoots,
  resolveTargetPath,
  type RunArtifactIdentity,
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

// worker의 workspace/temp 경계는 임의 실행 파일을 포함하지 않는다. 파일 변경
// 수단이나 외부 실행 기능이 없는 직접 조회 명령만 명시적으로 허용한다.
const WORKSPACE_BOUNDED_DIRECT_COMMANDS = new Set([
  "basename",
  "cat",
  "cmp",
  "comm",
  "cut",
  "df",
  "dirname",
  "du",
  "echo",
  "egrep",
  "false",
  "fgrep",
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
]);

function optionSet(options: string): ReadonlySet<string> {
  return new Set(options.split(" "));
}

const SAFE_GIT_OPTIONS: Record<string, ReadonlySet<string>> = {
  log: optionSet("--oneline --abbrev-commit --no-abbrev-commit --no-decorate --stat --shortstat --numstat --name-only --name-status --summary --graph --all --first-parent --merges --no-merges --reverse --topo-order --date-order --author-date-order --fixed-strings --regexp-ignore-case"),
  "ls-files": optionSet("-c --cached -d --deleted -m --modified -o --others -i --ignored -s --stage -u --unmerged -k --killed --directory --no-empty-directory --error-unmatch --full-name --recurse-submodules -z"),
  "rev-list": optionSet("--all --first-parent --merges --no-merges --reverse --topo-order --date-order --objects --objects-edge --count --quiet"),
  "rev-parse": optionSet("--verify --quiet -q --short --symbolic --symbolic-full-name --abbrev-ref --show-toplevel --show-prefix --show-cdup --show-superproject-working-tree --is-inside-work-tree --is-bare-repository --is-shallow-repository --git-dir --absolute-git-dir"),
  "show-ref": optionSet("--head --heads --tags -d --dereference --verify --exists --hash --abbrev --quiet -q"),
  grep: optionSet("-n --line-number -i --ignore-case -w --word-regexp -v --invert-match -E --extended-regexp -G --basic-regexp -F --fixed-strings -P --perl-regexp -l --files-with-matches -L --files-without-match -c --count --break --heading -h -H --full-name --recurse-submodules"),
};

const SAFE_GIT_OPTION_PREFIXES: Record<string, readonly string[]> = {
  log: "--decorate= --max-count= --since= --until= --author= --grep= --date= --branches= --tags= --remotes=".split(" "),
  "ls-files": "--abbrev=".split(" "),
  "rev-list": "--max-count= --since= --until= --author=".split(" "),
  "rev-parse": "--short= --abbrev-ref=".split(" "),
  "show-ref": "--hash= --abbrev=".split(" "),
  grep: "--max-depth= --threads= --context= --after-context= --before-context=".split(" "),
};

const SAFE_GIT_OPTIONS_WITH_VALUE: Record<string, ReadonlySet<string>> = {
  log: optionSet("-n --max-count --since --until --author --grep --date"),
  "rev-list": optionSet("-n --max-count --since --until --author"),
  grep: optionSet("-e --regexp -A -B -C --after-context --before-context --context --max-depth --threads"),
};

const SHELL_SEPARATORS = new Set([";", "|", "&&", "||"]);

const UNSAFE_READ_ONLY_ARGS: Record<string, readonly string[]> = {
  git: ["--paginate", "--exec-path", "--config-env", "--ext-diff", "--textconv"],
  rg: ["--pre", "--pre-glob"],
};

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
  let subcommandIndex = 0;
  let hasNoPager = false;
  while (subcommandIndex < args.length && args[subcommandIndex].startsWith("-")) {
    const option = args[subcommandIndex];
    if (option !== "--no-pager" && option !== "-P") return false;
    hasNoPager = true;
    subcommandIndex += 1;
  }

  const subcommand = args[subcommandIndex];
  if (!subcommand || !READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) return false;
  if ((subcommand === "log" || subcommand === "grep") && !hasNoPager) {
    return false;
  }

  const safeOptions = SAFE_GIT_OPTIONS[subcommand] ?? new Set<string>();
  const safePrefixes = SAFE_GIT_OPTION_PREFIXES[subcommand] ?? [];
  const optionsWithValue =
    SAFE_GIT_OPTIONS_WITH_VALUE[subcommand] ?? new Set<string>();
  const subcommandArgs = args.slice(subcommandIndex + 1);
  let afterPathSeparator = false;
  for (let index = 0; index < subcommandArgs.length; index += 1) {
    const argument = subcommandArgs[index];
    if (afterPathSeparator) continue;
    if (argument === "--") {
      afterPathSeparator = true;
      continue;
    }
    if (!argument.startsWith("-")) continue;
    if (
      (subcommand === "log" || subcommand === "rev-list") &&
      /^-\d+$/.test(argument)
    ) {
      continue;
    }
    if (safeOptions.has(argument)) continue;
    if (safePrefixes.some((prefix) => argument.startsWith(prefix))) continue;
    if (optionsWithValue.has(argument)) {
      index += 1;
      if (index >= subcommandArgs.length) return false;
      continue;
    }
    return false;
  }
  return true;
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
    const commandIndex = 0;
    for (let index = 0; index < segment.length; index += 1) {
      const token = segment[index];
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
      if (index !== commandIndex && !token.startsWith("-")) {
        pathTokens.push(token);
      }
    }
  }
  return pathTokens;
}

function hasDynamicBoundedShellSyntax(command: string): boolean {
  // Shell expansion semantics are intentionally outside this classifier. A
  // bounded worker invocation must use literal operands and one command only.
  return /[\r\n<>;|&()`$*?\[\]{}~]/.test(command);
}

export function isWorkspaceBoundedBash(
  args: Record<string, unknown>,
  workspaceRoot: string | undefined,
  tempRoots: readonly string[],
): boolean {
  if (!workspaceRoot) return false;

  const command = getBashCommand(args);
  if (!command.trim()) return false;
  if (hasDynamicBoundedShellSyntax(command)) return false;
  const tokenizeResult = tokenizeBashCommand(command);
  if (tokenizeResult.error) return false;
  const segments = splitBashSegments(tokenizeResult.tokens);
  if (segments.length !== 1) return false;
  if (segments[0].some(isShellAssignment)) return false;
  const commandName = segments[0][0];
  if (
    !commandName ||
    !WORKSPACE_BOUNDED_DIRECT_COMMANDS.has(commandName) ||
    !isReadOnlyBashSegment(segments[0])
  ) {
    return false;
  }

  const workdir = args["workdir"];
  const effectiveWorkdirInput =
    typeof workdir === "string" && workdir.length > 0 ? workdir : workspaceRoot;
  if (!effectiveWorkdirInput) return false;
  if (
    !isPathWithinAllowedRoots(
      effectiveWorkdirInput,
      workspaceRoot,
      tempRoots,
    )
  ) {
    return false;
  }
  const effectiveWorkdir = resolveTargetPath(
    effectiveWorkdirInput,
    workspaceRoot,
  );
  if (inspectPath(effectiveWorkdir, workspaceRoot).category === "agents") {
    return false;
  }

  return getPotentialPathTokens(tokenizeResult.tokens).every((token) =>
    !token.split(/[\\/]/).includes("..") &&
    isPathWithinAllowedRoots(
      resolveTargetPath(token, effectiveWorkdir),
      workspaceRoot,
      tempRoots,
    ),
  );
}

export interface BashArtifactAccess {
  identities: RunArtifactIdentity[];
  invalidReason?: string;
}

export function inspectBashArtifactAccess(
  args: Record<string, unknown>,
  workspaceRoot: string | undefined,
): BashArtifactAccess {
  const command = getBashCommand(args);
  const tokenizeResult = tokenizeBashCommand(command);
  if (tokenizeResult.error) {
    return { identities: [], invalidReason: tokenizeResult.error };
  }

  const workdir = args["workdir"];
  const hasExplicitWorkdir = typeof workdir === "string" && workdir.length > 0;
  const effectiveWorkdirInput =
    hasExplicitWorkdir ? workdir : (workspaceRoot ?? process.cwd());
  const workdirInspection =
    workspaceRoot || hasExplicitWorkdir
      ? inspectPath(effectiveWorkdirInput, workspaceRoot)
      : undefined;
  if (workdirInspection && !workdirInspection.valid) {
    return {
      identities: [],
      invalidReason: `유효하지 않은 workdir: ${workdirInspection.reason ?? effectiveWorkdirInput}`,
    };
  }
  if (workdirInspection?.category === "agents") {
    return {
      identities: [],
      invalidReason: "산출물 디렉터리를 bash workdir로 사용할 수 없음",
    };
  }
  const effectiveWorkdir = resolveTargetPath(
    effectiveWorkdirInput,
    workspaceRoot,
  );

  const rawPathTokens = new Set<string>();
  for (const token of tokenizeResult.tokens) {
    const assignmentValue = getAssignmentValue(token);
    if (assignmentValue && isPathLikeToken(assignmentValue)) {
      rawPathTokens.add(assignmentValue);
    }
    const embeddedPath = getEmbeddedOptionPath(token);
    if (embeddedPath && isPathLikeToken(embeddedPath)) {
      rawPathTokens.add(embeddedPath);
    }
    if (isPathLikeToken(token)) rawPathTokens.add(token);
  }

  const identities = new Map<string, RunArtifactIdentity>();
  for (const targetPath of rawPathTokens) {
    if (targetPath.split(/[\\/]/).includes("..")) {
      return {
        identities: [...identities.values()],
        invalidReason: `bash 경로 traversal 거부: ${targetPath}`,
      };
    }
    const resolvedPath = resolveTargetPath(targetPath, effectiveWorkdir);
    const candidatePath =
      workspaceRoot || path.isAbsolute(targetPath) ? resolvedPath : targetPath;
    const inspection = inspectPath(candidatePath, workspaceRoot);
    if (inspection.category !== "agents") continue;
    const identity = getRunArtifactIdentity(candidatePath, workspaceRoot);
    if (!identity) {
      return {
        identities: [...identities.values()],
        invalidReason: `산출물 경로는 정확한 .agents/<taskId>/<workItemId>/<role-file>.md 형식이어야 함: ${targetPath}`,
      };
    }
    identities.set(identity.relativePath, identity);
  }

  return { identities: [...identities.values()] };
}
