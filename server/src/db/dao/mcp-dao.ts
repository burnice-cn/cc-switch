/**
 * MCP Servers DAO — 对应 Rust 端 database/dao/mcp.rs
 */
import type { AppDatabase } from "../database.js";

export interface McpServer {
  id: string;
  name: string;
  serverConfig: Record<string, unknown>;
  description?: string;
  homepage?: string;
  docs?: string;
  tags?: string[];
  enabledApps: Record<string, boolean>;
}

interface McpRow {
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

const APP_COLUMNS: Array<[string, keyof McpRow]> = [
  ["claude", "enabled_claude"],
  ["codex", "enabled_codex"],
  ["gemini", "enabled_gemini"],
  ["grokbuild", "enabled_grokbuild"],
  ["opencode", "enabled_opencode"],
  ["hermes", "enabled_hermes"],
];

function mapRow(row: McpRow): McpServer {
  const enabledApps: Record<string, boolean> = {};
  for (const [app, col] of APP_COLUMNS) {
    enabledApps[app] = (row[col] as number) === 1;
  }
  return {
    id: row.id,
    name: row.name,
    serverConfig: JSON.parse(row.server_config ?? "{}"),
    description: row.description ?? undefined,
    homepage: row.homepage ?? undefined,
    docs: row.docs ?? undefined,
    tags: JSON.parse(row.tags ?? "[]"),
    enabledApps,
  };
}

export class McpDao {
  constructor(private db: AppDatabase) {}

  getAll(): McpServer[] {
    return this.db.all<McpRow>("SELECT * FROM mcp_servers ORDER BY name").map(mapRow);
  }

  getById(id: string): McpServer | null {
    const row = this.db.get<McpRow>("SELECT * FROM mcp_servers WHERE id = ?", id);
    return row ? mapRow(row) : null;
  }

  add(server: McpServer): boolean {
    const result = this.db.run(
      `INSERT OR REPLACE INTO mcp_servers (id, name, server_config, description, homepage, docs, tags, enabled_claude, enabled_codex, enabled_gemini, enabled_grokbuild, enabled_opencode, enabled_hermes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      server.id, server.name,
      JSON.stringify(server.serverConfig ?? {}),
      server.description ?? null,
      server.homepage ?? null,
      server.docs ?? null,
      JSON.stringify(server.tags ?? []),
      server.enabledApps?.claude ? 1 : 0,
      server.enabledApps?.codex ? 1 : 0,
      server.enabledApps?.gemini ? 1 : 0,
      server.enabledApps?.grokbuild ? 1 : 0,
      server.enabledApps?.opencode ? 1 : 0,
      server.enabledApps?.hermes ? 1 : 0,
    );
    return result.changes > 0;
  }

  update(server: McpServer): boolean {
    return this.add(server); // INSERT OR REPLACE 就是 upsert
  }

  delete(id: string): boolean {
    const result = this.db.run("DELETE FROM mcp_servers WHERE id = ?", id);
    return result.changes > 0;
  }
}
