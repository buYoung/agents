/**
 * permissions/path.ts — 경로 정규화·분류·워크스페이스/temp 경계
 */

import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AGENT_DOC_MAP,
  DOCUMENTED_AGENTS,
  RUN_DIR_ROOT,
  isValidTaskId,
  isValidWorkItemId,
  type DocumentedAgent,
} from "@opencode/core/doc-protocol";

/** 경로 분류 결과 */
export type PathCategory = "agents" | "docs" | "source";

export interface PathInspection {
  valid: boolean;
  category: PathCategory;
  resolvedPath: string;
  canonicalPath: string;
  workspaceRelativePath: string;
  reason?: string;
}

export interface RunArtifactIdentity {
  taskId: string;
  workItemId: string;
  owner: DocumentedAgent;
  relativePath: string;
}

const OWNER_BY_FILENAME = new Map<string, DocumentedAgent>(
  DOCUMENTED_AGENTS.map((agent) => [AGENT_DOC_MAP[agent], agent]),
);
const RUN_DIR_SEGMENTS = RUN_DIR_ROOT.split("/");

function normalizedInput(targetPath: string): string {
  return targetPath.replace(/\\/g, "/").replace(/\/+$/, "");
}

function hasTraversalSegment(targetPath: string): boolean {
  return normalizedInput(targetPath).split("/").includes("..");
}

function isWindowsAbsolutePath(targetPath: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(targetPath);
}

function canonicalizePath(resolvedPath: string): string {
  let existingPath = resolvedPath;
  const missingSegments: string[] = [];

  while (!fs.existsSync(existingPath)) {
    const parentPath = path.dirname(existingPath);
    if (parentPath === existingPath) break;
    missingSegments.unshift(path.basename(existingPath));
    existingPath = parentPath;
  }

  const canonicalExistingPath = fs.existsSync(existingPath)
    ? fs.realpathSync.native(existingPath)
    : path.resolve(existingPath);
  return path.resolve(canonicalExistingPath, ...missingSegments);
}

function normalizeRoot(root: string): string {
  return canonicalizePath(path.resolve(root));
}

