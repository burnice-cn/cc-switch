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
    const config = db.all("SELECT * FROM proxy_config");
    return {
      running: proxyServer.isRunning,
      configs: config,
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
}
