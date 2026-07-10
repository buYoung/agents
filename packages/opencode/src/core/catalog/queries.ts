/**
 * catalog/queries.ts — catalog 조회·프로바이더 변환
 */

import { loadCatalog } from "./load";
import type { AgentDefinition } from "@opencode/core/types";
import type {
  Catalog,
  CatalogModel,
  ProviderConfigShape,
} from "./schema";

function getProviderLocalModelId(
  modelId: string,
  catalog: Catalog,
): string {
  const providerPrefix = `${catalog.provider.id}/`;
  if (!modelId.startsWith(providerPrefix) || modelId === providerPrefix) {
    throw new Error(
      `catalog model id must belong to provider ${catalog.provider.id}: ${modelId}`,
    );
  }
  return modelId.slice(providerPrefix.length);
}

export function assertAgentModelsInCatalog(
  agentRecord: Record<string, AgentDefinition>,
  catalog: Catalog,
): void {
  const catalogModelIds = new Set(getCatalogModelIds(catalog));
  const missingModels = Object.entries(agentRecord)
    .filter(([, agent]) => agent.model && !catalogModelIds.has(agent.model))
    .map(([name, agent]) => `${name}=${agent.model}`);
  if (missingModels.length > 0) {
    throw new Error(
      `agent default model is missing from effective catalog: ${missingModels.join(", ")}`,
    );
  }
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
      catalog.models.map((model) => {
        const localModelId = getProviderLocalModelId(model.id, catalog);
        return [
          localModelId,
          {
            id: localModelId,
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
              ...(model.replacement
                ? {
                    replacement: getProviderLocalModelId(
                      model.replacement,
                      catalog,
                    ),
                  }
                : {}),
              ...(model.aliases.length > 0
                ? {
                    aliases: model.aliases.map((alias) =>
                      getProviderLocalModelId(alias, catalog),
                    ),
                  }
                : {}),
            },
          },
        ];
      }),
    ),
  };
}
