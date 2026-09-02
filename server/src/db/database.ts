/**
 * SQLite 数据库 — 对应 Rust 端 database/mod.rs
 *
 * Schema 版本 18，与 Rust 端 schema.rs 保持完全一致。
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getDbPath } from "../config/paths.js";

export const SCHEMA_VERSION = 18;

export type SqliteDb = Database.Database;

export class AppDatabase {
  readonly db: SqliteDb;

  constructor(dbPath?: string) {
    const path = dbPath ?? getDbPath();
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  init(): void {
    this.createTables();
    this.migrateSchema();
  }

  // ── 表创建（与 Rust schema.rs create_tables_on_conn 一致）──

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT NOT NULL,
        app_type TEXT NOT NULL,
        name TEXT NOT NULL,
        settings_config TEXT NOT NULL,
        website_url TEXT,
        category TEXT,
        created_at INTEGER,
        sort_index INTEGER,
        notes TEXT,
        icon TEXT,
        icon_color TEXT,
        meta TEXT NOT NULL DEFAULT '{}',
        is_current BOOLEAN NOT NULL DEFAULT 0,
        in_failover_queue BOOLEAN NOT NULL DEFAULT 0,
        PRIMARY KEY (id, app_type)
      );

      CREATE TABLE IF NOT EXISTS provider_endpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id TEXT NOT NULL,
        app_type TEXT NOT NULL,
        url TEXT NOT NULL,
        added_at INTEGER,
        FOREIGN KEY (provider_id, app_type) REFERENCES providers(id, app_type) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        server_config TEXT NOT NULL,
        description TEXT,
        homepage TEXT,
        docs TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        enabled_claude BOOLEAN NOT NULL DEFAULT 0,
        enabled_codex BOOLEAN NOT NULL DEFAULT 0,
        enabled_gemini BOOLEAN NOT NULL DEFAULT 0,
        enabled_grokbuild BOOLEAN NOT NULL DEFAULT 0,
        enabled_opencode BOOLEAN NOT NULL DEFAULT 0,
        enabled_hermes BOOLEAN NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS prompts (
        id TEXT NOT NULL,
        app_type TEXT NOT NULL,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        description TEXT,
        enabled BOOLEAN NOT NULL DEFAULT 1,
        created_at INTEGER,
        updated_at INTEGER,
        PRIMARY KEY (id, app_type)
      );

      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        directory TEXT NOT NULL,
        repo_owner TEXT,
        repo_name TEXT,
        repo_branch TEXT DEFAULT 'main',
        readme_url TEXT,
        enabled_claude BOOLEAN NOT NULL DEFAULT 0,
        enabled_codex BOOLEAN NOT NULL DEFAULT 0,
        enabled_gemini BOOLEAN NOT NULL DEFAULT 0,
        enabled_grokbuild BOOLEAN NOT NULL DEFAULT 0,
        enabled_opencode BOOLEAN NOT NULL DEFAULT 0,
        enabled_hermes BOOLEAN NOT NULL DEFAULT 0,
        installed_at INTEGER NOT NULL DEFAULT 0,
        content_hash TEXT,
        updated_at INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS skill_repos (
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        branch TEXT NOT NULL DEFAULT 'main',
        enabled BOOLEAN NOT NULL DEFAULT 1,
        PRIMARY KEY (owner, name)
      );

      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

      CREATE TABLE IF NOT EXISTS proxy_config (
        app_type TEXT PRIMARY KEY CHECK (app_type IN ('claude','codex','gemini','grokbuild')),
        proxy_enabled INTEGER NOT NULL DEFAULT 0,
        listen_address TEXT NOT NULL DEFAULT '127.0.0.1',
        listen_port INTEGER NOT NULL DEFAULT 15721,
        enable_logging INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 0,
        auto_failover_enabled INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        streaming_first_byte_timeout INTEGER NOT NULL DEFAULT 60,
        streaming_idle_timeout INTEGER NOT NULL DEFAULT 120,
        non_streaming_timeout INTEGER NOT NULL DEFAULT 600,
        circuit_failure_threshold INTEGER NOT NULL DEFAULT 4,
        circuit_success_threshold INTEGER NOT NULL DEFAULT 2,
        circuit_timeout_seconds INTEGER NOT NULL DEFAULT 60,
        circuit_error_rate_threshold REAL NOT NULL DEFAULT 0.6,
        circuit_min_requests INTEGER NOT NULL DEFAULT 10,
        default_cost_multiplier TEXT NOT NULL DEFAULT '1',
        pricing_model_source TEXT NOT NULL DEFAULT 'response',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        live_takeover_active INTEGER NOT NULL DEFAULT 0
      );

      INSERT OR IGNORE INTO proxy_config (app_type, max_retries,
        streaming_first_byte_timeout, streaming_idle_timeout, non_streaming_timeout,
        circuit_failure_threshold, circuit_success_threshold, circuit_timeout_seconds,
        circuit_error_rate_threshold, circuit_min_requests)
      VALUES ('claude', 6, 90, 180, 600, 8, 3, 90, 0.7, 15);

      INSERT OR IGNORE INTO proxy_config (app_type, max_retries,
        streaming_first_byte_timeout, streaming_idle_timeout, non_streaming_timeout,
        circuit_failure_threshold, circuit_success_threshold, circuit_timeout_seconds,
        circuit_error_rate_threshold, circuit_min_requests)
      VALUES ('codex', 3, 60, 120, 600, 4, 2, 60, 0.6, 10);

      INSERT OR IGNORE INTO proxy_config (app_type, max_retries,
        streaming_first_byte_timeout, streaming_idle_timeout, non_streaming_timeout,
        circuit_failure_threshold, circuit_success_threshold, circuit_timeout_seconds,
        circuit_error_rate_threshold, circuit_min_requests)
      VALUES ('gemini', 5, 60, 120, 600, 4, 2, 60, 0.6, 10);

      INSERT OR IGNORE INTO proxy_config (app_type, max_retries,
        streaming_first_byte_timeout, streaming_idle_timeout, non_streaming_timeout,
        circuit_failure_threshold, circuit_success_threshold, circuit_timeout_seconds,
        circuit_error_rate_threshold, circuit_min_requests)
      VALUES ('grokbuild', 3, 60, 120, 600, 4, 2, 60, 0.6, 10);

      CREATE TABLE IF NOT EXISTS provider_health (
        provider_id TEXT NOT NULL,
        app_type TEXT NOT NULL,
        is_healthy INTEGER NOT NULL DEFAULT 1,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_success_at TEXT,
        last_failure_at TEXT,
        last_error TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider_id, app_type),
        FOREIGN KEY (provider_id, app_type) REFERENCES providers(id, app_type) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS proxy_request_logs (
        request_id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        app_type TEXT NOT NULL,
        model TEXT NOT NULL,
        request_model TEXT,
        pricing_model TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        input_token_semantics INTEGER NOT NULL DEFAULT 0,
        input_cost_usd TEXT NOT NULL DEFAULT '0',
        output_cost_usd TEXT NOT NULL DEFAULT '0',
        cache_read_cost_usd TEXT NOT NULL DEFAULT '0',
        cache_creation_cost_usd TEXT NOT NULL DEFAULT '0',
        total_cost_usd TEXT NOT NULL DEFAULT '0',
        latency_ms INTEGER NOT NULL,
        first_token_ms INTEGER,
        duration_ms INTEGER,
        status_code INTEGER NOT NULL,
        error_message TEXT,
        session_id TEXT,
        provider_type TEXT,
        is_streaming INTEGER NOT NULL DEFAULT 0,
        cost_multiplier TEXT NOT NULL DEFAULT '1.0',
        created_at INTEGER NOT NULL,
        data_source TEXT NOT NULL DEFAULT 'proxy'
      );

      CREATE INDEX IF NOT EXISTS idx_request_logs_provider ON proxy_request_logs(provider_id, app_type);
      CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON proxy_request_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_request_logs_model ON proxy_request_logs(model);
      CREATE INDEX IF NOT EXISTS idx_request_logs_session ON proxy_request_logs(session_id);
      CREATE INDEX IF NOT EXISTS idx_request_logs_status ON proxy_request_logs(status_code);

      CREATE TABLE IF NOT EXISTS model_pricing (
        model_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        input_cost_per_million TEXT NOT NULL,
        output_cost_per_million TEXT NOT NULL,
        cache_read_cost_per_million TEXT NOT NULL DEFAULT '0',
        cache_creation_cost_per_million TEXT NOT NULL DEFAULT '0'
      );

      CREATE TABLE IF NOT EXISTS stream_check_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id TEXT NOT NULL,
        provider_name TEXT NOT NULL,
        app_type TEXT NOT NULL,
        status TEXT NOT NULL,
        success INTEGER NOT NULL,
        message TEXT NOT NULL,
        response_time_ms INTEGER,
        http_status INTEGER,
        model_used TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS proxy_live_backup (
        app_type TEXT PRIMARY KEY,
        original_config TEXT NOT NULL,
        backed_up_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usage_daily_rollups (
        date TEXT NOT NULL,
        app_type TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL,
        request_model TEXT NOT NULL DEFAULT '',
        pricing_model TEXT NOT NULL DEFAULT '',
        request_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        input_token_semantics INTEGER NOT NULL DEFAULT 0,
        total_cost_usd TEXT NOT NULL DEFAULT '0',
        avg_latency_ms INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (date, app_type, provider_id, model, request_model, pricing_model)
      );

      CREATE TABLE IF NOT EXISTS session_log_sync (
        file_path TEXT PRIMARY KEY,
        last_modified INTEGER NOT NULL,
        last_line_offset INTEGER NOT NULL DEFAULT 0,
        last_synced_at INTEGER NOT NULL,
        last_byte_offset INTEGER,
        last_tail_fingerprint INTEGER
      );

      CREATE TABLE IF NOT EXISTS session_usage_dedup (
        data_source TEXT NOT NULL,
        request_id TEXT NOT NULL,
        semantic_id TEXT NOT NULL,
        has_entry_id INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (data_source, request_id)
      );

      CREATE INDEX IF NOT EXISTS idx_session_usage_dedup_semantic
        ON session_usage_dedup(data_source, semantic_id, has_entry_id);

      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        payload TEXT NOT NULL,
        sort_order INTEGER,
        created_at INTEGER,
        updated_at INTEGER
      );
    `);
  }

  // ── Schema 版本迁移 ──

  private migrateSchema(): void {
    const version = this.db.pragma("user_version", { simple: true }) as number;

    if (version > SCHEMA_VERSION) {
      throw new Error(
        `数据库版本过新 (v${version})，当前应用仅支持 ${SCHEMA_VERSION}，请升级应用。`,
      );
    }

    // 当前 SCHEMA_VERSION 的初始版本就是 18
    // （Phase 1 直接创建最终 schema，不需要增量迁移）
    if (version < SCHEMA_VERSION) {
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    }
  }

  // ── 通用查询方法 ──

  get<K = unknown>(sql: string, ...params: unknown[]): K | undefined {
    return this.db.prepare(sql).get(...params) as K | undefined;
  }

  all<K = unknown>(sql: string, ...params: unknown[]): K[] {
    return this.db.prepare(sql).all(...params) as K[];
  }

  run(sql: string, ...params: unknown[]): Database.RunResult {
    return this.db.prepare(sql).run(...params);
  }
}

