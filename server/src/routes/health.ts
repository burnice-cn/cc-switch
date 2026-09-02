import type { FastifyInstance } from "fastify";
import { homedir } from "node:os";

const APP_VERSION = "3.20.1";

/** 健康检查 + 版本 + 主目录 + 单实例探测端点 */
export function registerHealthRoute(app: FastifyInstance) {
  app.get("/api/health", async (_req, reply) => {
    return reply.send({
      status: "healthy",
      version: APP_VERSION,
      timestamp: new Date().toISOString(),
    });
  });

  // GET /api/init-error → get_init_error
  app.get("/api/init-error", async (_req, reply) => {
    return reply.send(null);
  });

  // GET /api/app-version → get_app_version
  app.get("/api/app-version", async (_req, reply) => {
    return reply.send(APP_VERSION);
  });

  // GET /api/home-dir → get_home_dir
  app.get("/api/home-dir", async (_req, reply) => {
    return reply.send(homedir());
  });
}
