/**
 * 通用配置片段服务。
 *
 * 片段按应用保存在 settings 表：common_config_<app>。
 * Claude/Gemini 使用 JSON，Codex 使用 TOML；Codex TOML 合并/剥离
 * 在后端完成，避免前端整文档重序列化破坏注释、键序和格式。
 */
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { AppDatabase } from "../db/database.js";

export function getConfigSnippetKey(appType: string): string {
  return `common_config_${appType}`;
}

export function getConfigSnippet(
  db: AppDatabase,
  appType: string,
): string | null {
  return (
    db.get<{ value: string }>(
      "SELECT value FROM settings WHERE key = ?",
      getConfigSnippetKey(appType),
    )?.value ?? null
  );
}

function setSetting(db: AppDatabase, key: string, value: string): void {
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", key, value);
}

function deleteSetting(db: AppDatabase, key: string): void {
  db.run("DELETE FROM settings WHERE key = ?", key);
}

function setClearedFlag(
  db: AppDatabase,
  appType: string,
  cleared: boolean,
): void {
  const key = `common_config_${appType}_cleared`;
  if (cleared) {
    setSetting(db, key, "true");
  } else {
    deleteSetting(db, key);
  }
}

function parseJson(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("通用配置必须是 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

function parseCodexToml(value: string): Record<string, unknown> {
  const parsed: unknown = parseToml(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Codex 通用配置必须是 TOML 表");
  }
  return parsed as Record<string, unknown>;
}

function validateSnippet(appType: string, snippet: string): void {
  const text = snippet.trim();
  if (!text) return;

  if (appType === "claude" || appType === "gemini") {
    parseJson(text);
    return;
  }
  if (appType === "codex") {
    parseCodexToml(text);
  }
}

export function saveCommonConfigSnippet(
  db: AppDatabase,
  appType: string,
  snippet: string,
): void {
  validateSnippet(appType, snippet);
  const key = getConfigSnippetKey(appType);
  if (snippet.trim() === "") {
    deleteSetting(db, key);
    setClearedFlag(db, appType, true);
    return;
  }
  setSetting(db, key, snippet);
  setClearedFlag(db, appType, false);
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function jsonIsSubset(target: unknown, source: unknown): boolean {
  const sourceObject = asObject(source);
  if (sourceObject) {
    const targetObject = asObject(target);
    if (!targetObject) return false;
    return Object.entries(sourceObject).every(([key, sourceValue]) =>
      Object.hasOwn(targetObject, key)
        ? jsonIsSubset(targetObject[key], sourceValue)
        : false,
    );
  }

  if (Array.isArray(source)) {
    if (!Array.isArray(target)) return false;
    const matched = new Set<number>();
    return source.every((sourceItem) =>
      target.some((targetItem, index) => {
        if (matched.has(index)) return false;
        if (jsonIsSubset(targetItem, sourceItem)) {
          matched.add(index);
          return true;
        }
        return false;
      }),
    );
  }

  return target === source;
}

function jsonDeepMerge(target: unknown, source: unknown): unknown {
  const targetObject = asObject(target);
  const sourceObject = asObject(source);
  if (targetObject && sourceObject) {
    for (const [key, sourceValue] of Object.entries(sourceObject)) {
      targetObject[key] = Object.hasOwn(targetObject, key)
        ? jsonDeepMerge(targetObject[key], sourceValue)
        : sourceValue;
    }
    return targetObject;
  }
  return source;
}

function jsonDeepRemove(target: unknown, source: unknown): unknown {
  const targetObject = asObject(target);
  const sourceObject = asObject(source);
  if (!targetObject || !sourceObject) return target;

  for (const [key, sourceValue] of Object.entries(sourceObject)) {
    if (!Object.hasOwn(targetObject, key)) continue;
    const targetValue = targetObject[key];
    let removeKey = false;

    if (asObject(sourceValue) && asObject(targetValue)) {
      const cleaned = jsonDeepRemove(targetValue, sourceValue);
      const cleanedObject = asObject(cleaned);
      if (cleanedObject && Object.keys(cleanedObject).length === 0) {
        removeKey = true;
      } else {
        targetObject[key] = cleaned;
      }
    } else if (Array.isArray(sourceValue) && Array.isArray(targetValue)) {
      let targetItems = targetValue;
      for (const sourceItem of sourceValue) {
        const index = targetItems.findIndex((targetItem) =>
          jsonIsSubset(targetItem, sourceItem),
        );
        if (index >= 0) {
          targetItems = targetItems.filter((_, itemIndex) => itemIndex !== index);
        }
      }
      targetObject[key] = targetItems;
      removeKey = targetItems.length === 0;
    } else if (jsonIsSubset(targetValue, sourceValue)) {
      removeKey = true;
    }

    if (removeKey) delete targetObject[key];
  }
  return targetObject;
}

function asTomlObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 当前 TOML 配置是否包含片段中的全部键值（数组按子集匹配）。 */
export function tomlItemIsSubset(target: unknown, source: unknown): boolean {
  const sourceObject = asTomlObject(source);
  if (sourceObject) {
    const targetObject = asTomlObject(target);
    if (!targetObject) return false;
    return Object.entries(sourceObject).every(([key, sourceValue]) =>
      Object.hasOwn(targetObject, key)
        ? tomlItemIsSubset(targetObject[key], sourceValue)
        : false,
    );
  }

  if (Array.isArray(source)) {
    if (!Array.isArray(target)) return false;
    const matched = new Set<number>();
    return source.every((sourceItem) =>
      target.some((targetItem, index) => {
        if (matched.has(index)) return false;
        if (tomlItemIsSubset(targetItem, sourceItem)) {
          matched.add(index);
          return true;
        }
        return false;
      }),
    );
  }

  return target === source;
}

function mergeTomlObject(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = target[key];
    if (asTomlObject(sourceValue) && asTomlObject(targetValue)) {
      mergeTomlObject(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>,
      );
    } else {
      target[key] = sourceValue;
    }
  }
}

function removeTomlObject(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [key, sourceValue] of Object.entries(source)) {
    if (!Object.hasOwn(target, key)) continue;
    const targetValue = target[key];
    let removeKey = false;

    const sourceObject = asTomlObject(sourceValue);
    const targetObject = asTomlObject(targetValue);
    if (sourceObject && targetObject) {
      removeTomlObject(targetObject, sourceObject);
      removeKey = Object.keys(targetObject).length === 0;
    } else if (Array.isArray(sourceValue) && Array.isArray(targetValue)) {
      const targetItems = targetValue;
      for (const sourceItem of sourceValue) {
        const index = targetItems.findIndex((targetItem) =>
          tomlItemIsSubset(targetItem, sourceItem),
        );
        if (index >= 0) targetItems.splice(index, 1);
      }
      removeKey = targetItems.length === 0;
    } else if (tomlItemIsSubset(targetValue, sourceValue)) {
      removeKey = true;
    }

    if (removeKey) delete target[key];
  }
}

export function updateTomlCommonConfigSnippet(
  configToml: string,
  snippetToml: string,
  enabled: boolean,
): string {
  if (!snippetToml.trim()) return configToml;

  const target = configToml.trim() ? parseCodexToml(configToml) : {};
  const source = parseCodexToml(snippetToml);
  if (enabled) mergeTomlObject(target, source);
  else removeTomlObject(target, source);
  return stringifyToml(target);
}

function stringifyJson(value: Record<string, unknown>): string {
  return Object.keys(value).length === 0
    ? "{}"
    : JSON.stringify(value, null, 2);
}

/** 按桌面版的安全规则剥离 API key/token/secret/password 等敏感键。 */
export function isSensitiveConfigKey(name: string): boolean {
  const upper = name.toUpperCase();
  const suffixes = [
    "_KEY", "_API_KEY", "_ACCESS_KEY", "_ACCESS_KEY_ID", "_KEY_ID",
    "_PRIVATE_KEY", "_APIKEY", "_ACCESSKEY", "_SECRETKEY", "_APITOKEN",
    "_AUTH_TOKEN", "_TOKEN", "_PAT", "_PWD", "_PASS", "_PASSPHRASE", "_CREDS",
  ];
  const exact = ["APIKEY", "API_KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIALS"];
  const contains = [
    "SECRET", "PASSWORD", "PASSWD", "CREDENTIAL", "PRIVATE_KEY", "BEARER_TOKEN",
  ];
  return (
    exact.includes(upper) ||
    suffixes.some((suffix) => upper.endsWith(suffix)) ||
    contains.some((part) => upper.includes(part))
  );
}

/** 从 Claude JSON 配置中提取可复用片段并剥离供应商专属/敏感字段。 */
export function extractClaudeCommonConfig(
  settings: Record<string, unknown>,
): string {
  const config = structuredClone(settings);
  const excludedEnv = new Set([
    "ANTHROPIC_MODEL",
    "ANTHROPIC_REASONING_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL_NAME",
    "CLAUDE_CODE_SUBAGENT_MODEL",
    "CLAUDE_CODE_MAX_CONTEXT_TOKENS",
    "CLAUDE_CODE_AUTO_COMPACT_WINDOW",
    "ANTHROPIC_BASE_URL",
  ]);
  const excludedTopLevel = new Set([
    "apiBaseUrl",
    "primaryModel",
    "smallFastModel",
  ]);

  const env = asObject(config.env);
  if (env) {
    for (const key of Object.keys(env)) {
      if (excludedEnv.has(key) || isSensitiveConfigKey(key)) delete env[key];
    }
    if (Object.keys(env).length === 0) delete config.env;
  }
  for (const key of Object.keys(config)) {
    if (excludedTopLevel.has(key) || isSensitiveConfigKey(key)) {
      delete config[key];
    }
  }
  return stringifyJson(config);
}

/** 从 Codex TOML 配置中提取可复用片段并剥离供应商专属字段。 */
export function extractCodexCommonConfig(
  settings: Record<string, unknown>,
): string {
  const configToml = settings.config;
  if (typeof configToml !== "string" || !configToml.trim()) return "";

  const parsed = parseCodexToml(configToml);
  const excluded = [
    "model",
    "model_provider",
    "base_url",
    "wire_api",
    "model_providers",
    "mcp_servers",
    "experimental_bearer_token",
  ];
  for (const key of excluded) delete parsed[key];

  const mcp = asTomlObject(parsed.mcp);
  if (mcp) {
    delete mcp.servers;
    if (Object.keys(mcp).length === 0) delete parsed.mcp;
  }
  return stringifyToml(parsed).trim();
}

/** 从 Gemini env 配置中提取可复用片段并剥离端点/敏感字段。 */
export function extractGeminiCommonConfig(
  settings: Record<string, unknown>,
): string {
  const env = asObject(settings.env) ?? {};
  const snippet: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key === "GOOGLE_GEMINI_BASE_URL" || isSensitiveConfigKey(key)) continue;
    if (typeof value === "string" && value.trim()) {
      snippet[key] = value.trim();
    }
  }
  return stringifyJson(snippet);
}

export function extractCommonConfig(
  appType: string,
  settings?: Record<string, unknown>,
): string {
  switch (appType) {
    case "claude":
      return extractClaudeCommonConfig(settings ?? {});
    case "codex":
      return extractCodexCommonConfig(settings ?? {});
    case "gemini":
      return extractGeminiCommonConfig(settings ?? {});
    default:
      return "";
  }
}
