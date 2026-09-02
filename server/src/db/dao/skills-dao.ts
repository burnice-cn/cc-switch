/**
 * Skills DAO — 对应 Rust 端 database/dao/skills.rs
 */
import type { AppDatabase } from "../database.js";

export interface Skill {
  id: string;
  name: string;
  description?: string;
  directory: string;
  repoOwner?: string;
  repoName?: string;
  repoBranch?: string;
  readmeUrl?: string;
  enabledApps: Record<string, boolean>;
  installedAt: number;
  contentHash?: string;
  updatedAt: number;
}

interface SkillRow {
  id: string;
  name: string;
  description: string | null;
  directory: string;
  repo_owner: string | null;
  repo_name: string | null;
  repo_branch: string | null;
  readme_url: string | null;
  enabled_claude: number;
  enabled_codex: number;
  enabled_gemini: number;
  enabled_grokbuild: number;
  enabled_opencode: number;
  enabled_hermes: number;
  installed_at: number;
  content_hash: string | null;
  updated_at: number;
}

const APP_COLUMNS: Array<[string, keyof SkillRow]> = [
  ["claude", "enabled_claude"],
  ["codex", "enabled_codex"],
  ["gemini", "enabled_gemini"],
  ["grokbuild", "enabled_grokbuild"],
  ["opencode", "enabled_opencode"],
  ["hermes", "enabled_hermes"],
];

function mapRow(row: SkillRow): Skill {
  const enabledApps: Record<string, boolean> = {};
  for (const [app, col] of APP_COLUMNS) {
    enabledApps[app] = (row[col] as number) === 1;
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    directory: row.directory,
    repoOwner: row.repo_owner ?? undefined,
    repoName: row.repo_name ?? undefined,
    repoBranch: row.repo_branch ?? "main",
    readmeUrl: row.readme_url ?? undefined,
    enabledApps,
    installedAt: row.installed_at,
    contentHash: row.content_hash ?? undefined,
    updatedAt: row.updated_at,
  };
}

export class SkillsDao {
  constructor(private db: AppDatabase) {}

  getAll(): Skill[] {
    return this.db.all<SkillRow>("SELECT * FROM skills ORDER BY name").map(mapRow);
  }

  getById(id: string): Skill | null {
    const row = this.db.get<SkillRow>("SELECT * FROM skills WHERE id = ?", id);
    return row ? mapRow(row) : null;
  }

  add(skill: Skill): boolean {
    const result = this.db.run(
      `INSERT OR REPLACE INTO skills (id, name, description, directory, repo_owner, repo_name, repo_branch, readme_url, enabled_claude, enabled_codex, enabled_gemini, enabled_grokbuild, enabled_opencode, enabled_hermes, installed_at, content_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      skill.id, skill.name, skill.description ?? null, skill.directory,
      skill.repoOwner ?? null, skill.repoName ?? null, skill.repoBranch ?? "main",
      skill.readmeUrl ?? null,
      skill.enabledApps?.claude ? 1 : 0,
      skill.enabledApps?.codex ? 1 : 0,
      skill.enabledApps?.gemini ? 1 : 0,
      skill.enabledApps?.grokbuild ? 1 : 0,
      skill.enabledApps?.opencode ? 1 : 0,
      skill.enabledApps?.hermes ? 1 : 0,
      skill.installedAt ?? Date.now(),
      skill.contentHash ?? null,
      skill.updatedAt ?? Date.now(),
    );
    return result.changes > 0;
  }

  delete(id: string): boolean {
    const result = this.db.run("DELETE FROM skills WHERE id = ?", id);
    return result.changes > 0;
  }

  toggle(id: string, app: string, enabled: boolean): boolean {
    const col = APP_COLUMNS.find(([a]) => a === app)?.[1];
    if (!col) return false;
    const result = this.db.run(
      `UPDATE skills SET ${col} = ? WHERE id = ?`,
      enabled ? 1 : 0, id,
    );
    return result.changes > 0;
  }

  getRepos(): Array<{ owner: string; name: string; branch: string; enabled: boolean }> {
    return this.db.all<{ owner: string; name: string; branch: string; enabled: number }>(
      "SELECT * FROM skill_repos",
    ).map((r) => ({ owner: r.owner, name: r.name, branch: r.branch, enabled: r.enabled === 1 }));
  }
}
