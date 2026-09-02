import type { FastifyInstance } from "fastify";
import type { AppDatabase } from "../db/database.js";
import axios from "axios";

export function registerEndpointRoutes(app: FastifyInstance, db: AppDatabase) {
  app.get("/api/provider-endpoints", async (req) => {
    const query = req.query as { providerId?: string; app?: string; appType?: string };
    const providerId = query.providerId;
    const appType = query.app ?? query.appType;
    if (!providerId || !appType) return [];
    return db
      .all<{ id: number; url: string; added_at: number | null }>(
        `SELECT id, url, added_at FROM provider_endpoints
          WHERE provider_id = ? AND app_type = ? ORDER BY id`,
        providerId,
        appType,
      )
      .map((row) => ({
        id: String(row.id),
        url: row.url,
        addedAt: row.added_at ?? undefined,
      }));
  });

  app.post("/api/provider-endpoints", async (req, reply) => {
    const body = req.body as { providerId?: string; app?: string; appType?: string; url?: string };
    const providerId = body.providerId;
    const appType = body.app ?? body.appType;
    const url = body.url;
    if (!providerId || !appType || !url) {
      return reply.code(400).send({ message: "缺少 providerId、app 或 url" });
    }
    db.run(
      "INSERT INTO provider_endpoints (provider_id, app_type, url, added_at) VALUES (?, ?, ?, ?)",
      providerId,
      appType,
      url,
      Date.now(),
    );
    return true;
  });

  app.delete("/api/provider-endpoints", async (req) => {
    const query = req.query as { providerId?: string; app?: string; appType?: string; url?: string };
    const providerId = query.providerId;
    const appType = query.app ?? query.appType;
    const url = query.url;
    if (!providerId || !appType || !url) return false;
    return db.run(
      "DELETE FROM provider_endpoints WHERE provider_id = ? AND app_type = ? AND url = ?",
      providerId,
      appType,
      url,
    ).changes > 0;
  });

  app.post("/api/provider-endpoints/last-used", async (req) => {
    const body = req.body as { providerId?: string; app?: string; appType?: string; url?: string };
    const providerId = body.providerId;
    const appType = body.app ?? body.appType;
    const url = body.url;
    if (providerId && appType && url) {
      db.run(
        "UPDATE provider_endpoints SET added_at = ? WHERE provider_id = ? AND app_type = ? AND url = ?",
        Date.now(),
        providerId,
        appType,
        url,
      );
    }
    return { ok: true };
  });

  app.post("/api/provider-endpoints/test", async (req, reply) => {
    const { endpoints } = req.body as { endpoints?: Array<{ url: string }> };
    if (!Array.isArray(endpoints)) {
      return reply.code(400).send({ message: "缺少 endpoints" });
    }
    return Promise.all(
      endpoints.map(async ({ url }) => {
        const startedAt = Date.now();
        try {
          const response = await axios.get(url, { timeout: 5000 });
          return { url, latency: Date.now() - startedAt, status: response.status };
        } catch (error) {
          return {
            url,
            latency: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
  });

  app.post("/api/provider-endpoints/read-live-settings", async () => null);

  app.post("/api/config/export-file", async () => null
);

  app.post("/api/config/import-file", async () => "");
}
