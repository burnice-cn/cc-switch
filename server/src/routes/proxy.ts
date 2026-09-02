import type { FastifyInstance } from "fastify";
import type { AppDatabase } from "../db/database.js";
import type { EventBroadcaster } from "../ws/broadcaster.js";
import type { ProxyServer } from "../proxy/proxy-server.js";

export function registerProxyRoutes(
  app: FastifyInstance,
  db: AppDatabase,
  broadcaster: EventBroadcaster,
  proxyServer: ProxyServer,
) {
  // GET /api/proxy/status
  app.get("/api/proxy/status", async () => {
    const config = db.all<{ app_type: string; listen_address: string; listen_port: number }>("SELECT * FROM proxy_config");
    return {
      running: proxyServer.isRunning,
      configs: config,
      address: config.find((item) => item.app_type === "claude")?.listen_address ?? "127.0.0.1",
      port: config.find((item) => item.app_type === "claude")?.listen_port ?? 15721,
      active_connections: 0,
      total_requests: 0,
      success_requests: 0,
      failed_requests: 0,
      success_rate: 0,
      uptime_seconds: 0,
      current_provider: null,
      current_provider_id: null,
      last_request_at: null,
      last_error: null,
      failover_count: 0,
      active_targets: db.all<{ id: string; name: string; app_type: string }>(
        "SELECT id, name, app_type FROM providers WHERE is_current = 1 AND app_type IN ('claude','codex','gemini','grokbuild')",
      ).map((row) => ({ app_type: row.app_type, provider_id: row.id, provider_name: row.name })),
    };
  });

  // GET /api/proxy/takeover
  app.get("/api/proxy/takeover", async () => {
    const rows = db.all<{ app_type: string; live_takeover_active: number }>(
      "SELECT app_type, live_takeover_active FROM proxy_config",
    );
    const flags = Object.fromEntries(
      rows.map((row) => [row.app_type, row.live_takeover_active === 1]),
    );
    return {
      claude: flags.claude ?? false,
      "claude-desktop": false,
      codex: flags.codex ?? false,
      gemini: flags.gemini ?? false,
      grokbuild: flags.grokbuild ?? false,
      opencode: false,
      openclaw: false,
      hermes: false,
    };
  });

  // POST /api/proxy/start
  app.post("/api/proxy/start", async () => {
    const config = db.get<{ listen_address: string; listen_port: number }>(
      "SELECT * FROM proxy_config WHERE app_type = 'claude'",
    );
    const port = config?.listen_port ?? 15721;
    await proxyServer.start(port);
    broadcaster.emitProxyFlagsChanged({ running: true });
    return { running: true, port };
  });

  // POST /api/proxy/stop
  app.post("/api/proxy/stop", async () => {
    await proxyServer.stop();
    broadcaster.emitProxyFlagsChanged({ running: false });
    return { running: false };
  });

  app.post("/api/proxy/stop-restore", async () => {
    await proxyServer.stop();
    broadcaster.emitProxyFlagsChanged({ running: false });
    return { running: false, restored: true };
  });

app.get("/api/proxy/global-config", async () => {
  const row = db.get<Record<string, any>>(
    "SELECT proxy_enabled, listen_address, listen_port, enable_logging FROM proxy_config WHERE app_type = 'claude'",
  );
  return {
    proxyEnabled: row?.proxy_enabled === 1,
    listenAddress: row?.listen_address ?? "127.0.0.1",
    listenPort: row?.listen_port ?? 15721,
    enableLogging: row?.enable_logging === 1,
  };
});

app.put("/api/proxy/global-config", async (req) => {
  const body = req.body as Record<string, any>;
  db.run(
    `UPDATE proxy_config SET proxy_enabled = ?, listen_address = ?, listen_port = ?,
       enable_logging = ?, updated_at = datetime('now')`,
    body.proxyEnabled ? 1 : 0,
    body.listenAddress ?? "127.0.0.1",
    body.listenPort ?? 15721,
    body.enableLogging ? 1 : 0,
  );
  return { ok: true };
});

app.get("/api/proxy/app-config", async (req) => {
  const { app } = req.query as { app?: string };
  const row = db.get<Record<string, any>>(
    `SELECT app_type, enabled, auto_failover_enabled, max_retries,
            streaming_first_byte_timeout, streaming_idle_timeout, non_streaming_timeout,
            circuit_failure_threshold, circuit_success_threshold, circuit_timeout_seconds,
            circuit_error_rate_threshold, circuit_min_requests
       FROM proxy_config WHERE app_type = ?`,
    app ?? "claude",
  );
  if (!row) return null;
  return {
    appType: row.app_type,
    enabled: row.enabled === 1,
    autoFailoverEnabled: row.auto_failover_enabled === 1,
    maxRetries: row.max_retries,
    streamingFirstByteTimeout: row.streaming_first_byte_timeout,
    streamingIdleTimeout: row.streaming_idle_timeout,
    nonStreamingTimeout: row.non_streaming_timeout,
    circuitFailureThreshold: row.circuit_failure_threshold,
    circuitSuccessThreshold: row.circuit_success_threshold,
    circuitTimeoutSeconds: row.circuit_timeout_seconds,
    circuitErrorRateThreshold: row.circuit_error_rate_threshold,
    circuitMinRequests: row.circuit_min_requests,
  };
});

app.put("/api/proxy/app-config", async (req) => {
  const body = req.body as any;
  if (!body?.appType) return false;
  return db.run(
    `UPDATE proxy_config SET enabled = ?, auto_failover_enabled = ?, max_retries = ?,
       streaming_first_byte_timeout = ?, streaming_idle_timeout = ?, non_streaming_timeout = ?,
       circuit_failure_threshold = ?, circuit_success_threshold = ?, circuit_timeout_seconds = ?,
       circuit_error_rate_threshold = ?, circuit_min_requests = ?, updated_at = datetime('now')
     WHERE app_type = ?`,
    body.enabled ? 1 : 0,
    body.autoFailoverEnabled ? 1 : 0,
    body.maxRetries ?? 3,
    body.streamingFirstByteTimeout ?? 60,
    body.streamingIdleTimeout ?? 120,
    body.nonStreamingTimeout ?? 600,
    body.circuitFailureThreshold ?? 4,
    body.circuitSuccessThreshold ?? 2,
    body.circuitTimeoutSeconds ?? 60,
    body.circuitErrorRateThreshold ?? 0.6,
    body.circuitMinRequests ?? 10,
    body.appType,
  ).changes > 0;
});

app.post("/api/proxy/takeover", async (req) => {
  const { app, enabled } = req.body as { app?: string; enabled?: boolean };
  if (!app) return false;
  return db.run(
    "UPDATE proxy_config SET live_takeover_active = ?, updated_at = datetime('now') WHERE app_type = ?",
    enabled ? 1 : 0,
    app,
  ).changes > 0;
});
}
