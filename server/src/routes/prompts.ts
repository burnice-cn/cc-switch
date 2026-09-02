import type { FastifyInstance } from "fastify";
import type { AppDatabase } from "../db/database.js";

interface PromptRow {
  id: string;
  app_type: string;
  name: string;
  content: string;
  description: string | null;
  enabled: number;
  created_at: number | null;
  updated_at: number | null;
}

function mapRow(row: PromptRow) {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    description: row.description ?? undefined,
    enabled: row.enabled === 1,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}

export function registerPromptRoutes(app: FastifyInstance, db: AppDatabase) {
  app.get("/api/prompts", async (req) => {
    const { app: appId } = req.query as { app?: string };
    if (!appId) return {};
    return Object.fromEntries(
      db.all<PromptRow>(
        "SELECT * FROM prompts WHERE app_type = ? ORDER BY created_at DESC",
        appId,
      ).map(mapRow).map((prompt) => [prompt.id, prompt]),
    );
  });

  app.post("/api/prompts/upsert", async (req) => {
    const { app: appType, id, prompt } = req.body as {
      app?: string; id?: string; prompt?: any;
    };
    if (!appType || !id || !prompt) return false;
    db.run(
      `INSERT OR REPLACE INTO prompts
         (id, app_type, name, content, description, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, appType, prompt.name ?? id, prompt.content ?? "",
      prompt.description ?? null, prompt.enabled === false ? 0 : 1,
      prompt.createdAt ?? Date.now(), prompt.updatedAt ?? Date.now(),
    );
    return true;
  });

  app.delete("/api/prompts", async (req) => {
    const { id, app: appType } = req.query as { id?: string; app?: string };
    if (!id || !appType) return false;
    return db.run("DELETE FROM prompts WHERE id = ? AND app_type = ?", id, appType).changes > 0;
  });

  app.post("/api/prompts/enable", async (req) => {
    const { app: appType, id } = req.body as { app?: string; id?: string };
    if (!appType || !id) return false;
    return db.run("UPDATE prompts SET enabled = 1 WHERE id = ? AND app_type = ?", id, appType).changes > 0;
  });

  app.post("/api/prompts/import-from-file", async () => "");
  app.post("/api/prompts/current-file", async () => null);
  app.get("/api/prompts/pi-file", async () => ({ exists: false, revision: "", content: "" }));
  app.post("/api/prompts/pi-file", async () => ({ exists: false, revision: "", content: "" }));
  app.delete("/api/prompts/pi-file", async () => false);
  app.get("/api/prompts/pi-templates", async () => []);
  app.post("/api/prompts/pi-templates", async (req) => {
    const { slug } = req.body as { slug?: string };
    return { slug: slug ?? "", content: "", revision: "" };
  });
}
