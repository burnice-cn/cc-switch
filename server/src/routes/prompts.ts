import type { FastifyInstance } from "fastify";
import { PromptsDao } from "../db/dao/prompts-dao.js";
import type { AppDatabase } from "../db/database.js";

export function registerPromptRoutes(app: FastifyInstance, db: AppDatabase) {
  const dao = new PromptsDao(db);

  app.get("/api/prompts", async (req) => {
    const { app: appId } = req.query as { app: string };
    return dao.getAll(appId);
  });

  app.post("/api/prompts", async (req) => {
    const { prompt, app: appId } = req.body as { prompt: any; app: string };
    return dao.add(prompt, appId);
  });

  app.delete("/api/prompts", async (req) => {
    const { id, app: appId } = req.query as { id: string; app: string };
    return dao.delete(id, appId);
  });

  app.put("/api/prompts/toggle", async (req) => {
    const { id, app: appId, enabled } = req.body as { id: string; app: string; enabled: boolean };
    return dao.toggle(id, appId, enabled);
  });
}
