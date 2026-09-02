import type { FastifyInstance } from "fastify";

/**
 * 会话管理兼容路由。
 * Web 后端当前不解析本机会话文件，返回空集合；删除类操作返回未删除。
 */
export function registerSessionRoutes(app: FastifyInstance) {
  app.get("/api/sessions", async () => []);

  app.get("/api/sessions/messages", async () => []);

  app.delete("/api/sessions", async (req) => {
    const { sourcePath } = req.query as { sourcePath?: string };
    return {
      providerId: "",
      sessionId: "",
      sourcePath: sourcePath ?? "",
      success: false,
      error: "Web 版后端不删除本机会话",
    };
  });

  app.post("/api/sessions/delete", async (req) => {
    const { items } = req.body as { items?: any[] };
    return (items ?? []).map((item) => ({
      providerId: item?.providerId ?? "",
      sessionId: item?.sessionId ?? "",
      sourcePath: item?.sourcePath ?? "",
      success: false,
      error: "Web 版后端不删除本机会话",
    }));
  });
}
