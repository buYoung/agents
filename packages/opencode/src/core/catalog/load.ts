/**
 * catalog/load.ts — catalog 경로·파싱·캐시·로드
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parse as parseToml } from "smol-toml";
import {
  CatalogSchema,
  type Catalog,
  type CatalogSource,
} from "./schema";

const catalogPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "catalog.toml",
);

const cachedCatalogByPath = new Map<string, Catalog>();
const cachedChecksumByPath = new Map<string, string>();

export function getBundledCatalogPath(): string {
  return catalogPath;
}

export function getManagedCatalogPath(projectDirectory: string): string {
  return path.join(projectDirectory, ".opencode", "agents", "catalog.toml");
}

export function getCatalogSource(projectDirectory?: string): CatalogSource {
  if (projectDirectory) {
    const managedCatalogPath = getManagedCatalogPath(projectDirectory);
    if (fs.existsSync(managedCatalogPath)) {
      return { kind: "managed", path: managedCatalogPath };
    }
  }
  return { kind: "bundled", path: catalogPath };
}

export function parseCatalog(content: string): Catalog {
  const parsed = CatalogSchema.parse(parseToml(content));
  const modelIds = new Set<string>();
  for (const model of parsed.models) {
    if (modelIds.has(model.id)) {
      throw new Error(`catalog model id duplicated: ${model.id}`);
    }
    modelIds.add(model.id);
  }
  for (const model of parsed.models) {
    if (model.replacement && !modelIds.has(model.replacement)) {
      throw new Error(
        `catalog replacement not found for ${model.id}: ${model.replacement}`,
      );
    }
  }
  return parsed;
}

export function invalidateCatalogCache(catalogFilePath: string): void {
  cachedCatalogByPath.delete(catalogFilePath);
  cachedChecksumByPath.delete(catalogFilePath);
}

export function loadCatalog(projectDirectory?: string): Catalog {
  const source = getCatalogSource(projectDirectory);
  const cachedCatalog = cachedCatalogByPath.get(source.path);
  if (cachedCatalog) {
    return cachedCatalog;
  }

  const catalog = parseCatalog(fs.readFileSync(source.path, "utf-8"));
  cachedCatalogByPath.set(source.path, catalog);
  return catalog;
}

/**
 * 런타임 catalog 로드.
 * managed 프로젝트 catalog 로드 실패 시에만 bundled catalog로 fallback한다.
 */
export function loadRuntimeCatalog(projectDirectory: string): Catalog {
  const source = getCatalogSource(projectDirectory);
  try {
    return loadCatalog(projectDirectory);
  } catch (error) {
    if (source.kind !== "managed") {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[agents] managed catalog load failed. bundled catalog로 fallback합니다. doctor로 진단하세요: ${source.path}: ${message}`,
    );
    return loadCatalog();
  }
}

export function getCatalogChecksum(projectDirectory?: string): string {
  const source = getCatalogSource(projectDirectory);
  const cachedChecksum = cachedChecksumByPath.get(source.path);
  if (cachedChecksum) {
    return cachedChecksum;
  }

  const checksum = sha256(fs.readFileSync(source.path, "utf-8"));
  cachedChecksumByPath.set(source.path, checksum);
  return checksum;
}

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
