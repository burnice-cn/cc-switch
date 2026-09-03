/**
 * Live CLI configuration projection.
 *
 * The Node backend was originally a database-only rewrite. That made provider
 * switching update the UI but not the real CLI files. This service restores
 * the core live-write semantics for exclusive-mode applications:
 * Claude, Codex, Gemini and Grok Build.
 */
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import type { AppDatabase } from "../db/database.js";
import type { Provider } from "../db/dao/providers-dao.js";
import { McpDao } from "../db/dao/mcp-dao.js";
import { getSettings, saveSettings, type AppSettings } from "./settings-service.js";
import {
  getConfigSnippet,
  jsonIsSubset,
  asObject,
  jsonDeepMerge,
  parseCodexToml,
} from "./common-config-service.js";
import {
  atomicWriteJson,
  atomicWriteText,
  deleteFile,
  fileExists,
  readJsonObject,
} from "../utils/atomic-file.js";

const CODEX_MODEL_CATALOG_FILENAME = "cc-switch-model-catalog.json";
const CODEX_RESERVED_MODEL_PROVIDER_IDS = new Set([
  "amazon-bedrock",
  "amazon-bedrock-runtime",
  "openai",
  "ollama",
  "lmstudio",
]);
const CURRENT_PROVIDER_KEYS: Record<string, string> = {
  claude: "currentProviderClaude",
  "claude-desktop": "currentProviderClaudeDesktop",
  codex: "currentProviderCodex",
  gemini: "currentProviderGemini",
  grokbuild: "currentProviderGrokbuild",
  opencode: "currentProviderOpencode",
  openclaw: "currentProviderOpenclaw",
  hermes: "currentProviderHermes",
};

export class ProviderLiveService {
  onMcpServersChanged?: () => void;

  constructor(private db: AppDatabase, private mcpDao = new McpDao(db)) {}

  /** Resolve a directory override, expanding `~`/`~/...` like the desktop app. */
  configDir(appType: string): string {
    const settings = getSettings();
    const fields: Record<string, unknown> = {
      claude: settings.claudeConfigDir,
      "claude-desktop": settings.claudeConfigDir,
      codex: settings.codexConfigDir,
      gemini: settings.geminiConfigDir,
      grokbuild: settings.grokConfigDir,
      opencode: settings.opencodeConfigDir,
      openclaw: settings.openclawConfigDir,
      hermes: settings.hermesConfigDir,
      pi: settings.piConfigDir,
    };
    const rawField = fields[appType];
    const field = typeof rawField === "string" ? rawField : undefined;
    if (field && field.trim()) return resolveOverridePath(field.trim());
    const home = homedir();
    if (appType === "claude" || appType === "claude-desktop") return join(home, ".claude");
    if (appType === "codex") return join(home, ".codex");
    if (appType === "gemini") return join(home, ".gemini");
    if (appType === "grokbuild") return join(home, ".grok");
    if (appType === "opencode") return join(home, ".config", "opencode");
    if (appType === "openclaw") return join(home, ".openclaw");
    if (appType === "hermes") return join(home, ".hermes");
    if (appType === "pi") return join(home, ".pi", "agent");
    return home;
  }

  write(appType: string, provider: Provider): void {
    switch (appType) {
      case "claude":
        return this.writeClaude(provider);
      case "codex":
        return this.writeCodex(provider);
      case "gemini":
        return this.writeGemini(provider);
      case "grokbuild":
        return this.writeGrok(provider);
      default:
        throw new Error(`应用 ${appType} 暂不支持 live 配置切换`);
    }
  }

  /** Persist the device-local current-provider pointer after a successful live write. */
  setCurrentProvider(appType: string, providerId: string): void {
    const key = CURRENT_PROVIDER_KEYS[appType];
    if (!key) return;
    const settings = getSettings();
    const next = { ...settings, [key]: providerId } as AppSettings;
    if (!saveSettings(next)) {
      throw new Error("更新本地当前供应商设置失败");
    }
  }

