/**
 * 请求转发器 — 对应 Rust 端 proxy/forwarder.rs
 * 使用 undici 发送 HTTP 请求到上游
 */
import { request } from "undici";

export interface ForwardRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | Buffer | undefined;
  timeoutMs?: number;
}

export interface UpstreamResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: NodeJS.ReadableStream;
}

export class Forwarder {
  async forward(req: ForwardRequest): Promise<UpstreamResponse> {
    const response = await request(req.url, {
      method: req.method as any,
      headers: req.headers,
      body: req.body,
      headersTimeout: req.timeoutMs ?? 60000,
      bodyTimeout: req.timeoutMs ?? 300000,
    });

    // 收集响应头
    const headers: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(response.headers)) {
      headers[key] = Array.isArray(value) ? value : value ?? undefined;
    }

    return {
      statusCode: response.statusCode,
      headers,
      body: response.body as unknown as NodeJS.ReadableStream,
    };
  }
}
