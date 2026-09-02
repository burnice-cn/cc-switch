/**
 * HTTP 代理服务器 — 对应 Rust 端 proxy/server.rs + handlers.rs
 *
 * 基于 Node http 模块，支持：
 * - 多供应商路由
 * - 熔断器
 * - SSE 流式透传
 * - 用量记录
 */
import http from "node:http";
import type { AppDatabase } from "../db/database.js";
import type { EventBroadcaster } from "../ws/broadcaster.js";
import { ProviderRouter } from "./provider-router.js";
import { Forwarder, type ForwardRequest } from "./forwarder.js";
import { extractSessionId } from "./session.js";
import { UsageLogger, type UsageRecord } from "./usage-logger.js";

export class ProxyServer {
  private server: http.Server;
  private router: ProviderRouter;
  private forwarder: Forwarder;
  private usageLogger: UsageLogger;

  constructor(
    private db: AppDatabase,
    private broadcaster: EventBroadcaster,
  ) {
    this.router = new ProviderRouter(db);
    this.forwarder = new Forwarder();
    this.usageLogger = new UsageLogger(db);
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        console.error("[Proxy] unhandled error:", err);
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal proxy error" }));
        }
      });
    });
  }

  async start(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(port, "127.0.0.1", () => {
        console.log(`[Proxy] listening on 127.0.0.1:${port}`);
      });
      this.server.once("listening", resolve);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  get isRunning(): boolean {
    return this.server.listening;
  }

  /** 检测请求的 app 类型（基于 URL 路径） */
  private detectAppType(url: string): string {
    if (url.includes("/v1/messages") || url.includes("/v1/complete")) return "claude";
    if (url.includes("/v1/chat/completions") || url.includes("/v1/responses")) return "codex";
    if (url.includes("/v1beta/") || url.includes("/v1beta1/")) return "gemini";
    return "claude";
  }

  /** 从供应商配置中提取 base URL 和 API key */
  private extractProviderConfig(provider: { settingsConfig: Record<string, unknown> }, appType: string): {
    baseUrl: string; apiKey: string;
  } {
    const config = provider.settingsConfig;
    let baseUrl = "";
    let apiKey = "";

    if (appType === "claude" || appType === "claude-desktop") {
      const env = (config as any).env ?? {};
      baseUrl = env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
      apiKey = env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY ?? "";
    } else if (appType === "codex") {
      baseUrl = (config as any).baseUrl ?? (config as any).api_base_url ?? "https://api.openai.com";
      apiKey = (config as any).auth ?? (config as any).openai_api_key ?? "";
    } else if (appType === "gemini") {
      baseUrl = (config as any).baseUrl ?? "https://generativelanguage.googleapis.com";
      apiKey = (config as any).apiKey ?? "";
    }

    return { baseUrl, apiKey };
  }

  /** 从请求体中提取模型名 */
  private extractModel(body: string | undefined): string {
    if (!body) return "unknown";
    try {
      const json = JSON.parse(body);
      return json.model ?? "unknown";
    } catch {
      return "unknown";
    }
  }

  /** 处理代理请求 */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const startTime = Date.now();
    const url = req.url ?? "";
    const appType = this.detectAppType(url);
    const sessionId = extractSessionId(req);

    // 读取请求体
    const body = await this.readBody(req);
    const model = this.extractModel(body);

    // 选择供应商列表
    const providers = this.router.selectProviders(appType);

    if (providers.length === 0) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { type: "no_provider", message: "No provider configured" } }));
      return;
    }

    // 逐个尝试供应商
    for (const provider of providers) {
      const breaker = this.router.getBreaker(appType, provider.id);

      if (!breaker.allow()) {
        console.log(`[Proxy] provider ${provider.id} circuit open, skipping`);
        continue;
      }

      try {
        const { baseUrl, apiKey } = this.extractProviderConfig(provider, appType);

        // 构建转发请求
        const targetUrl = `${baseUrl}${url}`;
        const headers: Record<string, string> = {};

        // 复制原始请求头（去掉 host）
        for (const [key, value] of Object.entries(req.headers)) {
          if (key === "host" || key === "connection" || key === "content-length") continue;
          if (typeof value === "string") headers[key] = value;
        }

        // 注入认证
        if (appType === "claude" || appType === "claude-desktop") {
          headers["x-api-key"] = apiKey;
          headers["authorization"] = `Bearer ${apiKey}`;
        } else if (appType === "codex") {
          headers["authorization"] = `Bearer ${apiKey}`;
        }

        const forwardReq: ForwardRequest = {
          url: targetUrl,
          method: req.method ?? "POST",
          headers,
          body: body || undefined,
          timeoutMs: 300000,
        };

        // 转发
        const upstream = await this.forwarder.forward(forwardReq);

        // 透传响应
        res.writeHead(upstream.statusCode, upstream.headers);

        if (upstream.statusCode >= 400) {
          // 上游错误 → 熔断器记录
          breaker.recordFailure();
        } else {
          breaker.recordSuccess();
        }

        // 流式透传（SSE）
        const latencyMs = Date.now() - startTime;

        // 记录用量
        const usageRecord: UsageRecord = {
          providerId: provider.id,
          appType,
          model,
          inputTokens: 0, // Phase 3 Week 4: 从响应解析
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          inputCostUsd: "0",
          outputCostUsd: "0",
          totalCostUsd: "0",
          latencyMs,
          statusCode: upstream.statusCode,
          sessionId: sessionId ?? undefined,
          isStreaming: url.includes("/stream") || url.includes("stream=true"),
          dataSource: "proxy",
        };
        this.usageLogger.log(usageRecord).catch(console.error);

        // 透传流式响应
        upstream.body.pipe(res);
        return;

      } catch (err) {
        breaker.recordFailure();
        console.error(`[Proxy] provider ${provider.id} failed:`, err);
        continue;
      }
    }

    // 所有供应商都失败
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { type: "all_providers_failed", message: "All providers failed" } }));
  }

  /** 读取请求体 */
  private readBody(req: http.IncomingMessage): Promise<string | undefined> {
    return new Promise((resolve) => {
      if (req.method === "GET" || req.method === "DELETE") {
        resolve(undefined);
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        resolve(body || undefined);
      });
      req.on("error", () => resolve(undefined));
    });
  }
}
