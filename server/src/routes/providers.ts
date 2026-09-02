import type { FastifyInstance } from "fastify";
import type { ProviderService } from "../services/provider-service.js";
import type { Provider } from "../db/dao/providers-dao.js";

export function registerProviderRoutes(app: FastifyInstance, svc: ProviderService) {
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
}