  applyCommonConfig(appType: string, provider: Provider): Provider {
    const snippet = getConfigSnippet(this.db, appType);
    if (!snippet?.trim()) return provider;

    const meta = asObject(provider.meta);
    const explicit = meta?.commonConfigEnabled;
    if (explicit === false) return provider;
    if (explicit !== true && !this.providerContainsCommonConfig(appType, provider, snippet)) {
      return provider;
    }

    const settings = structuredClone(provider.settingsConfig ?? {});
    if (appType === "claude" || appType === "gemini") {
      const source: unknown = JSON.parse(snippet);
      const sourceObject = asObject(source);
      if (!sourceObject) throw new Error("通用配置必须是 JSON 对象");
      const target = appType === "gemini" ? asObject(settings.env) ?? {} : settings;
      jsonDeepMerge(target, sourceObject);
      if (appType === "gemini") settings.env = target;
      return { ...provider, settingsConfig: settings };
    }

    if (appType === "codex") {
      const currentConfig = typeof settings.config === "string" ? settings.config : "";
      const target = currentConfig.trim() ? parseCodexToml(currentConfig) : {};
      const source = parseCodexToml(snippet);
      deepMergeToml(target, source);
      settings.config = stringifyToml(target);
      return { ...provider, settingsConfig: settings };
    }

    return provider;
  }

  private providerContainsCommonConfig(appType: string, provider: Provider, snippet: string): boolean {
    const settings = provider.settingsConfig ?? {};
    if (appType === "claude") {
      const source: unknown = JSON.parse(snippet);
      return jsonIsSubset(settings, source);
    }
    if (appType === "gemini") {
      const source: unknown = JSON.parse(snippet);
      const env = asObject(settings.env);
      return Boolean(env && jsonIsSubset(env, source));
    }
    if (appType === "codex") {
      const config = typeof settings.config === "string" ? settings.config : "";
      if (!config.trim()) return false;
      try {
        const target = parseCodexToml(config);
        const source = parseCodexToml(snippet);
        return tomlIsSubset(target, source);
      } catch {
        return false;
      }
    }
    return false;
  }

  private claudeSettingsPath(): string {
    const dir = this.configDir("claude");
    const standard = join(dir, "settings.json");
    if (fileExists(standard)) return standard;
    const legacy = join(dir, "claude.json");
    return fileExists(legacy) ? legacy : standard;
  }

  private writeClaude(provider: Provider): void {
    const settings = structuredClone(provider.settingsConfig ?? {});
    if (settings && typeof settings === "object" && !Array.isArray(settings)) {
      delete settings.api_format;
      delete settings.apiFormat;
      delete settings.openrouter_compat_mode;
      delete settings.openrouterCompatMode;
    }
    atomicWriteJson(this.claudeSettingsPath(), settings);
  }

  private codexPaths() {
    const dir = this.configDir("codex");
    return {
      dir,
      config: join(dir, "config.toml"),
      auth: join(dir, "auth.json"),
      catalog: join(dir, CODEX_MODEL_CATALOG_FILENAME),
    };
  }

