import type { FastifyInstance } from "fastify";
import { SkillsDao } from "../db/dao/skills-dao.js";
import type { AppDatabase } from "../db/database.js";

export function registerSkillRoutes(app: FastifyInstance, db: AppDatabase) {
  const dao = new SkillsDao(db);

  app.get("/api/skills", async () => dao.getAll());
  app.post("/api/skills", async (req) => dao.add(req.body as any));
  app.delete("/api/skills", async (req) => {
    const { id } = req.query as { id: string };
    return dao.delete(id);
  });
  app.put("/api/skills/toggle", async (req) => {
    const { id, app, enabled } = req.body as { id: string; app: string; enabled: boolean };
    return dao.toggle(id, app, enabled);
  });
}
