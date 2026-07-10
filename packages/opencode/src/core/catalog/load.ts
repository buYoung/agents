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

interface CachedCatalogGeneration {
  checksum: string;
  content: string;
  catalog?: Catalog;
}

export interface CatalogSnapshot {
  source: CatalogSource;
  checksum: string;
  catalog: Catalog;
}

const cachedGenerationByPath = new Map<string, CachedCatalogGeneration>();

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
  const providerPrefix = `${parsed.provider.id}/`;
  for (const model of parsed.models) {
    if (!model.id.startsWith(providerPrefix) || model.id === providerPrefix) {
      throw new Error(
        `catalog model id must use provider-qualified form ${providerPrefix}<model>: ${model.id}`,
      );
    }
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
  cachedGenerationByPath.delete(catalogFilePath);
}

function readCatalogGeneration(source: CatalogSource): CachedCatalogGeneration {
  const content = fs.readFileSync(source.path, "utf-8");
  const checksum = sha256(content);
  const cachedGeneration = cachedGenerationByPath.get(source.path);
  if (
    cachedGeneration &&
    cachedGeneration.checksum === checksum &&
    cachedGeneration.content === content
  ) {
    return cachedGeneration;
  }

  const generation = { checksum, content };
  cachedGenerationByPath.set(source.path, generation);
  return generation;
}

export function loadCatalogSnapshot(
  projectDirectory?: string,
): CatalogSnapshot {
  const source = getCatalogSource(projectDirectory);
  const generation = readCatalogGeneration(source);
  generation.catalog ??= parseCatalog(generation.content);
  return {
    source,
    checksum: generation.checksum,
    catalog: generation.catalog,
  };
}

export function loadCatalog(projectDirectory?: string): Catalog {
  return loadCatalogSnapshot(projectDirectory).catalog;
}

/**
 * 런타임 catalog 로드.
 * managed 프로젝트 catalog 로드 실패 시에만 bundled catalog로 fallback한다.
 */
export function loadRuntimeCatalog(projectDirectory: string): Catalog {
  return loadRuntimeCatalogSnapshot(projectDirectory).catalog;
}

export function loadRuntimeCatalogSnapshot(
  projectDirectory: string,
): CatalogSnapshot {
  const source = getCatalogSource(projectDirectory);
  try {
    return loadCatalogSnapshot(projectDirectory);
  } catch (error) {
    if (source.kind !== "managed") {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[agents] managed catalog load failed. bundled catalog로 fallback합니다. doctor로 진단하세요: ${source.path}: ${message}`,
    );
    return loadCatalogSnapshot();
  }
}

export function getCatalogChecksum(projectDirectory?: string): string {
  const source = getCatalogSource(projectDirectory);
  return readCatalogGeneration(source).checksum;
}

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
