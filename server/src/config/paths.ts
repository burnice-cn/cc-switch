import { getServerEnv } from "./env.js";

const env = getServerEnv();

/** 获取应用配置目录（默认 ~/.cc-switch，可用 CC_SWITCH_CONFIG_DIR 覆盖） */
export function getAppConfigDir(): string {
  return env.appConfigDir;
}

/** 获取应用数据库路径 */
export function getDbPath(): string {
  return env.dbPath;
}

/** 获取设置文件路径 */
export function getSettingsPath(): string {
  return env.settingsPath;
}
