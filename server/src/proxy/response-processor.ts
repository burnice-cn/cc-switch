/**
 * 响应处理器 — 对应 Rust 端 proxy/response_processor.rs
 * 负责透传响应、统计 usage、记录日志
 */
import type { ServerResponse } from "node:http";
import type { UpstreamResponse } from "./forwarder.js";
import { SseParser, type SseUsage } from "./sse-parser.js";
import { UsageLogger } from "./usage-logger.js";
import type { EventBroadcaster } from "../ws/broadcaster.js";

export class ResponseProcessor {
  constructor(
    private usageLogger: UsageLogger,
    private broadcaster: EventBroadcaster,
  ) {}

  /** 处理上游响应并透传给客户端 */
  process(
    upstream: UpstreamResponse,
    res: ServerResponse,
    context: {
      providerId: string;
      appType: string;
      model: string;
      sessionId?: string;
      startTime: number;
    },
  ): void {
    const isStreaming = (upstream.headers["content-type"] as string)?.includes("text/event-stream") ?? false;

    // 设置响应头
    res.writeHead(upstream.statusCode, upstream.headers);

    if (!isStreaming) {
      // 非流式：收集 body 再透传
      const chunks: Buffer[] = [];
      upstream.body.on("data", (chunk: Buffer) => chunks.push(chunk));
      upstream.body.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        res.end(body);
        this.recordUsage(body, context, isStreaming);
      });
      upstream.body.on("error", () => res.end());
    } else {
      // 流式：透传 + 监听 usage
      let usageData: SseUsage | null = null;
      let buffer = "";

      upstream.body.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf-8");
        res.write(chunk);

        // 尝试从最新 SSE 块中提取 usage
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const event = SseParser.parseBlock(block);
          if (event) {
            const usage = SseParser.extractUsage(event.data);
            if (usage) usageData = usage;
          }
        }
      });

      upstream.body.on("end", () => {
        res.end();
        const latencyMs = Date.now() - context.startTime;
        this.broadcaster.emitUsageLogRecorded();
      });

      upstream.body.on("error", () => res.end());
    }
  }

  private recordUsage(
    body: string,
    context: { providerId: string; appType: string; model: string; sessionId?: string; startTime: number },
    isStreaming: boolean,
  ): void {
    const usage = SseParser.extractUsage(body);
    const latencyMs = Date.now() - context.startTime;

    void this.usageLogger.log({
      providerId: context.providerId,
      appType: context.appType,
      model: context.model,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      cacheReadTokens: usage?.cacheReadTokens ?? 0,
      cacheCreationTokens: usage?.cacheCreationTokens ?? 0,
      inputCostUsd: "0",
      outputCostUsd: "0",
      totalCostUsd: "0",
      latencyMs,
      statusCode: 200,
      sessionId: context.sessionId,
      isStreaming,
      dataSource: "proxy",
    });

    this.broadcaster.emitUsageLogRecorded();
  }
}
