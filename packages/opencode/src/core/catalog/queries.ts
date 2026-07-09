/**
 * catalog/queries.ts — catalog 조회·프로바이더 변환
 */

import { loadCatalog } from "./load";
import type { CatalogModel, ProviderConfigShape } from "./schema";

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
