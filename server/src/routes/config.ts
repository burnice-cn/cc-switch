import type { FastifyInstance } from "fastify";
import type { AppDatabase } from "../db/database.js";
import {
  extractCommonConfig,
  getConfigSnippet,
  saveCommonConfigSnippet,
  updateTomlCommonConfigSnippet,
} from "../services/common-config-service.js";

/** 通用配置片段路由 — 对应 Tauri commands/config.rs */
export function registerConfigRoutes(app: FastifyInstance, db: AppDatabase) {
  app.get("/api/config/common", async (req, reply) => {
    const query = req.query as { app?: string; appType?: string };
    const appType = query.app ?? query.appType;
    if (!appType) {
      return reply.code(400).send({ message: "缺少应用类型 app" });
    }
    return reply.send(getConfigSnippet(db, appType));
  });

  app.put("/api/config/common", async (req, reply) => {
    const body = (req.body ?? {}) as { app?: string; appType?: string; snippet?: string };
    const appType = body.app ?? body.appType;
    const snippet = body.snippet;
    if (!appType || typeof snippet !== "string") {
      return reply.code(400).send({ message: "缺少 app 或 snippet" });
    }

    try {
      saveCommonConfigSnippet(db, appType, snippet);
      return reply.send({ ok: true });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/config/codex/toml-snippet", async (req, reply) => {
    const { configToml, snippetToml, enabled } = (req.body ?? {}) as {
      configToml?: string;
      snippetToml?: string;
      enabled?: boolean;
    };
    if (
      typeof configToml !== "string" ||
      typeof snippetToml !== "string" ||
      typeof enabled !== "boolean"
    ) {
      return reply.code(400).send({
        message: "缺少 configToml、snippetToml 或 enabled",
      });
    }

    try {
      return reply.send(
        updateTomlCommonConfigSnippet(configToml, snippetToml, enabled),
      );
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/config/common/extract", async (req, reply) => {
    const body = (req.body ?? {}) as { app?: string; appType?: string; settingsConfig?: string };
    const appType = body.app ?? body.appType;
    const settingsConfig = body.settingsConfig;
    if (!appType) {
      return reply.code(400).send({ message: "缺少应用类型 app" });
    }

    try {
      if (settingsConfig?.trim()) {
        const parsed: unknown = JSON.parse(settingsConfig);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return reply.code(400).send({ message: "settingsConfig 必须是 JSON 对象" });
        }
        return reply.send(
          extractCommonConfig(appType, parsed as Record<string, unknown>),
        );
      }

      const currentId = db.get<{ id: string }>(
        "SELECT id FROM providers WHERE app_type = ? AND is_current = 1",
        appType,
      )?.id;
      if (!currentId) {
        return reply.code(400).send({ message: "没有当前供应商" });
      }

      const row = db.get<{ settings_config: string }>(
        "SELECT settings_config FROM providers WHERE id = ? AND app_type = ?",
        currentId,
        appType,
      );
      if (!row) {
        return reply.code(404).send({ message: "当前供应商不存在" });
      }
      const settings = JSON.parse(row.settings_config) as Record<string, unknown>;
      return reply.send(extractCommonConfig(appType, settings));
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
