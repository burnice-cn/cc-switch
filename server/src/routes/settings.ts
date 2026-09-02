import type { FastifyInstance } from "fastify";
import { getSettings, saveSettings, type AppSettings } from "../services/settings-service.js";

/** 设置相关 REST 路由 — 对应 Tauri commands/settings.rs */
export function registerSettingsRoutes(app: FastifyInstance) {
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
    const settings = (body.settings ?? body) as AppSettings;

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
}
