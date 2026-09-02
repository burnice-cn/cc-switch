import type { FastifyInstance } from "fastify";

/**
 * 兼容旧前端 IPC 调用。Web 版没有系统托盘，
 * 这里返回 false 表示“没有可更新的托盘”，避免旧调用 404。
 */
export function registerTrayRoutes(app: FastifyInstance) {
  app.post("/api/tray/update", async (_req, reply) => {
    return reply.send(false);
  });
}