  private writeCodex(provider: Provider): void {
    const settings = asObject(provider.settingsConfig);
    if (!settings) throw new Error("Codex 供应商配置必须是 JSON 对象");
    const auth = asObject(settings.auth) ?? {};
    const rawConfig = typeof settings.config === "string" ? settings.config : "";
    const preserveLogin = getSettings().preserveCodexOfficialAuthOnSwitch === true;
    const official = isOfficialProvider(provider);
    const token = extractCodexToken(auth, rawConfig);

    // Validate the stored TOML before mutating or replacing the live file.
    const parsed = rawConfig.trim() ? parseCodexToml(rawConfig) : {};
    if (official) {
      this.projectMcpServers("codex", parsed);
      const paths = this.codexPaths();
      if (codexAuthHasLoginMaterial(auth)) atomicWriteJson(paths.auth, auth, 0o600);
      this.writeCodexConfigAndCatalog(paths, parsed, settings);
      return;
    }

    if (token) injectCodexBearerToken(parsed, token);
    this.projectMcpServers("codex", parsed);
    if (!preserveLogin) {
      const providerId = activeCodexModelProviderId(parsed);
      if (providerId && isCustomCodexProviderId(providerId)) {
        setNestedValue(
          parsed,
          ["model_providers", providerId, "requires_openai_auth"],
          preserveLogin,
        );
      }
    }

    const paths = this.codexPaths();
    this.writeCodexConfigAndCatalog(paths, parsed, settings);

    // Third-party switches are config-only in Codex 0.149+. auth.json is the
    // official ChatGPT login cache and is removed unless explicitly preserved.
    if (!preserveLogin && fileExists(paths.auth) && !deleteFile(paths.auth)) {
      throw new Error("删除 Codex auth.json 失败");
    }
  }

  private writeCodexConfigAndCatalog(
    paths: { config: string; catalog: string },
    parsed: Record<string, unknown>,
    settings: Record<string, unknown>,
  ): void {
    const modelCatalog = buildCodexModelCatalog(settings);
    if (modelCatalog) {
      atomicWriteJson(paths.catalog, modelCatalog);
      const existing = parsed.model_catalog_json;
      if (codexCatalogPointerIsOwned(existing, true)) {
        parsed.model_catalog_json = CODEX_MODEL_CATALOG_FILENAME;
      }
      atomicWriteText(paths.config, stringifyToml(parsed));
      return;
    }

    if (codexCatalogPointerIsOwned(parsed.model_catalog_json, false)) {
      delete parsed.model_catalog_json;
    }
    atomicWriteText(paths.config, stringifyToml(parsed));
  }

  /**
   * MCP SSOT projection. Codex and Grok replace their entire config file on a
   * provider switch, so enabled DB servers must be re-projected or they vanish.
   */
  private projectMcpServers(appType: string, parsed: Record<string, unknown>): void {
    if (appType === "codex") {
      this.registerSnapshotMcpServers(parsed);
    }
    parsed.mcp_servers = this.getEnabledMcpServers(appType);
  }

  private getEnabledMcpServers(appType: string): Record<string, unknown> {
    if (appType === "codex") return this.mcpDao.getEnabledConfigs("codex");
    if (appType === "grokbuild") return this.mcpDao.getEnabledConfigs("grokbuild");
    return {};
  }

  /** Adopt provider TOML MCP entries so unified MCP management stays authoritative. */
  private registerSnapshotMcpServers(
    parsed: Record<string, unknown>,
  ): void {
    const snapshotServers = parsed.mcp_servers;
    if (
      !snapshotServers ||
      typeof snapshotServers !== "object" ||
      Array.isArray(snapshotServers)
    ) {
      return;
    }

    const knownIds = new Set(
      this.mcpDao.getAll().map((server) => server.id),
    );
    let registered = false;

    for (const [id, value] of Object.entries(snapshotServers)) {
      // Only immediate values are server specs. Guard against accidental
      // nested tables being projected as one pseudo "server".
      if (!id.trim() || !value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }
      if (knownIds.has(id)) continue;

      this.mcpDao.upsertDiscovered({
        id,
        name: id,
        serverConfig: value as Record<string, unknown>,
        enabledApps: { codex: true },
      });
      knownIds.add(id);
      registered = true;
    }

    if (registered) this.onMcpServersChanged?.();
  }

  private geminiPaths() {
    const dir = this.configDir("gemini");
    return { dir, env: join(dir, ".env"), settings: join(dir, "settings.json") };
  }

