import type { FastifyInstance } from "fastify";
import type { AppDatabase } from "../db/database.js";
import {
  getModelsDevSyncState,
  recordModelsDevSyncResult,
  saveModelsDevSyncConfig,
} from "../services/models-dev-sync-service.js";

interface FilterParams {
  appType?: string;
  providerName?: string;
  model?: string;
  statusCode?: number;
  startDate?: number;
  endDate?: number;
}

function buildWhere(filters: FilterParams) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.appType && filters.appType !== "all") {
    if (filters.appType === "claude") {
      conditions.push("(app_type = ? OR app_type = 'claude-desktop')");
    } else {
      conditions.push("app_type = ?");
    }
    params.push(filters.appType);
  }
  if (filters.providerName) {
    conditions.push("provider_id IN (SELECT id FROM providers WHERE name = ?)");
    params.push(filters.providerName);
  }
  if (filters.model) {
    conditions.push("(pricing_model = ? OR (pricing_model IS NULL AND model = ?))");
    params.push(filters.model, filters.model);
  }
  if (typeof filters.statusCode === "number") {
    conditions.push("status_code = ?");
    params.push(filters.statusCode);
  }
  if (typeof filters.startDate === "number") {
    conditions.push("created_at >= ?");
    params.push(filters.startDate);
  }
  if (typeof filters.endDate === "number") {
    conditions.push("created_at <= ?");
    params.push(filters.endDate);
  }
  return {
    where: conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

function mapLog(row: Record<string, any>) {
  return {
    requestId: row.request_id,
    providerId: row.provider_id,
    appType: row.app_type,
    model: row.model,
    requestModel: row.request_model ?? undefined,
    pricingModel: row.pricing_model ?? undefined,
    costMultiplier: row.cost_multiplier ?? "1.0",
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
    cacheReadTokens: row.cache_read_tokens ?? 0,
    cacheCreationTokens: row.cache_creation_tokens ?? 0,
    inputCostUsd: row.input_cost_usd ?? "0",
    outputCostUsd: row.output_cost_usd ?? "0",
    cacheReadCostUsd: row.cache_read_cost_usd ?? "0",
    cacheCreationCostUsd: row.cache_creation_cost_usd ?? "0",
    totalCostUsd: row.total_cost_usd ?? "0",
    isStreaming: row.is_streaming === 1,
    latencyMs: row.latency_ms ?? 0,
    firstTokenMs: row.first_token_ms ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    statusCode: row.status_code ?? 0,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at ?? 0,
    dataSource: row.data_source ?? "proxy",
  };
}

function summaryRow(db: AppDatabase, where: string, params: unknown[]) {
  const row = db.get<Record<string, any>>(
    `SELECT COUNT(*) AS totalRequests,
            SUM(CASE WHEN status_code >= 200 AND status_code < 400 THEN 1 ELSE 0 END) AS successRequests,
            SUM(CAST(total_cost_usd AS REAL)) AS totalCost,
            SUM(input_tokens) AS inputTokens,
            SUM(output_tokens) AS outputTokens,
            SUM(cache_creation_tokens) AS cacheCreationTokens,
            SUM(cache_read_tokens) AS cacheReadTokens
       FROM proxy_request_logs${where}`,
    ...params,
  );
  const totalRequests = Number(row?.totalRequests ?? 0);
  const successRequests = Number(row?.successRequests ?? 0);
  const inputTokens = Number(row?.inputTokens ?? 0);
  const outputTokens = Number(row?.outputTokens ?? 0);
  const cacheCreationTokens = Number(row?.cacheCreationTokens ?? 0);
  const cacheReadTokens = Number(row?.cacheReadTokens ?? 0);
  return {
    totalRequests,
    totalCost: String(row?.totalCost ?? 0),
    totalInputTokens: inputTokens,
    totalOutputTokens: outputTokens,
    totalCacheCreationTokens: cacheCreationTokens,
    totalCacheReadTokens: cacheReadTokens,
    successRate: totalRequests ? (Number(row?.successRequests ?? 0) / totalRequests) * 100 : 0,
    realTotalTokens: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
    cacheHitRate: inputTokens + cacheCreationTokens + cacheReadTokens
      ? cacheReadTokens / (inputTokens + cacheCreationTokens + cacheReadTokens)
      : 0,
  };
}

export function registerUsageRoutes(app: FastifyInstance, db: AppDatabase) {
  app.get("/api/usage/summary", async (req) => {
    const query = req.query as { startDate?: string; endDate?: string; appType?: string; providerName?: string; model?: string };
    const filters: FilterParams = {
      appType: query.appType,
      providerName: query.providerName,
      model: query.model,
      startDate: query.startDate ? Number(query.startDate) : undefined,
      endDate: query.endDate ? Number(query.endDate) : undefined,
    };
    const { where, params } = buildWhere(filters);
    return summaryRow(db, where, params);
  });

  app.get("/api/usage/summary-by-app", async (req) => {
    const query = req.query as { startDate?: string; endDate?: string; providerName?: string; model?: string };
    const rows = db.all<{ app_type: string }>(
      "SELECT DISTINCT app_type FROM proxy_request_logs ORDER BY app_type",
    );
    return rows.map(({ app_type }) => {
      const { where, params } = buildWhere({
        appType: app_type,
        providerName: query.providerName,
        model: query.model,
        startDate: query.startDate ? Number(query.startDate) : undefined,
        endDate: query.endDate ? Number(query.endDate) : undefined,
      });
      return { appType: app_type, summary: summaryRow(db, where, params) };
    });
  });

  app.get("/api/usage/trends", async (req) => {
    const query = req.query as { startDate?: string; endDate?: string; appType?: string; providerName?: string; model?: string };
    const { where, params } = buildWhere({
      appType: query.appType,
      providerName: query.providerName,
      model: query.model,
      startDate: query.startDate ? Number(query.startDate) : undefined,
      endDate: query.endDate ? Number(query.endDate) : undefined,
    } as FilterParams);
    const rows = db.all<Record<string, any>>(
      `SELECT date(created_at / 1000, 'unixepoch') AS date,
              COUNT(*) AS requestCount,
              SUM(CAST(total_cost_usd AS REAL)) AS totalCost,
              SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens) AS totalTokens,
              SUM(input_tokens) AS totalInputTokens,
              SUM(output_tokens) AS totalOutputTokens,
              SUM(cache_creation_tokens) AS totalCacheCreationTokens,
              SUM(cache_read_tokens) AS totalCacheReadTokens
         FROM proxy_request_logs${where}
        GROUP BY date(created_at / 1000, 'unixepoch') ORDER BY date`,
      ...params,
    );
    return rows.map((row) => ({ ...row, totalCost: String(row.totalCost ?? 0) }));
  });

  app.get("/api/usage/provider-stats", async (req) => {
    const query = req.query as { startDate?: string; endDate?: string; appType?: string; providerName?: string; model?: string };
    const { where, params } = buildWhere({
      appType: query.appType,
      providerName: query.providerName,
      model: query.model,
      startDate: query.startDate ? Number(query.startDate) : undefined,
      endDate: query.endDate ? Number(query.endDate) : undefined,
    });
    return db.all<Record<string, any>>(
      `SELECT l.provider_id AS providerId,
              COALESCE(p.name, l.provider_id) AS providerName,
              COUNT(*) AS requestCount,
              SUM(l.input_tokens + l.output_tokens + l.cache_read_tokens + l.cache_creation_tokens) AS totalTokens,
              SUM(CAST(l.total_cost_usd AS REAL)) AS totalCost,
              SUM(CASE WHEN l.status_code >= 200 AND l.status_code < 400 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS successRate,
              AVG(l.latency_ms) AS avgLatencyMs
         FROM proxy_request_logs l
         LEFT JOIN providers p ON p.id = l.provider_id AND p.app_type = l.app_type${where}
        GROUP BY l.provider_id, p.name
        ORDER BY totalCost DESC`,
      ...params,
    ).map((row) => ({ ...row, totalCost: String(row.totalCost ?? 0) }));
  });

  app.get("/api/usage/model-stats", async (req) => {
    const query = req.query as { startDate?: string; endDate?: string; appType?: string; providerName?: string; model?: string };
    const { where, params } = buildWhere({
      appType: query.appType,
      providerName: query.providerName,
      model: query.model,
      startDate: query.startDate ? Number(query.startDate) : undefined,
      endDate: query.endDate ? Number(query.endDate) : undefined,
    });
    return db.all<Record<string, any>>(
      `SELECT COALESCE(pricing_model, model) AS model,
              COUNT(*) AS requestCount,
              SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens) AS totalTokens,
              SUM(CAST(total_cost_usd AS REAL)) AS totalCost,
              AVG(CAST(total_cost_usd AS REAL)) AS avgCostPerRequest
         FROM proxy_request_logs${where}
        GROUP BY COALESCE(pricing_model, model)
        ORDER BY totalCost DESC`,
      ...params,
    ).map((row) => ({
      ...row,
      totalCost: String(row.totalCost ?? 0),
      avgCostPerRequest: String(row.avgCostPerRequest ?? 0),
    }));
  });

  app.get("/api/usage/request-logs", async (req) => {
    const body = req.query as {
      filters?: string;
      page?: string;
      pageSize?: string;
      appType?: string;
      app?: string;
      providerName?: string;
      model?: string;
      statusCode?: string;
      startDate?: string;
      endDate?: string;
    };
    const parsedFilters: FilterParams = body.filters
      ? JSON.parse(body.filters) as FilterParams
      : {
          appType: body.appType ?? body.app,
          providerName: body.providerName,
          model: body.model,
          statusCode: body.statusCode ? Number(body.statusCode) : undefined,
          startDate: body.startDate ? Number(body.startDate) : undefined,
          endDate: body.endDate ? Number(body.endDate) : undefined,
        };
    const page = Math.max(0, Number(body.page ?? 0));
    const pageSize = Math.min(Math.max(1, Number(body.pageSize ?? 20)), 200);
    const { where, params } = buildWhere(parsedFilters);
    const rows = db.all<Record<string, any>>(
      `SELECT * FROM proxy_request_logs${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      ...params, pageSize, page * pageSize,
    );
    const total = db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM proxy_request_logs${where}`,
      ...params,
    )?.count ?? 0;
    return { data: rows.map(mapLog), total, page, pageSize };
  });

  app.get("/api/usage/request-detail", async (req) => {
    const { requestId } = req.query as { requestId?: string };
    if (!requestId) return null;
    const row = db.get<Record<string, any>>(
      "SELECT * FROM proxy_request_logs WHERE request_id = ?",
      requestId,
    );
    return row ? mapLog(row) : null;
  });

  app.get("/api/usage/model-pricing", async () =>
    db.all<Record<string, any>>(
      `SELECT model_id AS modelId, display_name AS displayName,
              input_cost_per_million AS inputCostPerMillion,
              output_cost_per_million AS outputCostPerMillion,
              cache_read_cost_per_million AS cacheReadCostPerMillion,
              cache_creation_cost_per_million AS cacheCreationCostPerMillion
         FROM model_pricing ORDER BY display_name, model_id`,
    ),
  );

  app.put("/api/usage/model-pricing", async (req) => {
    const body = req.body as Record<string, string>;
    db.run(
      `INSERT OR REPLACE INTO model_pricing
         (model_id, display_name, input_cost_per_million, output_cost_per_million,
          cache_read_cost_per_million, cache_creation_cost_per_million)
       VALUES (?, ?, ?, ?, ?, ?)`,
      body.modelId, body.displayName ?? body.modelId,
      body.inputCost ?? "0", body.outputCost ?? "0",
      body.cacheReadCost ?? "0", body.cacheCreationCost ?? "0",
    );
    return { ok: true };
  });

  app.post("/api/usage/model-pricing/batch", async (req) => {
    const { entries } = req.body as { entries?: Array<Record<string, string>> };
    if (!Array.isArray(entries)) return 0;
    const tx = db.db.transaction(() => {
      for (const entry of entries) {
        db.run(
          `INSERT OR REPLACE INTO model_pricing
             (model_id, display_name, input_cost_per_million, output_cost_per_million,
              cache_read_cost_per_million, cache_creation_cost_per_million)
           VALUES (?, ?, ?, ?, ?, ?)`,
          entry.modelId, entry.displayName ?? entry.modelId,
          entry.inputCostPerMillion ?? "0", entry.outputCostPerMillion ?? "0",
          entry.cacheReadCostPerMillion ?? "0", entry.cacheCreationCostPerMillion ?? "0",
        );
      }
    });
    tx();
    return entries.length;
  });

  app.delete("/api/usage/model-pricing", async (req) => {
    const { modelId } = req.query as { modelId?: string };
    if (!modelId) return false;
    return db.run("DELETE FROM model_pricing WHERE model_id = ?", modelId).changes > 0;
  });

  app.get("/api/usage/provider-limits", async (req) => {
    const query = req.query as { providerId?: string; app?: string; appType?: string };
    const providerId = query.providerId;
    return {
      providerId: providerId ?? "",
      dailyUsage: "0",
      dailyExceeded: false,
      monthlyUsage: "0",
      monthlyExceeded: false,
    };
  });

  app.post("/api/usage/sync-session", async () => ({
    imported: 0, skipped: 0, filesScanned: 0,
    suspectedDuplicates: 0, deferredFiles: 0, errors: [],
  }));

  app.post("/api/usage/rebuild-codex", async () => ({
    imported: 0, skipped: 0, filesScanned: 0,
    suspectedDuplicates: 0, deferredFiles: 0, errors: [],
  }));

  app.get("/api/usage/data-sources", async () => []);

  app.get("/api/usage/logs", async (req) => {
    const query = req.query as { app?: string; page?: string; pageSize?: string };
    const { where, params } = buildWhere({ appType: query.app });
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(Math.max(1, Number(query.pageSize ?? 50)), 200);
    const rows = db.all<Record<string, any>>(
      `SELECT * FROM proxy_request_logs${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      ...params, pageSize, (page - 1) * pageSize,
    );
    const total = db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM proxy_request_logs${where}`,
      ...params,
    )?.count ?? 0;
    return { data: rows.map(mapLog), total, page, pageSize };
  });

  app.get("/api/usage/models-dev-sync", async () => getModelsDevSyncState(db));
  app.put("/api/usage/models-dev-sync", async (req, reply) => {
    const { config } = (req.body ?? {}) as { config?: unknown };
    if (!config || typeof config !== "object") {
      return reply.code(400).send({ message: "缺少同步配置 config" });
    }
    saveModelsDevSyncConfig(db, config);
    return { ok: true };
  });
  app.post("/api/usage/models-dev-sync/result", async (req) => {
    const { syncedAt, error } = (req.body ?? {}) as { syncedAt?: number | null; error?: string | null };
    recordModelsDevSyncResult(db, syncedAt ?? null, error ?? null);
    return { ok: true };
  });
}
