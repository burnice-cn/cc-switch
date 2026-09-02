import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { getSettingsPath } from "../config/paths.js";

/**
 * Settings 服务 — 对应 Rust 端 settings.rs
 *
 * 设置存储在 ~/.cc-switch/settings.json
 */

const DEFAULT_SETTINGS: Record<string, unknown> = {
  showInTray: true,
  minimizeToTrayOnClose: true,
  useAppWindowControls: false,
  enableClaudePluginIntegration: false,
  skipClaudeOnboarding: false,
  launchOnStartup: false,
  silentStartup: false,
  enableLocalProxy: false,
  sessionAutoSyncEnabled: true,
  enableFailoverToggle: false,
  showProfileSwitcher: true,
  skillSyncMethod: "auto",
  skillStorageLocation: "cc_switch",
};

export type AppSettings = typeof DEFAULT_SETTINGS & Record<string, unknown>;

/** 递归解包历史嵌套的 { settings: { settings: { ... } } } 结构 */
function unwrapNested(raw: unknown): Record<string, unknown> {
  let result = raw as Record<string, unknown>;

  // 纯嵌套 { settings: { settings: { ... } } }（仅一个 key）
  while (
    result &&
    typeof result === "object" &&
    "settings" in result &&
    typeof result.settings === "object" &&
    Object.keys(result).length === 1
  ) {
    result = result.settings as Record<string, unknown>;
  }

  // 混合结构 { ...fields, settings: { ...fields } }
  // 内层字段可能是最新值 → 先取内层，再用外层覆盖（外层是最新写入的）
  if (result && typeof result === "object" && "settings" in result && typeof result.settings === "object") {
    const inner = unwrapNested(result.settings) as Record<string, unknown>;
    const { settings: _, ...outer } = result;
    result = { ...inner, ...outer };
  }

  return result;
}

/** 读取设置（对应 get_settings_for_frontend） */
export function getSettings(): AppSettings {
  const path = getSettingsPath();
  try {
    if (!existsSync(path)) return { ...DEFAULT_SETTINGS } as AppSettings;
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    // 解包历史嵌套 + 合并默认值（外层优先于内层）
    const flat = unwrapNested(parsed);
    return { ...DEFAULT_SETTINGS, ...flat } as AppSettings;
  } catch {
    return { ...DEFAULT_SETTINGS } as AppSettings;
  }
}

/** 保存设置（对应 update_settings） */
export function saveSettings(settings: AppSettings): boolean {
  const path = getSettingsPath();
  try {
    // 先解包（防止保存嵌套结构）
    const flat = unwrapNested(settings) as AppSettings;
    mkdirSync(dirname(path), { recursive: true });
    // 原子写入
    const tmp = path + ".tmp";
    writeFileSync(tmp, JSON.stringify(flat, null, 2), { mode: 0o600 });
    renameSync(tmp, path);
    return true;
  } catch (err) {
    console.error("保存设置失败:", err);
    return false;
  }
}
