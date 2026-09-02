import type { FastifyInstance } from "fastify";
import type { AppDatabase } from "../db/database.js";

export function registerUsageRoutes(app: FastifyInstance, db: AppDatabase) {
  // GET /api/usage/summary?app=claude&from=...&to=...
  app.get("/api/usage/summary", async (req, reply) => {
    const { app: appId } = req.query as { app?: string };

    let sql = `
      SELECT
        app_type as appType,
        provider_id as providerId,
        COUNT(*) as requestCount,
        SUM(CASE WHEN status_code < 400 THEN 1 ELSE 0 END) as successCount,
        SUM(input_tokens) as inputTokens,
        SUM(output_tokens) as outputTokens,
        SUM(cache_read_tokens) as cacheReadTokens,
        SUM(cache_creation_tokens) as cacheCreationTokens,
        SUM(CAST(total_cost_usd AS REAL)) as totalCostUsd,
        AVG(latency_ms) as avgLatencyMs
      FROM proxy_request_logs
    `;
    const params: unknown[] = [];
    if (appId) {
      sql += " WHERE app_type = ?";
      params.push(appId);
    }
    sql += " GROUP BY app_type, provider_id";

    const rows = db.all(sql, ...params);
    return reply.send(rows);
  });

  // GET /api/usage/logs?app=claude&page=1&pageSize=50
  app.get("/api/usage/logs", async (req, reply) => {
    const { app: appId, page = "1", pageSize = "50" } = req.query as {
      app?: string; page?: string; pageSize?: string;
    };
    const limit = Math.min(parseInt(pageSize, 10) || 50, 200);
    const offset = ((parseInt(page, 10) || 1) - 1) * limit;

    let where = "";
    const params: unknown[] = [];
    if (appId) {
      where = " WHERE app_type = ?";
      params.push(appId);
    }

    const rows = db.all(
      `SELECT * FROM proxy_request_logs${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    );

    const countRow = db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM proxy_request_logs${where}`,
      ...params,
    );

    return reply.send({ logs: rows, total: countRow?.count ?? 0 });
  });
}
