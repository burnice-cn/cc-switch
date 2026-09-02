/**
 * models.dev 自动同步配置。
 *
 * 配置保存在 model-pricing.json，格式与桌面版保持兼容；
 * 文件中的用户定价/删除记录会应用到 SQLite。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getAppConfigDir } from "../config/paths.js";
import type { AppDatabase } from "../db/database.js";

export interface ModelPricing {
  modelId: string;
  displayName: string;
  inputCostPerMillion: string;
  outputCostPerMillion: string;
  cacheReadCostPerMillion: string;
  cacheCreationCostPerMillion: string;
}

export interface ModelsDevSyncConfig {
  autoSyncEnabled: boolean;
  includeCommonModels: boolean;
  selectedModelKeys: string[];
  excludedCommonModelKeys: string[];
  lastSyncAt: number | null;
  lastSyncError: string | null;
}

export interface ModelsDevSyncState {
  config: ModelsDevSyncConfig;
  configPath: string;
}

interface ModelPricingFile {
  version: 1;
  modelsDevSync: ModelsDevSyncConfig;
  models: ModelPricing[];
  deletedModelIds: string[];
}

const DEFAULT_CONFIG: ModelsDevSyncConfig = {
  autoSyncEnabled: false,
  includeCommonModels: true,
  selectedModelKeys: [],
  excludedCommonModelKeys: [],
  lastSyncAt: null,
  lastSyncError: null,
};

const configFilePath = () => join(getAppConfigDir(), "model-pricing.json");

function normalizeKeyList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values.map((value) => String(value).trim()).filter(Boolean),
  )].sort();
}

function normalizeDecimal(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  const parsed = Number(text);
  if (!text || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} 价格无效: ${String(value)}`);
  }
  return text;
}

function normalizePricing(value: unknown): ModelPricing {
  if (!value || typeof value !== "object") {
    throw new Error("模型定价格式无效");
  }
  const input = value as Partial<ModelPricing>;
  const modelId = String(input.modelId ?? "").trim();
  const displayName = String(input.displayName ?? "").trim();
  if (!modelId) throw new Error("模型 ID 不能为空");
  if (!displayName) throw new Error("显示名称不能为空");

  return {
    modelId,
    displayName,
    inputCostPerMillion: normalizeDecimal(input.inputCostPerMillion, "input_cost"),
    outputCostPerMillion: normalizeDecimal(input.outputCostPerMillion, "output_cost"),
    cacheReadCostPerMillion: normalizeDecimal(input.cacheReadCostPerMillion, "cache_read_cost"),
    cacheCreationCostPerMillion: normalizeDecimal(input.cacheCreationCostPerMillion, "cache_creation_cost"),
  };
}

function normalizeConfig(value: unknown): ModelsDevSyncConfig {
  if (!value || typeof value !== "object") return { ...DEFAULT_CONFIG };

  const input = value as Partial<ModelsDevSyncConfig>;
  const error = String(input.lastSyncError ?? "").trim();
  return {
    autoSyncEnabled: input.autoSyncEnabled === true,
    includeCommonModels: input.includeCommonModels !== false,
    selectedModelKeys: normalizeKeyList(input.selectedModelKeys),
    excludedCommonModelKeys: normalizeKeyList(input.excludedCommonModelKeys),
    lastSyncAt:
      typeof input.lastSyncAt === "number" && Number.isFinite(input.lastSyncAt)
        ? Math.trunc(input.lastSyncAt)
        : null,
    lastSyncError: error ? error.slice(0, 1000) : null,
  };
}

function normalizeFile(value: unknown): ModelPricingFile {
  if (!value || typeof value !== "object") {
    throw new Error("model-pricing.json 格式无效");
  }
  const input = value as Partial<ModelPricingFile>;
  if (typeof input.version === "number" && input.version > 1) {
    throw new Error("model-pricing.json 版本过新，请升级应用");
  }

  return {
    version: 1,
    modelsDevSync: normalizeConfig(input.modelsDevSync),
    models: Array.isArray(input.models) ? input.models.map(normalizePricing) : [],
    deletedModelIds: normalizeKeyList(input.deletedModelIds),
  };
}

function saveFile(file: ModelPricingFile): void {
  mkdirSync(getAppConfigDir(), { recursive: true });
  writeFileSync(configFilePath(), `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

function applyFileToDatabase(db: AppDatabase, file: ModelPricingFile): void {
  const statement = db.db.prepare(`
    INSERT INTO model_pricing (
      model_id, display_name, input_cost_per_million, output_cost_per_million,
      cache_read_cost_per_million, cache_creation_cost_per_million
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(model_id) DO UPDATE SET
      display_name = excluded.display_name,
      input_cost_per_million = excluded.input_cost_per_million,
      output_cost_per_million = excluded.output_cost_per_million,
      cache_read_cost_per_million = excluded.cache_read_cost_per_million,
      cache_creation_cost_per_million = excluded.cache_creation_cost_per_million
  `);

  for (const entry of file.models) {
    statement.run(
      entry.modelId,
      entry.displayName,
      entry.inputCostPerMillion,
      entry.outputCostPerMillion,
      entry.cacheReadCostPerMillion,
      entry.cacheCreationCostPerMillion,
    );
  }

  const deleteStatement = db.db.prepare(
    "DELETE FROM model_pricing WHERE model_id = ?",
  );
  for (const modelId of file.deletedModelIds) {
    deleteStatement.run(modelId);
  }
}

function loadFile(db: AppDatabase): ModelPricingFile {
  const path = configFilePath();
  mkdirSync(getAppConfigDir(), { recursive: true });

  if (!existsSync(path)) {
    const file: ModelPricingFile = {
      version: 1,
      modelsDevSync: { ...DEFAULT_CONFIG },
      models: [],
      deletedModelIds: [],
    };
    saveFile(file);
    return file;
  }

  try {
    return normalizeFile(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    throw new Error(
      `读取模型定价配置失败: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function getModelsDevSyncState(db: AppDatabase): ModelsDevSyncState {
  const file = loadFile(db);
  applyFileToDatabase(db, file);
  return {
    config: file.modelsDevSync,
    configPath: configFilePath(),
  };
}

export function saveModelsDevSyncConfig(
  db: AppDatabase,
  config: unknown,
): void {
  const currentFile = loadFile(db);
  const normalizedConfig = normalizeConfig(config);
  const file: ModelPricingFile = {
    ...currentFile,
    version: 1,
    modelsDevSync: normalizedConfig,
  };
  saveFile(file);
  applyFileToDatabase(db, file);
}

export function recordModelsDevSyncResult(
  db: AppDatabase,
  syncedAt: unknown,
  error: unknown,
): void {
  const currentFile = loadFile(db);
  const file: ModelPricingFile = {
    ...currentFile,
    version: 1,
    modelsDevSync: {
      ...currentFile.modelsDevSync,
      lastSyncAt:
        typeof syncedAt === "number" && Number.isFinite(syncedAt)
          ? Math.trunc(syncedAt)
          : null,
      lastSyncError:
        error == null || String(error).trim() === ""
          ? null
          : String(error).trim().slice(0, 1000),
    },
  };
  saveFile(file);
  applyFileToDatabase(db, file);
}
