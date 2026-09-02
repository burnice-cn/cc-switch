/**
 * Providers DAO — 对应 Rust 端 database/dao/providers.rs
 */
import type { AppDatabase } from "../database.js";

export interface Provider {
  id: string;
  name: string;
  settingsConfig: Record<string, unknown>;
  websiteUrl?: string;
  category?: string;
  createdAt?: number;
  sortIndex?: number;
  notes?: string;
  meta?: Record<string, unknown>;
  icon?: string;
  iconColor?: string;
  inFailoverQueue?: boolean;
}

interface ProviderRow {
  id: string;
  app_type: string;
  name: string;
  settings_config: string;
  website_url: string | null;
  category: string | null;
  created_at: number | null;
  sort_index: number | null;
  notes: string | null;
  icon: string | null;
  icon_color: string | null;
  meta: string;
  is_current: number;
  in_failover_queue: number;
}

function mapRow(row: ProviderRow): Provider & { appType: string; isCurrent: boolean } {
  return {
    id: row.id,
    name: row.name,
    settingsConfig: JSON.parse(row.settings_config ?? "{}"),
    websiteUrl: row.website_url ?? undefined,
    category: row.category ?? undefined,
    createdAt: row.created_at ?? undefined,
    sortIndex: row.sort_index ?? undefined,
    notes: row.notes ?? undefined,
    icon: row.icon ?? undefined,
    iconColor: row.icon_color ?? undefined,
    inFailoverQueue: row.in_failover_queue === 1,
    isCurrent: row.is_current === 1,
    appType: row.app_type,
  };
}

export class ProvidersDao {
  constructor(private db: AppDatabase) {}

  getAll(appType: string): Record<string, Provider> {
    const rows = this.db.all<ProviderRow>(
      "SELECT * FROM providers WHERE app_type = ? ORDER BY sort_index, created_at",
      appType,
    );
    return Object.fromEntries(
      rows.map((r) => [r.id, mapRow(r)]),
    );
  }

  getById(id: string, appType: string): Provider | null {
    const row = this.db.get<ProviderRow>(
      "SELECT * FROM providers WHERE id = ? AND app_type = ?",
      id, appType,
    );
    return row ? mapRow(row) : null;
  }

  getCurrentProviderId(appType: string): string | null {
    const row = this.db.get<{ id: string }>(
      "SELECT id FROM providers WHERE app_type = ? AND is_current = 1",
      appType,
    );
    return row?.id ?? null;
  }

  add(provider: Provider, appType: string, addToLive?: boolean): boolean {
    const result = this.db.run(
      `INSERT INTO providers (id, app_type, name, settings_config, website_url, category, created_at, sort_index, notes, icon, icon_color, meta, is_current, in_failover_queue)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      provider.id, appType, provider.name,
      JSON.stringify(provider.settingsConfig ?? {}),
      provider.websiteUrl ?? null,
      provider.category ?? null,
      provider.createdAt ?? Date.now(),
      provider.sortIndex ?? null,
      provider.notes ?? null,
      provider.icon ?? null,
      provider.iconColor ?? null,
      JSON.stringify(provider.meta ?? {}),
      provider.inFailoverQueue ? 1 : 0,
    );
    return result.changes > 0;
  }

  update(provider: Provider, appType: string, originalId?: string): boolean {
    const id = originalId ?? provider.id;
    const result = this.db.run(
      `UPDATE providers SET name = ?, settings_config = ?, website_url = ?, category = ?, sort_index = ?, notes = ?, icon = ?, icon_color = ?, meta = ?, in_failover_queue = ?
       WHERE id = ? AND app_type = ?`,
      provider.name,
      JSON.stringify(provider.settingsConfig ?? {}),
      provider.websiteUrl ?? null,
      provider.category ?? null,
      provider.sortIndex ?? null,
      provider.notes ?? null,
      provider.icon ?? null,
      provider.iconColor ?? null,
      JSON.stringify(provider.meta ?? {}),
      provider.inFailoverQueue ? 1 : 0,
      id, appType,
    );
    return result.changes > 0;
  }

  delete(id: string, appType: string): boolean {
    const result = this.db.run(
      "DELETE FROM providers WHERE id = ? AND app_type = ?",
      id, appType,
    );
    return result.changes > 0;
  }

  switch(id: string, appType: string): boolean {
    const tx = this.db.db.transaction(() => {
      this.db.run("UPDATE providers SET is_current = 0 WHERE app_type = ?", appType);
      const result = this.db.run(
        "UPDATE providers SET is_current = 1 WHERE id = ? AND app_type = ?",
        id, appType,
      );
      return result.changes > 0;
    });
    return tx() as boolean;
  }

  updateSortOrder(updates: Array<{ id: string; sortIndex: number }>, appType: string): boolean {
    const tx = this.db.db.transaction(() => {
      for (const u of updates) {
        this.db.run(
          "UPDATE providers SET sort_index = ? WHERE id = ? AND app_type = ?",
          u.sortIndex, u.id, appType,
        );
      }
    });
    tx();
    return true;
  }

  getFailoverQueue(appType: string): Provider[] {
    const rows = this.db.all<ProviderRow>(
      "SELECT * FROM providers WHERE app_type = ? AND in_failover_queue = 1 ORDER BY sort_index, created_at",
      appType,
    );
    return rows.map(mapRow);
  }

  setFailoverQueue(id: string, appType: string, enabled: boolean): boolean {
    const result = this.db.run(
      "UPDATE providers SET in_failover_queue = ? WHERE id = ? AND app_type = ?",
      enabled ? 1 : 0, id, appType,
    );
    return result.changes > 0;
  }

  isEmpty(): boolean {
    const row = this.db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM providers",
    );
    return (row?.count ?? 0) === 0;
  }
}
