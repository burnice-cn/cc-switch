import type { FastifyInstance } from "fastify";

/**
 * 会话管理路由 — 占位实现
 * 完整实现需要读取各 CLI 工具的会话文件
 */
export function registerSessionRoutes(app: FastifyInstance) {
  app.get("/api/sessions", async () => {
    // Phase 2: 并行扫描各应用会话
    return [];
  });

  app.get("/api/sessions/messages", async () => {
    return [];
  });

  app.delete("/api/sessions", async () => {
    return true;
  });
}
