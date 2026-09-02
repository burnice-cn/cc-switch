/**
 * 供应商路由器 — 对应 Rust 端 proxy/provider_router.rs
 */
import type { AppDatabase } from "../db/database.js";
import type { Provider } from "../db/dao/providers-dao.js";
import { CircuitBreaker, type CircuitBreakerConfig } from "./circuit-breaker.js";

export class ProviderRouter {
  private circuitBreakers = new Map<string, CircuitBreaker>();

  constructor(private db: AppDatabase) {}

  /** 获取指定 app+provider 的熔断器 */
  getBreaker(appType: string, providerId: string): CircuitBreaker {
    const key = `${appType}:${providerId}`;
    let breaker = this.circuitBreakers.get(key);
    if (!breaker) {
      // 从 proxy_config 读取配置
      const config = this.db.get<{
        circuit_failure_threshold: number;
        circuit_success_threshold: number;
        circuit_timeout_seconds: number;
        circuit_error_rate_threshold: number;
        circuit_min_requests: number;
      }>("SELECT * FROM proxy_config WHERE app_type = ?", appType);

      breaker = new CircuitBreaker(config ? {
        failureThreshold: config.circuit_failure_threshold,
        successThreshold: config.circuit_success_threshold,
        timeoutSeconds: config.circuit_timeout_seconds,
        errorRateThreshold: config.circuit_error_rate_threshold,
        minRequests: config.circuit_min_requests,
      } : undefined);
      this.circuitBreakers.set(key, breaker);
    }
    return breaker;
  }

  /** 选择可用供应商列表（故障转移队列或当前供应商） */
  selectProviders(appType: string): Provider[] {
    const failoverQueue = this.db.all<{
      id: string; name: string; settings_config: string;
      website_url: string | null; category: string | null;
    }>(
      "SELECT * FROM providers WHERE app_type = ? AND in_failover_queue = 1 ORDER BY sort_index, created_at",
      appType,
    );

    if (failoverQueue.length === 0) {
      // 无故障转移队列 → 返回当前供应商
      const current = this.db.get<{ id: string; name: string; settings_config: string; website_url: string | null; category: string | null }>(
        "SELECT * FROM providers WHERE app_type = ? AND is_current = 1 LIMIT 1",
        appType,
      );
      if (!current) return [];
      return [this.mapProvider(current)];
    }

    // 故障转移队列 → 按优先级返回
    return failoverQueue.map((r) => this.mapProvider(r));
  }

  private mapProvider(row: { id: string; name: string; settings_config: string; website_url: string | null; category: string | null }): Provider {
    return {
      id: row.id,
      name: row.name,
      settingsConfig: JSON.parse(row.settings_config ?? "{}"),
      websiteUrl: row.website_url ?? undefined,
      category: row.category ?? undefined,
    };
  }
}
