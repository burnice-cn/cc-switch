import type { FastifyInstance } from "fastify";
import type { ProviderService } from "../services/provider-service.js";
import type { AppDatabase } from "../db/database.js";
import type { Provider } from "../db/dao/providers-dao.js";

export function registerProviderRoutes(app: FastifyInstance, svc: ProviderService, db: AppDatabase) {
  // GET /api/providers?app=claude
  app.get("/api/providers", async (req, reply) => {
    const { app: appId } = req.query as { app: string };
    return reply.send(svc.getAll(appId));
  });

  // GET /api/providers/current?app=claude
  app.get("/api/providers/current", async (req, reply) => {
    const { app: appId } = req.query as { app: string };
    return reply.send(svc.getCurrentProviderId(appId));
  });

  // POST /api/providers
  app.post("/api/providers", async (req, reply) => {
    const { provider, app: appId, addToLive } = req.body as {
      provider: Provider; app: string; addToLive?: boolean;
    };
    return reply.send(svc.add(provider, appId, addToLive));
  });

  // PUT /api/providers
  app.put("/api/providers", async (req, reply) => {
    const { provider, app: appId, originalId } = req.body as {
      provider: Provider; app: string; originalId?: string;
    };
    return reply.send(svc.update(provider, appId, originalId));
  });

  // DELETE /api/providers
  app.delete("/api/providers", async (req, reply) => {
    const { id, app: appId } = req.query as { id: string; app: string };
    return reply.send(svc.delete(id, appId));
  });

  // POST /api/providers/switch
  app.post("/api/providers/switch", async (req, reply) => {
    const { id, app: appId } = req.body as { id: string; app: string };
    return reply.send(svc.switch(id, appId));
  });

  // PUT /api/providers/sort-order
  app.put("/api/providers/sort-order", async (req, reply) => {
    const { updates, app: appId } = req.body as {
      updates: Array<{ id: string; sortIndex: number }>; app: string;
    };
    return reply.send(svc.updateSortOrder(updates, appId));
  });

  app.post("/api/providers/import-default", async (req, reply) => {
    const { app: appId } = req.body as { app?: string };
    if (!appId) {
      return reply.code(400).send({ message: "缺少应用类型 app" });
    }
    const isEmpty = db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM providers WHERE app_type = ?",
      appId,
    )?.count === 0;
    if (!isEmpty) return false;

    if (appId === "claude" || appId === "codex") {
      const id = appId === "claude" ? "official-claude" : "official-codex";
      const name = appId === "claude" ? "Claude 官方" : "Codex 官方";
      const website = appId === "claude" ? "https://claude.com" : "https://openai.com";
      db.run(
        `INSERT OR IGNORE INTO providers
           (id, app_type, name, settings_config, website_url, category, created_at, sort_index, notes, icon, icon_color, meta, is_current, in_failover_queue)
         VALUES (?, ?, ?, '{}', ?, 'official', ?, 0, NULL, NULL, NULL, '{}', 1, 0)`,
        id,
        appId,
        name,
        website,
        Date.now(),
      );
      return true;
    }
    return false;
  });

  app.delete("/api/providers/live-config", async (req) => {
    const { id, app: appId } = req.query as { id?: string; app?: string };
    if (!id || !appId) return false;
    return db.run(
      "UPDATE providers SET is_current = CASE WHEN id = ? THEN 0 ELSE is_current END WHERE id = ? AND app_type = ?",
      id,
      id,
      appId,
    ).changes > 0;
  });
}
