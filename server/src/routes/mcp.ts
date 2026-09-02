import type { FastifyInstance } from "fastify";
import { McpDao } from "../db/dao/mcp-dao.js";
import type { AppDatabase } from "../db/database.js";

export function registerMcpRoutes(app: FastifyInstance, db: AppDatabase) {
  const dao = new McpDao(db);

  app.get("/api/mcp", async () => dao.getAll());
  app.post("/api/mcp", async (req) => dao.add(req.body as any));
  app.put("/api/mcp", async (req) => dao.update(req.body as any));
  app.delete("/api/mcp", async (req) => {
    const { id } = req.query as { id: string };
    return dao.delete(id);
  });
}
