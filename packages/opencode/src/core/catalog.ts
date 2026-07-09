import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";

const CatalogModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["active", "deprecated"]).default("active"),
  replacement: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  reasoning_efforts: z.array(z.string()).default([]),
  tool_call: z.boolean().default(true),
  temperature: z.boolean().default(true),
  input_modalities: z
    .array(z.enum(["text", "audio", "image", "video", "pdf"]))
    .default(["text"]),
  output_modalities: z
    .array(z.enum(["text", "audio", "image", "video", "pdf"]))
    .default(["text"]),
});

const CatalogSchema = z.object({
  catalogVersion: z.string().regex(/^\d{4}\.\d{2}\.\d{2}\.\d+$/),
  provider: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    npm: z.string().min(1),
    api: z.string().min(1),
    baseURL: z.string().min(1),
    env: z.array(z.string()).default([]),
  }),
  models: z.array(CatalogModelSchema).min(1),
});

export type Catalog = z.infer<typeof CatalogSchema>;
export type CatalogModel = z.infer<typeof CatalogModelSchema>;

export interface ProviderConfigShape {
  id: string;
  name: string;
  npm: string;
  api: string;
  env: string[];
  options: {
    baseURL: string;
  };
  models: Record<
    string,
    {
      id: string;
      name: string;
      status: "active" | "deprecated";
      reasoning: boolean;
      temperature: boolean;
      tool_call: boolean;
      modalities: {
        input: Array<"text" | "audio" | "image" | "video" | "pdf">;
        output: Array<"text" | "audio" | "image" | "video" | "pdf">;
      };
      options: {
        reasoning_efforts: readonly string[];
        replacement?: string;
        aliases?: readonly string[];
      };
    }
  >;
}

const catalogPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "catalog.toml",
);

const cachedCatalogByPath = new Map<string, Catalog>();
const cachedChecksumByPath = new Map<string, string>();

export type CatalogSourceKind = "managed" | "bundled";

export interface CatalogSource {
  kind: CatalogSourceKind;
  path: string;
}

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

export function getCatalogModelIds(catalog = loadCatalog()): string[] {
  return catalog.models.map((model) => model.id);
}

export function getReasoningEffortsByModel(
  catalog = loadCatalog(),
): Record<string, readonly string[]> {
  return Object.fromEntries(
    catalog.models.map((model) => [model.id, model.reasoning_efforts]),
  );
}

export function getReasoningEfforts(catalog = loadCatalog()): string[] {
  return Array.from(
    new Set(catalog.models.flatMap((model) => model.reasoning_efforts)),
  ).sort();
}

export function getCatalogModel(
  modelId: string,
  catalog = loadCatalog(),
): CatalogModel | undefined {
  return catalog.models.find((model) => model.id === modelId);
}

export function buildProviderConfig(
  catalog = loadCatalog(),
): ProviderConfigShape {
  return {
    id: catalog.provider.id,
    name: catalog.provider.name,
    npm: catalog.provider.npm,
    api: catalog.provider.api,
    env: catalog.provider.env,
    options: {
      baseURL: catalog.provider.baseURL,
    },
    models: Object.fromEntries(
      catalog.models.map((model) => [
        model.id,
        {
          id: model.id,
          name: model.name,
          status: model.status,
          reasoning: model.reasoning_efforts.length > 0,
          temperature: model.temperature,
          tool_call: model.tool_call,
          modalities: {
            input: model.input_modalities,
            output: model.output_modalities,
          },
          options: {
            reasoning_efforts: model.reasoning_efforts,
            ...(model.replacement ? { replacement: model.replacement } : {}),
            ...(model.aliases.length > 0 ? { aliases: model.aliases } : {}),
          },
        },
      ]),
    ),
  };
}
