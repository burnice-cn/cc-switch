import type { FastifyInstance } from "fastify";

export function registerSystemRoutes(app: FastifyInstance) {
  app.post("/api/clipboard/copy", async (req) => {
    const { text } = (req.body ?? {}) as { text?: string };
    return { ok: typeof text === "string" };
  });

  app.post("/api/open-external", async (req) => {
    const { url } = (req.body ?? {}) as { url?: string };
    return { ok: Boolean(url) };
  });

  app.post("/api/restart", async () => ({
    ok: false,
    message: "Web 版后端不支持直接重启客户端",
  }));
}
