/**
 * Provider 服务 — 对应 Rust 端 services/provider/mod.rs
 */
import type { AppDatabase } from "../db/database.js";
import { ProvidersDao, type Provider } from "../db/dao/providers-dao.js";
import type { EventBroadcaster } from "../ws/broadcaster.js";

export class ProviderService {
  private dao: ProvidersDao;

  constructor(private db: AppDatabase, private broadcaster: EventBroadcaster) {
    this.dao = new ProvidersDao(db);
  }

  getAll(appType: string): Record<string, Provider> {
    return this.dao.getAll(appType);
  }

  getCurrentProviderId(appType: string): string {
    return this.dao.getCurrentProviderId(appType) ?? "";
  }

  add(provider: Provider, appType: string, addToLive?: boolean): boolean {
    return this.dao.add(provider, appType, addToLive);
  }

  update(provider: Provider, appType: string, originalId?: string): boolean {
    return this.dao.update(provider, appType, originalId);
  }

  delete(id: string, appType: string): boolean {
    return this.dao.delete(id, appType);
  }

  switch(id: string, appType: string): { warnings: string[] } {
    const ok = this.dao.switch(id, appType);
    if (ok) {
      this.broadcaster.emitProviderSwitched(appType, id);
    }
    return { warnings: [] };
  }

  updateSortOrder(updates: Array<{ id: string; sortIndex: number }>, appType: string): boolean {
    return this.dao.updateSortOrder(updates, appType);
  }
}
