/**
 * Provider 服务 — 对应 Rust 端 services/provider/mod.rs
 */
import type { AppDatabase } from "../db/database.js";
import { ProvidersDao, type Provider } from "../db/dao/providers-dao.js";
import { McpDao } from "../db/dao/mcp-dao.js";
import type { EventBroadcaster } from "../ws/broadcaster.js";
import { ProviderLiveService } from "./provider-live-service.js";
import { parseCodexToml } from "./common-config-service.js";
import { getSettings, saveSettings, type AppSettings } from "./settings-service.js";

export class ProviderService {
  private dao: ProvidersDao;

  private live: ProviderLiveService;

  private mcpDao: McpDao;

  constructor(private db: AppDatabase, private broadcaster: EventBroadcaster) {
    this.dao = new ProvidersDao(db);
    this.live = new ProviderLiveService(db);
    this.mcpDao = new McpDao(db);
    this.live.onMcpServersChanged = () => this.broadcaster.emitMcpServersChanged();
  }

  getAll(appType: string): Record<string, Provider> {
    return this.dao.getAll(appType);
  }

  getCurrentProviderId(appType: string): string {
    const settings = getSettings();
    const key = CURRENT_PROVIDER_KEYS[appType];
    const localId = key ? settings[key] : undefined;
    if (typeof localId === "string" && localId && this.dao.getById(localId, appType)) {
      return localId;
    }

    // A stale device-local pointer can remain after a cloud sync/import.
    // Clean it up and fall back to the database's default current provider.
    if (typeof localId === "string" && localId) {
      const next = { ...settings } as AppSettings;
      delete next[key as keyof AppSettings];
      saveSettings(next);
    }
    return this.dao.getCurrentProviderId(appType) ?? "";
  }

  add(provider: Provider, appType: string, addToLive?: boolean): boolean {
    const added = this.dao.add(provider, appType, addToLive);
    if (added) this.registerSnapshotMcpServers(appType, provider);
    return added;
  }

  update(provider: Provider, appType: string, originalId?: string): boolean {
    const isCurrent = this.getCurrentProviderId(appType) === provider.id;

    const updated = this.dao.update(provider, appType, originalId);
    if (!updated) return false;
    this.registerSnapshotMcpServers(appType, provider);

    // 编辑当前供应商后立即把变更投影到 live 配置。Codex 的
    // model_catalog_json（含逐模型思考等级）只在 live 写入时生成，
    // 若只更新数据库，保存“供应商-模型映射-思考等级”后对应配置文件不会刷新。
    if (isCurrent && isLiveSwitchApp(appType) && !this.isLiveTakenOver(appType)) {
      const effective = this.live.applyCommonConfig(appType, provider);
      this.live.write(appType, effective);
    }

    return updated;
  }

  delete(id: string, appType: string): boolean {
    return this.dao.delete(id, appType);
  }

  switch(id: string, appType: string): { warnings: string[] } {
    const provider = this.dao.getById(id, appType);
    if (!provider) throw new Error(`供应商 ${id} 不存在`);

    const takenOver = this.isLiveTakenOver(appType);

    if (isLiveSwitchApp(appType) && !takenOver) {
      // Apply common config and validate the projection before moving current.
      const effective = this.live.applyCommonConfig(appType, provider);
      this.live.write(appType, effective);
    }

    this.registerSnapshotMcpServers(appType, provider);
    if (!this.dao.switch(id, appType)) throw new Error("切换供应商失败");
    this.live.setCurrentProvider(appType, id);
    this.broadcaster.emitProviderSwitched(appType, id);
    return { warnings: [] };
  }

  /**
   * Adopt MCP entries found in provider TOML snapshots into the unified MCP
   * registry. Registry entries remain authoritative on the next projection.
   */
  private registerSnapshotMcpServers(appType: string, provider: Provider): void {
    if (appType !== "codex") return;
    const config = provider.settingsConfig?.config;
    if (typeof config !== "string" || !config.trim()) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = parseCodexToml(config);
    } catch {
      return;
    }
    const snapshotServers = parsed.mcp_servers;
    if (!snapshotServers || typeof snapshotServers !== "object" || Array.isArray(snapshotServers)) {
      return;
    }

    const registeredIds = new Set(
      this.mcpDao.getAll().map((server) => server.id),
    );
    let registered = false;
    for (const [id, value] of Object.entries(snapshotServers)) {
      if (!id.trim() || !value || typeof value !== "object" || Array.isArray(value)) continue;
      if (registeredIds.has(id)) continue;

      this.mcpDao.upsertDiscovered({
        id,
        name: id,
        serverConfig: value as Record<string, unknown>,
        enabledApps: { codex: true },
      });
      registeredIds.add(id);
      registered = true;
    }
    if (registered) {
      this.broadcaster.emitMcpServersChanged();
    }
  }

  private isLiveTakenOver(appType: string): boolean {
    return this.db.get<{ live_takeover_active: number }>(
      "SELECT live_takeover_active FROM proxy_config WHERE app_type = ?",
      appType,
    )?.live_takeover_active === 1;
  }

  updateSortOrder(updates: Array<{ id: string; sortIndex: number }>, appType: string): boolean {
    return this.dao.updateSortOrder(updates, appType);
  }
}

const LIVE_SWITCH_APPS = new Set(["claude", "codex", "gemini", "grokbuild"]);
const CURRENT_PROVIDER_KEYS: Record<string, string> = {
  claude: "currentProviderClaude",
  "claude-desktop": "currentProviderClaudeDesktop",
  codex: "currentProviderCodex",
  gemini: "currentProviderGemini",
  grokbuild: "currentProviderGrokbuild",
  opencode: "currentProviderOpencode",
  openclaw: "currentProviderOpenclaw",
  hermes: "currentProviderHermes",
};

function isLiveSwitchApp(appType: string): boolean {
  return LIVE_SWITCH_APPS.has(appType);
}
