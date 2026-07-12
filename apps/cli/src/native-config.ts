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

/**
 * JSONC의 주석과 다른 설정을 유지하면서 agents가 소유한 최상위 항목만 바꾼다.
 * 배열/객체 내부 주석을 임의로 재서식하지 않기 위해, 기존 값이 없을 때만 삽입한다.
 */
export function addNativeConfigEntries(
  configPath: string,
  pluginEntry: string,
  providerId: string,
  providerConfig: object,
): { pluginAdded: boolean; providerAdded: boolean } {
  if (!fs.existsSync(configPath)) {
    const config: Record<string, unknown> = {
      plugin: [pluginEntry],
      provider: { [providerId]: providerConfig },
    };
    writeNativeOpencodeConfig(configPath, config);
    return { pluginAdded: true, providerAdded: true };
  }
  const original = fs.readFileSync(configPath, "utf-8");
  const config = parseJsoncObject(configPath, original);
  let output = original;
  let pluginAdded = false;
  let providerAdded = false;
  if (!Array.isArray(config.plugin)) {
    output = insertRootProperty(output, "plugin", [pluginEntry]);
    pluginAdded = true;
  } else if (!config.plugin.includes(pluginEntry)) {
    output = appendArrayValue(output, "plugin", JSON.stringify(pluginEntry));
    pluginAdded = true;
  }
  const providerMap = isJsonObject(config.provider) ? config.provider : null;
  if (!providerMap) {
    output = insertRootProperty(output, "provider", { [providerId]: providerConfig });
    providerAdded = true;
  } else if (!isJsonObject(providerMap[providerId])) {
    output = insertObjectProperty(
      output,
      "provider",
      providerId,
      providerConfig,
    );
    providerAdded = true;
  }
  if (output !== original) {
    writeFileBackup(configPath);
    fs.writeFileSync(configPath, output, "utf-8");
  }
  return { pluginAdded, providerAdded };
}

/**
 * CLI가 추가했다고 상태에 기록한 등록만 최소 편집으로 제거한다. 기존 사용자 등록은
 * 건드리지 않으며, 편집한 결과는 다시 JSONC로 파싱해 손상된 설정을 쓰지 않는다.
 */
export function removeNativeConfigEntries(
  configPath: string,
  pluginEntry: string,
  providerId: string,
  removePlugin: boolean,
  removeProviderEntry: boolean,
): { pluginRemoved: boolean; providerRemoved: boolean } {
  if (!fs.existsSync(configPath)) return { pluginRemoved: false, providerRemoved: false };
  const original = fs.readFileSync(configPath, "utf-8");
  const config = parseJsoncObject(configPath, original);
  let output = original;
  let pluginRemoved = false;
  let providerRemoved = false;
  if (removePlugin && Array.isArray(config.plugin) && config.plugin.includes(pluginEntry)) {
    output = config.plugin.length === 1
      ? removeRootProperty(output, "plugin")
      : removeArrayStringValue(output, "plugin", pluginEntry);
    pluginRemoved = output !== original;
  }
  if (removeProviderEntry && isJsonObject(config.provider) && isJsonObject(config.provider[providerId])) {
    const before = output;
    output = removeObjectProperty(output, "provider", providerId);
    providerRemoved = output !== before;
  }
  if (output !== original) {
    parseJsoncObject(configPath, output);
    writeFileBackup(configPath);
    fs.writeFileSync(configPath, output, "utf-8");
  }
  return { pluginRemoved, providerRemoved };
}

function findValueEnd(content: string, start: number, open: string, close: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === open) depth += 1;
    if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("opencode.json에서 설정 항목의 끝을 찾을 수 없습니다.");
}

function findPropertyValueStart(content: string, propertyName: string): number | null {
  const pattern = new RegExp(`"${propertyName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}"\\s*:`);
  const match = pattern.exec(content);
  if (!match) return null;
  let index = (match.index ?? 0) + match[0].length;
  while (/\s/.test(content[index] ?? "")) index += 1;
  return index;
}

function insertRootProperty(content: string, propertyName: string, value: unknown): string {
  const rootEnd = content.lastIndexOf("}");
  if (rootEnd < 0) throw new Error("opencode.json root object를 찾을 수 없습니다.");
  const before = content.slice(0, rootEnd);
  const hasExistingProperty = before.replace(/[\s,]/g, "").length > 1;
  const indentation = /\n(\s*)[^\s]/.exec(before)?.[1] ?? "  ";
  const prefix = hasExistingProperty && !/,\s*$/.test(before) ? "," : "";
  return `${before}${prefix}\n${indentation}"${propertyName}": ${JSON.stringify(value, null, 2).replaceAll("\n", `\n${indentation}`)}\n${content.slice(rootEnd)}`;
}

function appendArrayValue(content: string, propertyName: string, value: string): string {
  const start = findPropertyValueStart(content, propertyName);
  if (start === null || content[start] !== "[") {
    throw new Error(`opencode.json의 ${propertyName} 설정은 배열이어야 합니다.`);
  }
  const end = findValueEnd(content, start, "[", "]");
  const current = content.slice(start + 1, end).trim();
  return `${content.slice(0, end)}${current && !/,\s*$/.test(current) ? ", " : ""}${value}${content.slice(end)}`;
}

