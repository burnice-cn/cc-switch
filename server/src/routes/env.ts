import type { FastifyInstance } from "fastify";
import {
  checkEnvConflicts,
  deleteEnvVars,
  restoreEnvBackup,
} from "../services/env-service.js";

/** 环境变量冲突检查、删除与恢复 */
export function registerEnvRoutes(app: FastifyInstance) {
  app.get("/api/env/conflicts", async (req, reply) => {
    const { app } = req.query as { app?: string };
    if (!app) {
      return reply.code(400).send({ message: "缺少应用类型 app" });
    }
    return reply.send(checkEnvConflicts(app));
  });

  app.post("/api/env/delete", async (req, reply) => {
    const { conflicts } = (req.body ?? {}) as { conflicts?: unknown };
    if (!Array.isArray(conflicts)) {
      return reply.code(400).send({ message: "缺少环境变量列表 conflicts" });
    }

    try {
      return reply.send(deleteEnvVars(conflicts as never));
    } catch (error) {
      return reply.code(500).send({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/env/restore", async (req, reply) => {
    const { backupPath } = (req.body ?? {}) as { backupPath?: string };
    if (!backupPath) {
      return reply.code(400).send({ message: "缺少备份路径 backupPath" });
    }

    try {
      restoreEnvBackup(backupPath);
      return reply.send({ ok: true });
    } catch (error) {
      return reply.code(500).send({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
