/**
 * permissions/path.ts — 경로 분류·워크스페이스/temp 경계
 */

import os from "node:os";
import path from "node:path";

/** 경로 분류 결과 */
export type PathCategory = "agents" | "docs" | "source";

/**
 * 대상 경로를 세 가지 카테고리로 분류한다.
 *
 * - "agents"  : `.agents` 세그먼트를 포함하는 경로 (태스크 런 디렉터리)
 * - "docs"    : `docs/`로 시작하는 경로 (briefs 포함)
 * - "source"  : 그 외 모든 경로 (소스 코드, 설정 파일 등)
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

export function getDefaultTempRoots(): string[] {
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

export function resolveTargetPath(
  targetPath: string,
  workspaceRoot?: string,
): string {
  if (targetPath.startsWith("~")) {
    return path.resolve(os.homedir(), targetPath.slice(1));
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

  const resolvedPath = resolveTargetPath(targetPath, workspaceRoot);
  const allowedRoots = [workspaceRoot, ...tempRoots].map(normalizeRoot);
  return allowedRoots.some((root) => isWithinRoot(resolvedPath, root));
}

export function getWorkspaceRelativePath(
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

export function isAgentsRootEnumerationPath(
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

export function isOrchestratorTaskIndexPath(
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
