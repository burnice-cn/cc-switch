import type { FastifyInstance } from "fastify";
import type { AppDatabase } from "../db/database.js";

interface DbMcpRow {
  id: string;
  name: string;
  server_config: string;
  description: string | null;
  homepage: string | null;
  docs: string | null;
  tags: string;
  enabled_claude: number;
  enabled_codex: number;
  enabled_gemini: number;
  enabled_grokbuild: number;
  enabled_opencode: number;
  enabled_hermes: number;
}

const APP_COLUMNS: Array<[string, keyof DbMcpRow]> = [
  ["claude", "enabled_claude"],
  ["claude-desktop", "enabled_claude"],
  ["codex", "enabled_codex"],
  ["gemini", "enabled_gemini"],
  ["grokbuild", "enabled_grokbuild"],
  ["opencode", "enabled_opencode"],
  ["openclaw", "enabled_codex"],
  ["hermes", "enabled_hermes"],
];

function mapRow(row: DbMcpRow) {
  const apps: Record<string, boolean> = {};
  for (const [app, col] of APP_COLUMNS) {
    apps[app] = row[col as keyof DbMcpRow] === 1;
  }
  return {
    id: row.id,
    name: row.name,
    server: JSON.parse(row.server_config ?? "{}"),
    apps,
    description: row.description ?? undefined,
    homepage: row.homepage ?? undefined,
    docs: row.docs ?? undefined,
    tags: JSON.parse(row.tags ?? "[]"),
  };
}

function columnForApp(app: string) {
  switch (app) {
    case "claude":
    case "claude-desktop":
    case "openclaw":
      return app === "openclaw" ? "enabled_codex" : "enabled_claude";
    case "codex":
      return "enabled_codex";
    case "gemini":
      return "enabled_gemini";
    case "grokbuild":
      return "enabled_grokbuild";
    case "opencode":
      return "enabled_opencode";
    case "hermes":
      return "enabled_hermes";
    default:
      return null;
  }
}

export function registerMcpRoutes(app: FastifyInstance, db: AppDatabase) {
  app.get("/api/mcp", async () => {
    return Object.fromEntries(
      db.all<DbMcpRow>("SELECT * FROM mcp_servers ORDER BY name").map(mapRow).map((server) => [server.id, server]),
    );
  });

  app.post("/api/mcp/upsert", async (req) => {
    const { server } = req.body as { server?: any };
    if (!server?.id || !server?.name) return false;
    const apps = server.apps ?? {};
    db.run(
      `INSERT OR REPLACE INTO mcp_servers
         (id, name, server_config, description, homepage, docs, tags,
          enabled_claude, enabled_codex, enabled_gemini, enabled_grokbuild, enabled_opencode, enabled_hermes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      server.id,
      server.name,
      JSON.stringify(server.server ?? {}),
      server.description ?? null,
      server.homepage ?? null,
      server.docs ?? null,
      JSON.stringify(server.tags ?? []),
      apps.claude || apps["claude-desktop"] ? 1 : 0,
      apps.codex || apps.openclaw ? 1 : 0,
      apps.gemini ? 1 : 0,
      apps.grokbuild ? 1 : 0,
      apps.opencode ? 1 : 0,
      apps.hermes ? 1 : 0,
    );
    return true;
  });

  app.delete("/api/mcp", async (req) => {
    const { id } = req.query as { id?: string };
    if (!id) return false;
    return db.run("DELETE FROM mcp_servers WHERE id = ?", id).changes > 0;
  });

  app.post("/api/mcp/toggle-app", async (req) => {
    const body = req.body as { serverId?: string; id?: string; app?: string; enabled?: boolean };
    const serverId = body.serverId ?? body.id;
    const app = body.app;
    const enabled = body.enabled;
    const column = app ? columnForApp(app) : null;
    if (!serverId || !column) return false;
    return db.run(
      `UPDATE mcp_servers SET ${column} = ? WHERE id = ?`,
      enabled ? 1 : 0,
      serverId,
    ).changes > 0;
  });

  app.post("/api/mcp/import", async () => 0);

  app.post("/api/mcp/validate-command", async (req) => {
    const { cmd } = req.body as { cmd?: string };
    if (!cmd) return false;
    try {
      const [command] = cmd.split(/\s+/);
      return Boolean(command);
    } catch {
      return false;
    }
  });

  app.get("/api/mcp/config", async (req) => {
    const { app } = req.query as { app?: string };
    const map = Object.fromEntries(
      db.all<DbMcpRow>("SELECT * FROM mcp_servers ORDER BY name").map(mapRow).map((server) => [server.id, server]),
    );
    return { configPath: app ?? "unified", servers: map };
  });

  app.post("/api/mcp/config/upsert", async (req) => {
    const { spec, app } = req.body as { spec?: any; app?: string };
    if (!spec?.id || !app) return false;
    db.run(
      `INSERT OR REPLACE INTO mcp_servers
         (id, name, server_config, description, homepage, docs, tags,
          enabled_claude, enabled_codex, enabled_gemini, enabled_grokbuild, enabled_opencode, enabled_hermes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      spec.id,
      spec.name ?? spec.id,
      JSON.stringify(spec.server ?? spec.serverConfig ?? {}),
      spec.description ?? null,
      spec.homepage ?? null,
      spec.docs ?? null,
      JSON.stringify(spec.tags ?? []),
      app === "claude" || app === "claude-desktop" ? 1 : 0,
      app === "codex" || app === "openclaw" ? 1 : 0,
      app === "gemini" ? 1 : 0,
      app === "grokbuild" ? 1 : 0,
      app === "opencode" ? 1 : 0,
      app === "hermes" ? 1 : 0,
    );
    return true;
  });

  app.delete("/api/mcp/config", async (req) => {
    return db.run("DELETE FROM mcp_servers WHERE id = ?", (req.query as any).id ?? "").changes > 0;
  });
}
