import { join, resolve } from "node:path";
import { homedir } from "node:os";

/**
 * 后端启动配置。跨机器部署时通过环境变量覆盖监听地址和数据目录。
 */
export interface ServerEnv {
  host: string;
  port: number;
  appConfigDir: string;
  dbPath: string;
  settingsPath: string;
  staticDir: string;
}

export function getServerEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  const host = env.CC_SWITCH_HOST?.trim() || "0.0.0.0";
  const port = Number.parseInt(env.CC_SWITCH_PORT?.trim() || "37800", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid CC_SWITCH_PORT: ${env.CC_SWITCH_PORT}`);
  }

  const explicitConfigDir = env.CC_SWITCH_CONFIG_DIR?.trim();
  const appConfigDir = resolve(explicitConfigDir || join(homedir(), ".cc-switch"));

  return {
    host,
    port,
    appConfigDir,
    dbPath: resolve(env.CC_SWITCH_DB_PATH?.trim() || join(appConfigDir, "cc-switch.db")),
    settingsPath: resolve(
      env.CC_SWITCH_SETTINGS_PATH?.trim() || join(appConfigDir, "settings.json"),
    ),
    staticDir: resolve(env.CC_SWITCH_STATIC_DIR?.trim() || join(process.cwd(), "../front-end/dist")),
  };
}
