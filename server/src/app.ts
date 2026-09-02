import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebSocket from "@fastify/websocket";
import { getServerEnv } from "./config/env.js";
import { EventBroadcaster } from "./ws/broadcaster.js";
import { ProxyServer } from "./proxy/proxy-server.js";
import type { AppDatabase } from "./db/database.js";
import { ProviderService } from "./services/provider-service.js";
import {
  registerHealthRoute,
  registerSettingsRoutes,
  registerProviderRoutes,
  registerMcpRoutes,
  registerPromptRoutes,
  registerSkillRoutes,
  registerUsageRoutes,
  registerSessionRoutes,
  registerProxyRoutes,
  registerTrayRoutes,
} from "./routes/index.js";

export async function createApp(db?: AppDatabase): Promise<{
  app: FastifyInstance;
  broadcaster: EventBroadcaster;
  database: AppDatabase;
  proxyServer: ProxyServer;
}> {
  if (!db) {
    throw new Error("createApp requires an initialized AppDatabase");
  }
  const database = db;
  const env = getServerEnv();
  const app = Fastify({ logger: false });

  // ── CORS ──
  app.addHook("onRequest", async (_req, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (_req.method === "OPTIONS") {
      reply.code(204).send();
    }
  });

  // ── WebSocket ──
  await app.register(fastifyWebSocket);
  const broadcaster = new EventBroadcaster(app);

  // ── 静态资源（前端 dist/）──
  const distDir = env.staticDir;
  await app.register(fastifyStatic, {
    root: distDir,
    prefix: "/",
    decorateReply: true,
  });

  // ── 服务层 ──
  const providerService = new ProviderService(database, broadcaster);

  // ── 代理网关 ──
  const proxyServer = new ProxyServer(database, broadcaster);

  // ── REST API 路由 ──
  registerHealthRoute(app);
  registerSettingsRoutes(app);
  registerProviderRoutes(app, providerService);
  registerMcpRoutes(app, database);
  registerPromptRoutes(app, database);
  registerSkillRoutes(app, database);
  registerUsageRoutes(app, database);
  registerSessionRoutes(app);
  registerProxyRoutes(app, database, broadcaster, proxyServer);
  registerTrayRoutes(app);

  return { app, broadcaster, database, proxyServer };
}