  private writeGemini(provider: Provider): void {
    const settings = asObject(provider.settingsConfig) ?? {};
    const env = asObject(settings.env) ?? {};
    const envText = Object.entries(env)
      .filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === "string")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    const paths = this.geminiPaths();
    atomicWriteText(paths.env, envText, 0o600);

    const config = settings.config;
    if (config !== null && config !== undefined) {
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new Error("Gemini config 必须是 JSON 对象或 null");
      }
      const merged = readJsonObject(paths.settings) ?? {};
      Object.assign(merged, config as Record<string, unknown>);
      atomicWriteJson(paths.settings, merged);
    }

    // CC Switch defaults Gemini's auth UX to API-key mode for non-official
    // providers; Google Official keeps/uses its own OAuth selection.
    const selectedType = isOfficialProvider(provider) ? "oauth-personal" : "gemini-api-key";
    const security = asObject(mergedSecurity(paths.settings)) ?? {};
    const auth = asObject(security.auth) ?? {};
    auth.selectedType = selectedType;
    security.auth = auth;
    const current = readJsonObject(paths.settings) ?? {};
    current.security = security;
    atomicWriteJson(paths.settings, current);
  }

  private writeGrok(provider: Provider): void {
    const settings = asObject(provider.settingsConfig);
    if (!settings) throw new Error("Grok Build 配置必须是 JSON 对象");
    if (typeof settings.config !== "string") {
      throw new Error("Grok Build 配置缺少 config 字段");
    }
    const config = settings.config;
    if (config.trim()) parseCodexToml(config);
    if (provider.category !== "official") validateGrokConfig(config);
    const parsed = config.trim() ? parseCodexToml(config) : {};
    this.projectMcpServers("grokbuild", parsed);
    atomicWriteText(
      join(this.configDir("grokbuild"), "config.toml"),
      stringifyToml(parsed),
    );
  }
}

const CODEX_CATALOG_NEUTRAL_BASE_INSTRUCTIONS =
  "You are Codex, a coding agent. You and the user share the same workspace and collaborate to achieve the user's goals.";

const CODEX_CATALOG_REASONING_LEVEL_DESCRIPTIONS: Record<string, string> = {
  none: "Disable Thinking",
  minimal: "Minimal reasoning",
  low: "Fast responses with lighter reasoning",
  medium: "Balances speed and reasoning depth for everyday tasks",
  high: "Enabled Thinking",
  xhigh: "Extra high reasoning depth for complex problems",
  max: "Maximum reasoning depth for the hardest problems",
  ultra: "Maximum reasoning with automatic task delegation",
};

function codexCatalogString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function codexCatalogPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function codexCatalogModalities(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const modalities = value.filter(
    (item): item is string => typeof item === "string" && Boolean(item.trim()),
  );
  return modalities.length > 0 ? modalities : undefined;
}

function codexCatalogReasoningLevels(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const levels = value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim())
    .filter((level) => Object.hasOwn(CODEX_CATALOG_REASONING_LEVEL_DESCRIPTIONS, level));
  return levels.length > 0 ? levels : undefined;
}