function insertObjectProperty(
  content: string,
  objectName: string,
  propertyName: string,
  value: unknown,
): string {
  const start = findPropertyValueStart(content, objectName);
  if (start === null || content[start] !== "{") {
    throw new Error(`opencode.json의 ${objectName} 설정은 object여야 합니다.`);
  }
  const end = findValueEnd(content, start, "{", "}");
  const current = content.slice(start + 1, end).trim();
  return `${content.slice(0, end)}${current && !/,\s*$/.test(current) ? ", " : ""}${JSON.stringify(propertyName)}: ${JSON.stringify(value)}${content.slice(end)}`;
}

function removeArrayStringValue(content: string, propertyName: string, value: string): string {
  const start = findPropertyValueStart(content, propertyName);
  if (start === null || content[start] !== "[") throw new Error(`opencode.json의 ${propertyName} 설정은 배열이어야 합니다.`);
  const end = findValueEnd(content, start, "[", "]");
  const escaped = JSON.stringify(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = content.slice(start + 1, end);
  const withFollowingComma = new RegExp(`(^|,)\\s*${escaped}\\s*,`, "m");
  const withPreviousComma = new RegExp(`,\\s*${escaped}(?=\\s*(?:,|$))`, "m");
  let replaced = body.replace(withFollowingComma, "$1");
  if (replaced === body) replaced = body.replace(withPreviousComma, "");
  if (replaced === body) return content;
  return `${content.slice(0, start + 1)}${replaced}${content.slice(end)}`;
}

function removeObjectProperty(content: string, objectName: string, propertyName: string): string {
  const start = findPropertyValueStart(content, objectName);
  if (start === null || content[start] !== "{") throw new Error(`opencode.json의 ${objectName} 설정은 object여야 합니다.`);
  const end = findValueEnd(content, start, "{", "}");
  const body = content.slice(start + 1, end);
  const key = JSON.stringify(propertyName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyMatch = new RegExp(key + "\\s*:").exec(body);
  if (!keyMatch || keyMatch.index === undefined) return content;
  const valueStart = keyMatch.index + keyMatch[0].length + body.slice(keyMatch.index + keyMatch[0].length).search(/\S/);
  const opening = body[valueStart];
  const valueEnd = opening === "{" || opening === "["
    ? findValueEnd(body, valueStart, opening, opening === "{" ? "}" : "]") + 1
    : body.slice(valueStart).search(/[,}]/) + valueStart;
  let removalStart = keyMatch.index;
  while (removalStart > 0 && /\s/.test(body[removalStart - 1])) removalStart -= 1;
  let removalEnd = valueEnd;
  while (removalEnd < body.length && /\s/.test(body[removalEnd])) removalEnd += 1;
  if (body[removalEnd] === ",") removalEnd += 1;
  else if (removalStart > 0 && body[removalStart - 1] === ",") removalStart -= 1;
  return `${content.slice(0, start + 1)}${body.slice(0, removalStart)}${body.slice(removalEnd)}${content.slice(end)}`;
}

function removeRootProperty(content: string, propertyName: string): string {
  const keyStart = findRootPropertyKeyStart(content, propertyName);
  if (keyStart === null) return content;
  const colonIndex = content.indexOf(":", keyStart + JSON.stringify(propertyName).length);
  const valueStart = colonIndex + 1 + content.slice(colonIndex + 1).search(/\S/);
  const opening = content[valueStart];
  const valueEnd = opening === "{" || opening === "["
    ? findValueEnd(content, valueStart, opening, opening === "{" ? "}" : "]") + 1
    : content.slice(valueStart).search(/[,}]/) + valueStart;
  let removalStart = keyStart;
  while (removalStart > 0 && /\s/.test(content[removalStart - 1])) removalStart -= 1;
  let removalEnd = valueEnd;
  while (removalEnd < content.length && /\s/.test(content[removalEnd])) removalEnd += 1;
  if (content[removalEnd] === ",") removalEnd += 1;
  else if (removalStart > 0 && content[removalStart - 1] === ",") removalStart -= 1;
  return `${content.slice(0, removalStart)}${content.slice(removalEnd)}`;
}

function findRootPropertyKeyStart(content: string, propertyName: string): number | null {
  let depth = 0;
  let inLineComment = false;
  let inBlockComment = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];
    if (inLineComment) {
      if (character === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (character === "*" && nextCharacter === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (character === "{") {
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      continue;
    }
    if (character !== '"' || depth !== 1) continue;
    let stringEnd = index + 1;
    let escaped = false;
    while (stringEnd < content.length) {
      const stringCharacter = content[stringEnd];
      if (!escaped && stringCharacter === '"') break;
      escaped = !escaped && stringCharacter === "\\";
      if (stringCharacter !== "\\") escaped = false;
      stringEnd += 1;
    }
    if (
      content.slice(index, stringEnd + 1) === JSON.stringify(propertyName) &&
      content.slice(stringEnd + 1).match(/^\s*:/)
    ) {
      return index;
    }
    index = stringEnd;
  }
  return null;
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
