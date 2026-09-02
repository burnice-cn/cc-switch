/**
 * 熔断器 — 对应 Rust 端 proxy/circuit_breaker.rs
 * Node 单线程无需锁
 */

export enum CircuitState {
  Closed = "closed",
  Open = "open",
  HalfOpen = "half_open",
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeoutSeconds: number;
  errorRateThreshold: number;
  minRequests: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 4,
  successThreshold: 2,
  timeoutSeconds: 60,
  errorRateThreshold: 0.6,
  minRequests: 10,
};

export class CircuitBreaker {
  private _state = CircuitState.Closed;
  private failures = 0;
  private successes = 0;
  private totalRequests = 0;
  private totalFailures = 0;
  private openedAt = 0;
  private config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 检查是否允许请求通过 */
  allow(): boolean {
    if (this._state === CircuitState.Closed) return true;

    if (this._state === CircuitState.Open) {
      const elapsed = (Date.now() - this.openedAt) / 1000;
      if (elapsed >= this.config.timeoutSeconds) {
        this._state = CircuitState.HalfOpen;
        this.successes = 0;
        return true;
      }
      return false;
    }

    // HalfOpen
    return true;
  }

  /** 请求成功 */
  recordSuccess(): void {
    this.totalRequests++;
    this.failures = 0;

    if (this._state === CircuitState.HalfOpen) {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this._state = CircuitState.Closed;
        this.totalFailures = 0;
      }
    }
  }

  /** 请求失败 */
  recordFailure(): void {
    this.totalRequests++;
    this.totalFailures++;
    this.failures++;

    if (this._state === CircuitState.HalfOpen) {
      this.open();
      return;
    }

    if (this._state === CircuitState.Closed) {
      if (this.failures >= this.config.failureThreshold) {
        this.open();
      }
    }
  }

  private open(): void {
    this._state = CircuitState.Open;
    this.openedAt = Date.now();
  }

  get state(): CircuitState {
    return this._state;
  }

  get stats() {
    return {
      state: this._state,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      errorRate: this.totalRequests > 0
        ? this.totalFailures / this.totalRequests
        : 0,
    };
  }
}
