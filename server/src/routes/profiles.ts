import type { FastifyInstance } from "fastify";
import type { AppDatabase } from "../db/database.js";

interface ProfileRow {
  id: string;
  name: string;
  payload: string;
  created_at: number | null;
  updated_at: number | null;
}

function mapProfile(row: ProfileRow) {
  return {
    id: row.id,
    name: row.name,
    payload: JSON.parse(row.payload || "{}"),
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}

function currentIds(db: AppDatabase) {
  const raw = db.get<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'current_profile_ids'",
  )?.value;
  const parsed = raw ? JSON.parse(raw) as Record<string, string | null> : {};
  return {
    claude: parsed.claude ?? null,
    claudeDesktop: parsed.claudeDesktop ?? null,
    codex: parsed.codex ?? null,
  };
}

export function registerProfileRoutes(app: FastifyInstance, db: AppDatabase) {
  app.get("/api/profiles", async () => {
    const rows = db.all<ProfileRow>("SELECT * FROM profiles ORDER BY created_at");
    return { profiles: rows.map(mapProfile), currentIds: currentIds(db) };
  });

  app.post("/api/profiles", async (req) => {
    const { profile } = req.body as {
      profile?: {
        id?: string;
        name?: string;
        description?: string;
        payload?: unknown;
      };
    };
    if (!profile?.name) return false;
    const id = profile.id ?? crypto.randomUUID();
    const now = Date.now();
    db.run(
      `INSERT OR REPLACE INTO profiles (id, name, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      profile.name,
      JSON.stringify(profile.payload ?? { providers: {}, mcp: {}, skills: {}, prompts: {} }),
      now,
      now,
    );
    return true;
  });

  app.put("/api/profiles", async (req) => {
    const { id, profile } = req.body as { id?: string; profile?: any };
    if (!id || !profile?.name) return false;
    return db.run(
      "UPDATE profiles SET name = ?, payload = ?, updated_at = ? WHERE id = ?",
      profile.name,
      JSON.stringify(profile.payload ?? {}),
      Date.now(),
      id,
    ).changes > 0;
  });

  app.delete("/api/profiles", async (req) => {
    const { id } = req.query as { id?: string };
    if (!id) return false;
    return db.run("DELETE FROM profiles WHERE id = ?", id).changes > 0;
  });

  app.post("/api/profiles/apply", async (req, reply) => {
    const { id } = req.body as { id?: string };
    if (!id) {
      return reply.code(400).send({ message: "缺少配置档案 id" });
    }
    const exists = db.get("SELECT id FROM profiles WHERE id = ?", id);
    if (!exists) {
      return reply.code(404).send({ message: "配置档案不存在" });
    }
    return [];
  });

  app.post("/api/profiles/clear-current", async (req) => {
    const { scope } = req.body as { scope?: string };
    const current = currentIds(db);
    if (scope === "claude") current.claude = null;
    else if (scope === "claude-desktop") current.claudeDesktop = null;
    else if (scope === "codex") current.codex = null;
    db.run(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('current_profile_ids', ?)",
      JSON.stringify(current),
    );
    return { ok: true };
  });
}
