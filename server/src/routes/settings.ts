import { join } from "node:path";
import { homedir } from "node:os";
import type { FastifyInstance } from "fastify";
import { getSettings, saveSettings, type AppSettings } from "../services/settings-service.js";
import type { AppDatabase } from "../db/database.js";

/** 设置相关 REST 路由 — 对应 Tauri commands/settings.rs */
export function registerSettingsRoutes(app: FastifyInstance, db: AppDatabase) {
  // GET /api/settings → get_settings
  app.get("/api/settings", async (_req, reply) => {
    const settings = getSettings();
    return reply.send(settings);
  });

  // PUT /api/settings → save_settings
  app.put("/api/settings", async (req, reply) => {
    const body = req.body as Record<string, unknown>;

    // 兼容两种格式：
    // 1. invoke("save_settings", { settings: {...} }) → { settings: {...} }
    // 2. 直接 PUT flat settings 对象
    const rawSettings = body.settings ?? body;
    const settings = (typeof rawSettings === "object" && rawSettings && "settings" in (rawSettings as Record<string, unknown>)
      ? (rawSettings as Record<string, unknown>).settings
      : rawSettings) as AppSettings;

    // 递归解包（防御历史嵌套数据）
    let result = settings;
    while (
      result &&
      typeof result === "object" &&
      "settings" in result &&
      typeof (result as any).settings === "object" &&
      Object.keys(result).length === 1
    ) {
      result = (result as any).settings as AppSettings;
    }

    const ok = saveSettings(result);
    return reply.send(ok);
  });

  // 兼容桌面版目录读取接口
  app.get("/api/settings/config-dir", async (req) => {
    const { app } = req.query as { app?: string };
    const defaults: Record<string, string> = {
      claude: join(homedir(), ".claude"),
      codex: join(homedir(), ".codex"),
      gemini: join(homedir(), ".gemini"),
      grokbuild: join(homedir(), ".grokbuild"),
      opencode: join(homedir(), ".config/opencode"),
    };
    return app ? defaults[app] ?? join(homedir(), ".cc-switch") : join(homedir(), ".cc-switch");
  });

  app.get("/api/settings/app-config-path", async () => {
    return db.get<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'app_config_dir'",
    )?.value ?? join(homedir(), ".cc-switch");
  });

  app.get("/api/settings/claude-code-config-path", async () =>
    join(homedir(), ".claude", "settings.json"),
  );

  app.get("/api/settings/portable", async () => false);
  app.get("/api/settings/app-config-dir-override", async () => null);
  app.put("/api/settings/app-config-dir-override", async () => true);

  const settingGroups = {
    rectifier: {
      enabled: false,
      requestThinkingSignature: true,
      requestThinkingBudget: true,
      requestMediaFallback: true,
      requestMediaHeuristic: true,
    },
    optimizer: { enabled: false, thinkingOptimizer: true, cacheInjection: true },
    log: { enabled: true, level: "info" },
  } as const;

  for (const [name, fallback] of Object.entries(settingGroups)) {
    const key = `route_${name}_config`;
    app.get(`/api/settings/${name}`, async () => {
      const raw = db.get<{ value: string }>(
        "SELECT value FROM settings WHERE key = ?",
        key,
      )?.value;
      if (!raw) return fallback;
      try {
        return { ...fallback, ...JSON.parse(raw) };
      } catch {
        return fallback;
      }
    });
    app.put(`/api/settings/${name}`, async (req) => {
      db.run(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        key,
        JSON.stringify(req.body ?? {}),
      );
      return true;
    });
  }
}
