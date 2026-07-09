import * as fs from "node:fs";
import { buildProviderConfig, loadCatalog } from "opencode/core";
import { OPENCODE_PLUGIN_ENTRY } from "@cli/constants";
import { isJsonObject, writeFileBackup, writeJsonFile } from "@cli/fs-utils";
import { parseJsoncObject } from "@cli/jsonc";

export function readNativeOpencodeConfig(
  configPath: string,
): Record<string, unknown> {
  if (!fs.existsSync(configPath)) return {};
  return parseJsoncObject(configPath, fs.readFileSync(configPath, "utf-8"));
}

export function writeNativeOpencodeConfig(
  configPath: string,
  config: Record<string, unknown>,
): void {
  writeFileBackup(configPath);
  writeJsonFile(configPath, config);
}

export function ensurePluginEntry(config: Record<string, unknown>): boolean {
  if (config.plugin !== undefined && !Array.isArray(config.plugin)) {
    throw new Error("opencode.json의 plugin 설정은 배열이어야 합니다.");
  }
  const pluginEntries = config.plugin ? [...config.plugin] : [];
  if (pluginEntries.includes(OPENCODE_PLUGIN_ENTRY)) return false;
  pluginEntries.push(OPENCODE_PLUGIN_ENTRY);
  config.plugin = pluginEntries;
  return true;
}

export function removePluginEntry(config: Record<string, unknown>): boolean {
  if (!Array.isArray(config.plugin)) return false;
  const remainingPluginEntries = config.plugin.filter(
    (entry) => entry !== OPENCODE_PLUGIN_ENTRY,
  );
  if (remainingPluginEntries.length === config.plugin.length) return false;
  if (remainingPluginEntries.length === 0) {
    delete config.plugin;
  } else {
    config.plugin = remainingPluginEntries;
  }
  return true;
}

export function ensureProvider(
  config: Record<string, unknown>,
  projectDirectory: string,
  scope: "user" | "project",
): boolean {
  const providerConfig = buildProviderConfig(
    scope === "project" ? loadCatalog(projectDirectory) : loadCatalog(),
  );
  if (config.provider !== undefined && !isJsonObject(config.provider)) {
    throw new Error("opencode.json의 provider 설정은 object여야 합니다.");
  }
  const providerMap = isJsonObject(config.provider) ? config.provider : {};
  if (isJsonObject(providerMap[providerConfig.id])) {
    return false;
  }
  config.provider = {
    ...providerMap,
    [providerConfig.id]: providerConfig,
  };
  return true;
}

export function removeProvider(
  config: Record<string, unknown>,
  projectDirectory: string,
  scope: "user" | "project",
): "removed" | "missing" | "kept-custom" {
  if (!isJsonObject(config.provider)) return "missing";
  const providerConfig = buildProviderConfig(
    scope === "project" ? loadCatalog(projectDirectory) : loadCatalog(),
  );
  const currentProvider = config.provider[providerConfig.id];
  if (!isJsonObject(currentProvider)) return "missing";
  const currentOptions = isJsonObject(currentProvider.options)
    ? currentProvider.options
    : {};
  if (
    currentProvider.id !== providerConfig.id ||
    currentProvider.npm !== providerConfig.npm ||
    currentProvider.api !== providerConfig.api ||
    currentOptions.baseURL !== providerConfig.options.baseURL
  ) {
    return "kept-custom";
  }
  delete config.provider[providerConfig.id];
  if (Object.keys(config.provider).length === 0) {
    delete config.provider;
  }
  return "removed";
}