function codexCatalogEntry(
  modelConfig: Record<string, unknown>,
  priority: number,
): Record<string, unknown> | null {
  const model = codexCatalogString(modelConfig.model ?? modelConfig.slug);
  if (!model) return null;

  const displayName =
    codexCatalogString(modelConfig.displayName ?? modelConfig.display_name) ?? model;
  const contextWindow =
    codexCatalogPositiveInt(modelConfig.contextWindow ?? modelConfig.context_window) ?? 262144;
  const baseInstructions =
    codexCatalogString(modelConfig.baseInstructions ?? modelConfig.base_instructions) ??
    CODEX_CATALOG_NEUTRAL_BASE_INSTRUCTIONS;
  const supportsParallelToolCalls =
    typeof modelConfig.supportsParallelToolCalls === "boolean"
      ? modelConfig.supportsParallelToolCalls
      : typeof modelConfig.supports_parallel_tool_calls === "boolean"
        ? modelConfig.supports_parallel_tool_calls
        : false;
  const inputModalities =
    codexCatalogModalities(modelConfig.inputModalities) ??
    codexCatalogModalities(modelConfig.input_modalities) ??
    ["text", "image"];

  const reasoningLevels =
    codexCatalogReasoningLevels(modelConfig.reasoningLevels) ??
    codexCatalogReasoningLevels(modelConfig.reasoning_levels);
  const supportedReasoningLevels = (reasoningLevels ?? ["none", "high"]).map((effort) => ({
    effort,
    description: CODEX_CATALOG_REASONING_LEVEL_DESCRIPTIONS[effort],
  }));
  const requestedDefault = codexCatalogString(
    modelConfig.defaultReasoningLevel ?? modelConfig.default_reasoning_level,
  );
  const defaultReasoningLevel =
    requestedDefault && supportedReasoningLevels.some((level) => level.effort === requestedDefault)
      ? requestedDefault
      : supportedReasoningLevels.some((level) => level.effort === "high")
        ? "high"
        : supportedReasoningLevels[supportedReasoningLevels.length - 1]?.effort ?? "high";

  return {
    slug: model,
    display_name: displayName,
    description: displayName,
    base_instructions: baseInstructions,
    default_reasoning_level: defaultReasoningLevel,
    supported_reasoning_levels: supportedReasoningLevels,
    shell_type: "shell_command",
    visibility: "list",
    supported_in_api: true,
    priority,
    supports_reasoning_summaries: true,
    default_reasoning_summary: "none",
    support_verbosity: false,
    truncation_policy: { mode: "bytes", limit: 10000 },
    supports_parallel_tool_calls: supportsParallelToolCalls,
    supports_image_detail_original: false,
    context_window: contextWindow,
    max_context_window: contextWindow,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    input_modalities: inputModalities,
    supports_search_tool: false,
  };
}

function buildCodexModelCatalog(
  settings: Record<string, unknown>,
): Record<string, unknown> | null {
  const catalog = asObject(settings.modelCatalog);
  if (!catalog || !Array.isArray(catalog.models)) return null;

  const models: Record<string, unknown>[] = [];
  for (const item of catalog.models) {
    const modelConfig = asObject(item);
    if (!modelConfig) continue;
    const entry = codexCatalogEntry(modelConfig, 1000 + models.length);
    if (entry) models.push(entry);
  }

  return models.length > 0 ? { models } : null;
}

function codexCatalogPointerIsOwned(value: unknown, defaultWhenAbsent: boolean): boolean {
  if (typeof value !== "string" || !value.trim()) return defaultWhenAbsent;
  const normalized = value.replaceAll("\\", "/");
  return basename(normalized) === CODEX_MODEL_CATALOG_FILENAME;
}

function mergedSecurity(path: string): unknown {
  return readJsonObject(path)?.security;
}

function resolveOverridePath(raw: string): string {
  if (raw === "~") return homedir();
  if (raw.startsWith("~/") || raw.startsWith("~\\")) {
    const suffix = raw.slice(2).replaceAll("\\", "/");
    return suffix
      .split("/")
      .filter(Boolean)
      .reduce((path, part) => join(path, part), homedir());
  }
  return resolve(raw);
}

function extractCodexToken(auth: Record<string, unknown>, configText: string): string | null {
  const apiKey = auth.OPENAI_API_KEY;
  if (typeof apiKey === "string" && apiKey.trim()) return apiKey.trim();
  const parsed = configText.trim() ? parseCodexToml(configText) : {};
  const providerId = activeCodexModelProviderId(parsed);
  if (providerId && isCustomCodexProviderId(providerId)) {
    const providers = asObject(parsed.model_providers);
    const providerTable = asObject(providers?.[providerId]);
    const token = providerTable?.experimental_bearer_token;
    if (typeof token === "string" && token.trim()) return token.trim();
  }
  const top = parsed.experimental_bearer_token;
  return typeof top === "string" && top.trim() ? top.trim() : null;
}

