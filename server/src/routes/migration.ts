import type { FastifyInstance } from "fastify";

/**
 * 桌面版启动迁移在 Web 后端中不再执行。
 * 保留兼容端点，前端启动检查可以安全地得到“无迁移结果”。
 */
export function registerMigrationRoutes(app: FastifyInstance) {
  app.get("/api/migration-result", async () => false);
  app.get("/api/skills-migration-result", async () => null);
}
