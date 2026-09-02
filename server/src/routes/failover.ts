import type { FastifyInstance } from "fastify";
import type { AppDatabase } from "../db/database.js";

interface CircuitConfig {
  failureThreshold: number;
  successThreshold: number;
  timeoutSeconds: number;
  errorRateThreshold: number;
  minRequests: number;
}

function getConfig(db: AppDatabase, appType: string): CircuitConfig {
  const row = db.get<Record<string, number>>(
    `SELECT circuit_failure_threshold AS failureThreshold,
            circuit_success_threshold AS successThreshold,
            circuit_timeout_seconds AS timeoutSeconds,
            circuit_error_rate_threshold AS errorRateThreshold,
            circuit_min_requests AS minRequests
       FROM proxy_config WHERE app_type = ?`,
    appType,
  );
  return {
    failureThreshold: row?.failureThreshold ?? 4,
    successThreshold: row?.successThreshold ?? 2,
    timeoutSeconds: row?.timeoutSeconds ?? 60,
    errorRateThreshold: row?.errorRateThreshold ?? 0.6,
    minRequests: row?.minRequests ?? 10,
  };
}

export function registerFailoverRoutes(app: FastifyInstance, db: AppDatabase) {
  app.get("/api/failover/provider-health", async (req) => {
    const query = req.query as { providerId?: string; app?: string; appType?: string };
    const providerId = query.providerId;
    const appType = query.app ?? query.appType;
    if (!providerId || !appType) return null;
    return db.get(
      "SELECT * FROM provider_health WHERE provider_id = ? AND app_type = ?",
      providerId,
      appType,
    ) ?? null;
  });

  app.post("/api/failover/reset-circuit-breaker", async (req) => {
    const body = req.body as { providerId?: string; app?: string; appType?: string };
    const providerId = body.providerId;
    const appType = body.app ?? body.appType;
    if (providerId && appType) {
      db.run(
        `INSERT INTO provider_health
           (provider_id, app_type, is_healthy, consecutive_failures, last_error, updated_at)
         VALUES (?, ?, 1, 0, NULL, datetime('now'))
         ON CONFLICT(provider_id, app_type) DO UPDATE SET
           is_healthy = 1, consecutive_failures = 0, last_error = NULL,
           updated_at = datetime('now')`,
        providerId,
        appType,
      );
    }
    return { ok: true };
  });

  app.get("/api/failover/circuit-breaker-config", async (req) => {
    const { app } = req.query as { app?: string };
    return getConfig(db, app ?? "claude");
  });

  app.put("/api/failover/circuit-breaker-config", async (req) => {
    const { app: appType, config } = req.body as {
      app?: string;
      config?: CircuitConfig;
    };
    if (!appType || !config) return false;
    db.run(
      `UPDATE proxy_config SET
         circuit_failure_threshold = ?, circuit_success_threshold = ?,
         circuit_timeout_seconds = ?, circuit_error_rate_threshold = ?,
         circuit_min_requests = ?, updated_at = datetime('now')
       WHERE app_type = ?`,
      config.failureThreshold,
      config.successThreshold,
      config.timeoutSeconds,
      config.errorRateThreshold,
      config.minRequests,
      appType,
    );
    return true;
  });

  app.get("/api/failover/circuit-breaker-stats", async (req) => {
    const query = req.query as { providerId?: string; app?: string; appType?: string };
    const providerId = query.providerId;
    const appType = query.app ?? query.appType;
    if (!providerId || !appType) return null;
    const row = db.get<{
      is_healthy: number;
      consecutive_failures: number;
      total_requests: number;
      failed_requests: number;
    }>(
      `SELECT ph.is_healthy, ph.consecutive_failures,
              COUNT(l.request_id) AS total_requests,
              SUM(CASE WHEN l.status_code >= 400 THEN 1 ELSE 0 END) AS failed_requests
         FROM provider_health ph
         LEFT JOIN proxy_request_logs l
           ON l.provider_id = ph.provider_id AND l.app_type = ph.app_type
        WHERE ph.provider_id = ? AND ph.app_type = ?
        GROUP BY ph.provider_id, ph.app_type`,
      providerId,
      appType,
    );
    if (!row) return null;
    return {
      state: row.is_healthy === 1 ? "closed" : "open",
      consecutiveFailures: row.consecutive_failures,
      consecutiveSuccesses: 0,
      totalRequests: Number(row.total_requests ?? 0),
      failedRequests: Number(row.failed_requests ?? 0),
    };
  });

  app.get("/api/failover/queue", async (req) => {
    const { app: appType } = req.query as { app?: string };
    if (!appType) return [];
    return db
      .all<{ id: string; name: string; notes: string | null; sort_index: number | null }>(
        `SELECT id, name, notes, sort_index FROM providers
          WHERE app_type = ? AND in_failover_queue = 1
          ORDER BY sort_index, created_at`,
        appType,
      )
      .map((row) => ({
        providerId: row.id,
        providerName: row.name,
        providerNotes: row.notes ?? undefined,
        sortIndex: row.sort_index ?? undefined,
      }));
  });

  app.get("/api/failover/available-providers", async (req) => {
    const { app: appType } = req.query as { app?: string };
    if (!appType) return [];
    return db
      .all<Record<string, unknown>>(
        `SELECT id, name, settings_config AS settingsConfig, website_url AS websiteUrl,
                category, created_at AS createdAt, sort_index AS sortIndex, notes,
                icon, icon_color AS iconColor, meta
           FROM providers
          WHERE app_type = ? AND in_failover_queue = 0
          ORDER BY sort_index, created_at`,
        appType,
      )
      .map((row) => ({
        ...row,
        settingsConfig: JSON.parse(String(row.settingsConfig ?? "{}")),
        meta: JSON.parse(String(row.meta ?? "{}")),
      }));
  });

  app.post("/api/failover/queue/add", async (req) => {
    const { app: appType, providerId } = req.body as {
      app?: string;
      providerId?: string;
    };
    if (!appType || !providerId) return false;
    return db.run(
      "UPDATE providers SET in_failover_queue = 1 WHERE id = ? AND app_type = ?",
      providerId,
      appType,
    ).changes > 0;
  });

  app.post("/api/failover/queue/remove", async (req) => {
    const { app: appType, providerId } = req.body as {
      app?: string;
      providerId?: string;
    };
    if (!appType || !providerId) return false;
    return db.run(
      "UPDATE providers SET in_failover_queue = 0 WHERE id = ? AND app_type = ?",
      providerId,
      appType,
    ).changes > 0;
  });

  app.get("/api/failover/auto-enabled", async (req) => {
    const { app: appType } = req.query as { app?: string };
    const row = db.get<{ enabled: number }>(
      "SELECT auto_failover_enabled AS enabled FROM proxy_config WHERE app_type = ?",
      appType ?? "claude",
    );
    return row?.enabled === 1;
  });

  app.put("/api/failover/auto-enabled", async (req) => {
    const { app: appType, enabled } = req.body as {
      app?: string;
      enabled?: boolean;
    };
    if (!appType || typeof enabled !== "boolean") return false;
    return db.run(
      "UPDATE proxy_config SET auto_failover_enabled = ?, updated_at = datetime('now') WHERE app_type = ?",
      enabled ? 1 : 0,
      appType,
    ).changes > 0;
  });
}
