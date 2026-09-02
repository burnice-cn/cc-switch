/**
 * 用量记录器 — 对应 Rust 端 proxy/usage/logger.rs
 */
import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../db/database.js";

export interface UsageRecord {
  providerId: string;
  appType: string;
  model: string;
  requestModel?: string;
  pricingModel?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  inputCostUsd: string;
  outputCostUsd: string;
  totalCostUsd: string;
  latencyMs: number;
  statusCode: number;
  errorMessage?: string;
  sessionId?: string;
  isStreaming: boolean;
  dataSource: string;
}

export class UsageLogger {
  constructor(private db: AppDatabase) {}

  async log(record: UsageRecord): Promise<void> {
    const id = randomUUID();
    this.db.run(
      `INSERT INTO proxy_request_logs
       (request_id, provider_id, app_type, model, request_model, pricing_model,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        input_token_semantics, input_cost_usd, output_cost_usd,
        cache_read_cost_usd, cache_creation_cost_usd,
        total_cost_usd, latency_ms, status_code, error_message, session_id,
        is_streaming, created_at, data_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, record.providerId, record.appType, record.model,
      record.requestModel ?? null, record.pricingModel ?? null,
      record.inputTokens, record.outputTokens,
      record.cacheReadTokens, record.cacheCreationTokens,
      0, // input_token_semantics
      record.inputCostUsd, record.outputCostUsd,
      "0", "0", // cache costs (Phase 3 Week 4)
      record.totalCostUsd,
      record.latencyMs, record.statusCode,
      record.errorMessage ?? null, record.sessionId ?? null,
      record.isStreaming ? 1 : 0,
      Date.now(), record.dataSource,
    );
  }
}