function isCustomCodexProviderId(id: string): boolean {
  return Boolean(id) && !CODEX_RESERVED_MODEL_PROVIDER_IDS.has(id);
}

function activeCodexModelProviderId(parsed: Record<string, unknown>): string | null {
  const value = parsed.model_provider;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function injectCodexBearerToken(parsed: Record<string, unknown>, token: string): void {
  const providerId = activeCodexModelProviderId(parsed);
  if (!providerId || !isCustomCodexProviderId(providerId)) {
    throw new Error("Codex 第三方配置必须包含自定义 model_providers 条目以承载 API 密钥");
  }
  const providers = asObject(parsed.model_providers);
  const providerTable = asObject(providers?.[providerId]);
  if (!providers || !providerTable) {
    throw new Error(`Codex 配置缺少 [model_providers.${providerId}]`);
  }
  if (hasCodexAuthProvider(providerTable)) return;
  providerTable.experimental_bearer_token = token;
  providers[providerId] = providerTable;
}

function hasCodexAuthProvider(provider: Record<string, unknown>): boolean {
  return Boolean(
    provider.experimental_bearer_token ||
    provider.env_key ||
    provider.auth ||
    provider.http_headers ||
    provider.env_http_headers,
  );
}

function setNestedValue(target: Record<string, unknown>, keys: string[], value: unknown): void {
  let current = target;
  for (const key of keys.slice(0, -1)) {
    const next = asObject(current[key]);
    if (!next) throw new Error(`Codex 配置路径无效: ${keys.join(".")}`);
    current[key] = next;
    current = next;
  }
  current[keys[keys.length - 1]] = value;
}

function isOfficialProvider(provider: Provider): boolean {
  return provider.category === "official" || provider.category === "cn_official";
}

function codexAuthHasLoginMaterial(auth: Record<string, unknown>): boolean {
  return Boolean(auth.tokens || auth.access_token || auth.refresh_token || auth.id_token || auth.OPENAI_API_KEY);
}

function deepMergeToml(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = target[key];
    const sourceObject = asObject(sourceValue);
    const targetObject = asObject(targetValue);
    if (sourceObject) {
      if (!targetObject) target[key] = {};
      deepMergeToml(asObject(target[key])!, sourceObject);
    } else {
      target[key] = structuredClone(sourceValue);
    }
  }
}

function tomlIsSubset(target: unknown, source: unknown): boolean {
  const sourceObject = asObject(source);
  if (sourceObject) {
    const targetObject = asObject(target);
    if (!targetObject) return false;
    return Object.entries(sourceObject).every(([key, value]) =>
      Object.hasOwn(targetObject, key) && tomlIsSubset(targetObject[key], value),
    );
  }
  if (Array.isArray(source)) {
    if (!Array.isArray(target)) return false;
    return source.every((sourceItem) =>
      target.some((targetItem) => tomlIsSubset(targetItem, sourceItem)),
    );
  }
  return target === source;
}

function validateGrokConfig(config: string): void {
  const parsed = parseCodexToml(config);
  const defaultModel = asObject(parsed.models)?.default;
  if (typeof defaultModel !== "string" || !defaultModel.trim()) {
    throw new Error("Grok Build 配置缺少 models.default");
  }
  const models = asObject(parsed.model);
  const model = asObject(models?.[defaultModel]);
  if (!model) throw new Error(`Grok Build 配置缺少 [model."${defaultModel}"]`);
  for (const key of ["model", "base_url", "name", "api_backend"]) {
    const value = model[key];
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Grok Build 模型配置缺少 ${key}`);
    }
  }
  const contextWindow = model.context_window;
  if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    throw new Error("Grok Build context_window 必须是正整数");
  }
}