function isWithinRoot(candidatePath: string, root: string): boolean {
  const relativePath = path.relative(root, candidatePath);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

function categoryFromRelativePath(relativePath: string): PathCategory {
  if (relativePath === ".agents" || relativePath.startsWith(".agents/")) {
    return "agents";
  }
  if (relativePath === "docs" || relativePath.startsWith("docs/")) {
    return "docs";
  }
  return "source";
}

/**
 * 경로를 먼저 정규화하고, 존재하는 상위 경로의 symlink까지 해소한 뒤
 * 분류한다. traversal 자체는 별칭으로 허용하지 않는다.
 */
export function inspectPath(
  targetPath: string,
  workspaceRoot?: string,
): PathInspection {
  const invalidReason = (() => {
    if (!targetPath || targetPath.includes("\0")) {
      return "비어 있거나 NUL을 포함한 경로";
    }
    if (hasTraversalSegment(targetPath)) {
      return ".. traversal 세그먼트";
    }
    if (path.isAbsolute(targetPath) && !workspaceRoot) {
      return "workspace 기준 없는 절대 경로";
    }
    if (isWindowsAbsolutePath(targetPath) && !path.isAbsolute(targetPath)) {
      return "현재 플랫폼에서 해석할 수 없는 절대 경로";
    }
    if (
      targetPath.startsWith("~") &&
      targetPath !== "~" &&
      !targetPath.startsWith("~/") &&
      !targetPath.startsWith("~\\")
    ) {
      return "지원하지 않는 사용자 홈 축약 경로";
    }
    return undefined;
  })();
  const safeTargetPath = targetPath.includes("\0") ? "" : targetPath;
  const resolvedPath = resolveTargetPath(safeTargetPath, workspaceRoot);
  const canonicalPath = canonicalizePath(resolvedPath);

  if (!workspaceRoot) {
    const relativePath = path.isAbsolute(targetPath)
      ? normalizedInput(targetPath)
      : normalizedInput(targetPath).replace(/^\.\//, "");
    return {
      valid: !invalidReason,
      category: path.isAbsolute(targetPath)
        ? "source"
        : categoryFromRelativePath(relativePath),
      resolvedPath,
      canonicalPath,
      workspaceRelativePath: relativePath,
      ...(invalidReason ? { reason: invalidReason } : {}),
    };
  }

  const canonicalWorkspaceRoot = normalizeRoot(workspaceRoot);
  const relativePath = path
    .relative(canonicalWorkspaceRoot, canonicalPath)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const isWithinWorkspace = isWithinRoot(
    canonicalPath,
    canonicalWorkspaceRoot,
  );

  return {
    valid: !invalidReason,
    category: isWithinWorkspace
      ? categoryFromRelativePath(relativePath)
      : "source",
    resolvedPath,
    canonicalPath,
    workspaceRelativePath: relativePath,
    ...(invalidReason ? { reason: invalidReason } : {}),
  };
}

/**
 * 분류만 필요한 기존 호출자를 위한 호환 래퍼. 권한 집행은 반드시
 * {@link inspectPath}의 `valid` 결과도 확인한다.
 */
export function classifyPath(
  targetPath: string,
  workspaceRoot?: string,
): PathCategory {
  return inspectPath(targetPath, workspaceRoot).category;
}

export function getRunArtifactIdentity(
  targetPath: string,
  workspaceRoot?: string,
): RunArtifactIdentity | undefined {
  const inspectedPath = inspectPath(targetPath, workspaceRoot);
  if (!inspectedPath.valid || inspectedPath.category !== "agents") {
    return undefined;
  }

  const segments = inspectedPath.workspaceRelativePath.split("/");
  if (
    segments.length !== RUN_DIR_SEGMENTS.length + 3 ||
    !RUN_DIR_SEGMENTS.every((segment, index) => segments[index] === segment)
  ) {
    return undefined;
  }

  const [taskId, workItemId, filename] = segments.slice(
    RUN_DIR_SEGMENTS.length,
  );
  const owner = OWNER_BY_FILENAME.get(filename);
  if (
    !owner ||
    !isValidTaskId(taskId) ||
    !isValidWorkItemId(workItemId)
  ) {
    return undefined;
  }

  return {
    taskId,
    workItemId,
    owner,
    relativePath: inspectedPath.workspaceRelativePath,
  };
}

export function getDefaultTempRoots(): string[] {
  return [os.tmpdir(), process.env.TMPDIR, process.env.TMP, process.env.TEMP]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.length > 0,
    )
    .map((value) => path.resolve(value));
}

export function resolveTargetPath(
  targetPath: string,
  workspaceRoot?: string,
): string {
  if (targetPath === "~") {
    return os.homedir();
  }
  if (targetPath.startsWith("~/") || targetPath.startsWith("~\\")) {
    return path.resolve(os.homedir(), targetPath.slice(2));
  }
  if (targetPath.startsWith("~")) {
    // `~user` 해석은 shell/OS 계정 데이터에 의존하므로 경계 판별에서 지원하지 않는다.
    return targetPath;
  }
  if (path.isAbsolute(targetPath)) {
    return path.resolve(targetPath);
  }
  return path.resolve(workspaceRoot ?? process.cwd(), targetPath);
}

export function isPathWithinAllowedRoots(
  targetPath: string,
  workspaceRoot: string | undefined,
  tempRoots: readonly string[],
): boolean {
  if (!workspaceRoot) return true;
  const inspectedPath = inspectPath(targetPath, workspaceRoot);
  if (!inspectedPath.valid) return false;

  const allowedRoots = [workspaceRoot, ...tempRoots].map(normalizeRoot);
  return allowedRoots.some((root) =>
    isWithinRoot(inspectedPath.canonicalPath, root),
  );
}

export function getWorkspaceRelativePath(
  targetPath: string,
  workspaceRoot: string | undefined,
): string {
  return inspectPath(targetPath, workspaceRoot).workspaceRelativePath;
}

export function isAgentsRootEnumerationPath(
  targetPath: string,
  workspaceRoot: string | undefined,
): boolean {
  const relativePath = getWorkspaceRelativePath(targetPath, workspaceRoot);
  return (
    relativePath === ".agents" ||
    relativePath === ".agents/*" ||
    relativePath === ".agents/**" ||
    relativePath === ".agents/*/*" ||
    relativePath === ".agents/**/*" ||
    relativePath === RUN_DIR_ROOT ||
    relativePath === `${RUN_DIR_ROOT}/*` ||
    relativePath === `${RUN_DIR_ROOT}/**` ||
    relativePath === `${RUN_DIR_ROOT}/*/*` ||
    relativePath === `${RUN_DIR_ROOT}/**/*`
  );
}

export function isOrchestratorTaskIndexPath(
  targetPath: string,
  workspaceRoot: string | undefined,
): boolean {
  return (
    getRunArtifactIdentity(targetPath, workspaceRoot)?.owner === "orchestrator"
  );
}
