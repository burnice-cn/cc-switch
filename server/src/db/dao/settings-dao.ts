/**
 * Settings DAO — 对应 Rust 端 database/dao/settings.rs
 */
import type { AppDatabase } from "../database.js";

export class SettingsDao {
  constructor(private db: AppDatabase) {}

  get(key: string): string | null {
    const row = this.db.get<{ value: string }>(
      "SELECT value FROM settings WHERE key = ?",
      key,
    );
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.db.run(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
      key, value,
    );
  }

  delete(key: string): void {
    this.db.run("DELETE FROM settings WHERE key = ?", key);
  }

  getAll(): Record<string, string> {
    const rows = this.db.all<{ key: string; value: string }>(
      "SELECT key, value FROM settings",
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
}
