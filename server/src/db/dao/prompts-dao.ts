/**
 * Prompts DAO — 对应 Rust 端 database/dao/prompts.rs
 */
import type { AppDatabase } from "../database.js";

export interface Prompt {
  id: string;
  name: string;
  content: string;
  description?: string;
  enabled: boolean;
  createdAt?: number;
  updatedAt?: number;
}

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

function mapRow(row: PromptRow): Prompt {
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

export class PromptsDao {
  constructor(private db: AppDatabase) {}

  getAll(appType: string): Prompt[] {
    return this.db.all<PromptRow>(
      "SELECT * FROM prompts WHERE app_type = ? ORDER BY created_at DESC",
      appType,
    ).map(mapRow);
  }

  getById(id: string, appType: string): Prompt | null {
    const row = this.db.get<PromptRow>(
      "SELECT * FROM prompts WHERE id = ? AND app_type = ?",
      id, appType,
    );
    return row ? mapRow(row) : null;
  }

  add(prompt: Prompt, appType: string): boolean {
    const result = this.db.run(
      `INSERT OR REPLACE INTO prompts (id, app_type, name, content, description, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      prompt.id, appType, prompt.name, prompt.content,
      prompt.description ?? null,
      prompt.enabled ? 1 : 0,
      prompt.createdAt ?? Date.now(),
      prompt.updatedAt ?? Date.now(),
    );
    return result.changes > 0;
  }

  delete(id: string, appType: string): boolean {
    const result = this.db.run(
      "DELETE FROM prompts WHERE id = ? AND app_type = ?",
      id, appType,
    );
    return result.changes > 0;
  }

  toggle(id: string, appType: string, enabled: boolean): boolean {
    const result = this.db.run(
      "UPDATE prompts SET enabled = ? WHERE id = ? AND app_type = ?",
      enabled ? 1 : 0, id, appType,
    );
    return result.changes > 0;
  }
}
