/**
 * IPC 兼容层 — 替代 @tauri-apps/api/core 的 invoke
 *
 * 内部通过 axios 调用 Node 后端 REST API，
 * 保持与 Tauri invoke 完全一致的签名，实现渐进式迁移。
 */
import axios from "axios";
import { buildApiUrl } from "./server";

// 命令名 → REST 路径的路由表
const commandRoutes: Record<string, { method: string; path: string }> = {
  // ── 健康检查 ──
  get_init_error: { method: "GET", path: "/init-error" },
  get_app_version: { method: "GET", path: "/app-version" },
  get_home_dir: { method: "GET", path: "/home-dir" },

  // ── 供应商 ──
  get_providers: { method: "GET", path: "/providers" },
  get_current_provider: { method: "GET", path: "/providers/current" },
  add_provider: { method: "POST", path: "/providers" },
  update_provider: { method: "PUT", path: "/providers" },
  delete_provider: { method: "DELETE", path: "/providers" },
  switch_provider: { method: "POST", path: "/providers/switch" },
  import_default_config: { method: "POST", path: "/providers/import-default" },
  update_providers_sort_order: { method: "PUT", path: "/providers/sort-order" },
  remove_provider_from_live_config: {
    method: "DELETE",
    path: "/providers/live-config",
  },

  // ── 设置 ──
  get_settings: { method: "GET", path: "/settings" },
  save_settings: { method: "PUT", path: "/settings" },
  get_config_dir: { method: "GET", path: "/settings/config-dir" },
  get_claude_code_config_path: {
    method: "GET",
    path: "/settings/claude-code-config-path",
  },
  get_app_config_path: { method: "GET", path: "/settings/app-config-path" },
  is_portable_mode: { method: "GET", path: "/settings/portable" },
  get_rectifier_config: { method: "GET", path: "/settings/rectifier" },
  set_rectifier_config: { method: "PUT", path: "/settings/rectifier" },
  get_optimizer_config: { method: "GET", path: "/settings/optimizer" },
  set_optimizer_config: { method: "PUT", path: "/settings/optimizer" },
  get_log_config: { method: "GET", path: "/settings/log" },
  set_log_config: { method: "PUT", path: "/settings/log" },

  // ── 代理 ──
  start_proxy_server: { method: "POST", path: "/proxy/start" },
  stop_proxy_server: { method: "POST", path: "/proxy/stop" },
  stop_proxy_with_restore: { method: "POST", path: "/proxy/stop-restore" },
  get_proxy_status: { method: "GET", path: "/proxy/status" },
  get_proxy_takeover_status: { method: "GET", path: "/proxy/takeover" },
  set_proxy_takeover_for_app: { method: "POST", path: "/proxy/takeover" },
  get_global_proxy_config: { method: "GET", path: "/proxy/global-config" },
  update_global_proxy_config: { method: "PUT", path: "/proxy/global-config" },
  get_proxy_config_for_app: { method: "GET", path: "/proxy/app-config" },
  update_proxy_config_for_app: { method: "PUT", path: "/proxy/app-config" },

  // ── MCP ──
  get_mcp_servers: { method: "GET", path: "/mcp" },
  add_mcp_server: { method: "POST", path: "/mcp" },
  update_mcp_server: { method: "PUT", path: "/mcp" },
  delete_mcp_server: { method: "DELETE", path: "/mcp" },

  // ── 提示词 ──
  get_prompts: { method: "GET", path: "/prompts" },
  save_prompt: { method: "POST", path: "/prompts" },
  delete_prompt: { method: "DELETE", path: "/prompts" },

  // ── 技能 ──
  get_all_installed_skills: { method: "GET", path: "/skills" },
  install_skill: { method: "POST", path: "/skills" },
  uninstall_skill: { method: "DELETE", path: "/skills" },
  toggle_skill: { method: "PUT", path: "/skills/toggle" },

  // ── 用量 ──
  get_usage_summary: { method: "GET", path: "/usage/summary" },
  get_usage_logs: { method: "GET", path: "/usage/logs" },
  get_models_dev_sync_config: {
    method: "GET",
    path: "/usage/models-dev-sync",
  },
  save_models_dev_sync_config: {
    method: "PUT",
    path: "/usage/models-dev-sync",
  },
  record_models_dev_sync_result: {
    method: "POST",
    path: "/usage/models-dev-sync/result",
  },

  // ── 会话 ──
  scan_sessions: { method: "GET", path: "/sessions" },
  get_session_messages: { method: "GET", path: "/sessions/messages" },
  delete_session: { method: "DELETE", path: "/sessions" },

  // ── 备份 ──
  create_db_backup: { method: "POST", path: "/backups" },
  list_db_backups: { method: "GET", path: "/backups" },
  restore_db_backup: { method: "POST", path: "/backups/restore" },
  delete_db_backup: { method: "DELETE", path: "/backups" },
  rename_db_backup: { method: "PUT", path: "/backups/rename" },

  get_common_config_snippet: { method: "GET", path: "/config/common" },
  set_common_config_snippet: { method: "PUT", path: "/config/common" },
  update_toml_common_config_snippet: {
    method: "POST",
    path: "/config/codex/toml-snippet",
  },
  extract_common_config_snippet: {
    method: "POST",
    path: "/config/common/extract",
  },

  // ── 环境变量与迁移兼容 ──
  check_env_conflicts: { method: "GET", path: "/env/conflicts" },
  delete_env_vars: { method: "POST", path: "/env/delete" },
  restore_env_backup: { method: "POST", path: "/env/restore" },
  get_migration_result: { method: "GET", path: "/migration-result" },
  get_skills_migration_result: {
    method: "GET",
    path: "/skills-migration-result",
  },

  // ── 故障转移 ──
  get_provider_health: { method: "GET", path: "/failover/provider-health" },
  reset_circuit_breaker: { method: "POST", path: "/failover/reset-circuit-breaker" },
  get_circuit_breaker_config: { method: "GET", path: "/failover/circuit-breaker-config" },
  update_circuit_breaker_config: { method: "PUT", path: "/failover/circuit-breaker-config" },
  get_circuit_breaker_stats: { method: "GET", path: "/failover/circuit-breaker-stats" },
  get_failover_queue: { method: "GET", path: "/failover/queue" },
  get_available_providers_for_failover: { method: "GET", path: "/failover/available-providers" },
  add_to_failover_queue: { method: "POST", path: "/failover/queue/add" },
  remove_from_failover_queue: { method: "POST", path: "/failover/queue/remove" },
  get_auto_failover_enabled: { method: "GET", path: "/failover/auto-enabled" },
  set_auto_failover_enabled: { method: "PUT", path: "/failover/auto-enabled" },

  // ── 端点与导入导出 ──
  get_custom_endpoints: { method: "GET", path: "/provider-endpoints" },
  add_custom_endpoint: { method: "POST", path: "/provider-endpoints" },
  remove_custom_endpoint: { method: "DELETE", path: "/provider-endpoints" },
  update_endpoint_last_used: { method: "POST", path: "/provider-endpoints/last-used" },
  test_api_endpoints: { method: "POST", path: "/provider-endpoints/test" },
  read_live_provider_settings: { method: "POST", path: "/provider-endpoints/read-live-settings" },
  export_config_to_file: { method: "POST", path: "/config/export-file" },
  import_config_from_file: { method: "POST", path: "/config/import-file" },

  // ── 项目配置档案 ──
  list_profiles: { method: "GET", path: "/profiles" },
  create_profile: { method: "POST", path: "/profiles" },
  update_profile: { method: "PUT", path: "/profiles" },
  delete_profile: { method: "DELETE", path: "/profiles" },
  apply_profile: { method: "POST", path: "/profiles/apply" },
  clear_current_profile: { method: "POST", path: "/profiles/clear-current" },

  // ── 用量统计与模型价格 ──
  get_usage_summary_by_app: { method: "GET", path: "/usage/summary-by-app" },
  get_usage_trends: { method: "GET", path: "/usage/trends" },
  get_provider_stats: { method: "GET", path: "/usage/provider-stats" },
  get_model_stats: { method: "GET", path: "/usage/model-stats" },
  get_request_logs: { method: "GET", path: "/usage/request-logs" },
  get_request_detail: { method: "GET", path: "/usage/request-detail" },
  get_model_pricing: { method: "GET", path: "/usage/model-pricing" },
  update_model_pricing: { method: "PUT", path: "/usage/model-pricing" },
  update_model_pricing_batch: { method: "POST", path: "/usage/model-pricing/batch" },
  delete_model_pricing: { method: "DELETE", path: "/usage/model-pricing" },
  check_provider_limits: { method: "GET", path: "/usage/provider-limits" },
  sync_session_usage: { method: "POST", path: "/usage/sync-session" },
  rebuild_codex_usage: { method: "POST", path: "/usage/rebuild-codex" },
  get_usage_data_sources: { method: "GET", path: "/usage/data-sources" },

  // ── MCP 与提示词补全 ──
  upsert_mcp_server: { method: "POST", path: "/mcp/upsert" },
  toggle_mcp_app: { method: "POST", path: "/mcp/toggle-app" },
  import_mcp_from_apps: { method: "POST", path: "/mcp/import" },
  validate_mcp_command: { method: "POST", path: "/mcp/validate-command" },
  get_mcp_config: { method: "GET", path: "/mcp/config" },
  upsert_mcp_server_in_config: { method: "POST", path: "/mcp/config/upsert" },
  delete_mcp_server_in_config: { method: "DELETE", path: "/mcp/config" },
  set_mcp_enabled: { method: "POST", path: "/mcp/toggle-app" },
  upsert_prompt: { method: "POST", path: "/prompts/upsert" },
  enable_prompt: { method: "POST", path: "/prompts/enable" },
  import_prompt_from_file: { method: "POST", path: "/prompts/import-from-file" },
  get_current_prompt_file_content: { method: "POST", path: "/prompts/current-file" },
  get_pi_prompt_file: { method: "GET", path: "/prompts/pi-file" },
  replace_pi_prompt_file: { method: "POST", path: "/prompts/pi-file" },
  delete_pi_prompt_file: { method: "DELETE", path: "/prompts/pi-file" },
  list_pi_prompt_templates: { method: "GET", path: "/prompts/pi-templates" },
  upsert_pi_prompt_template: { method: "POST", path: "/prompts/pi-templates" },

  // ── 云同步、工具、桌面能力（Web 安全占位）──
  queryProviderUsage: { method: "POST", path: "/usage/provider-script" },
  testUsageScript: { method: "POST", path: "/usage/provider-script" },
  test_proxy_url: { method: "POST", path: "/proxy/test-url" },
  get_global_proxy_url: { method: "GET", path: "/proxy/global-url" },
  set_global_proxy_url: { method: "PUT", path: "/proxy/global-url" },
  get_upstream_proxy_status: { method: "GET", path: "/proxy/upstream-status" },
  scan_local_proxies: { method: "GET", path: "/proxy/scan-local" },
  get_default_cost_multiplier: { method: "GET", path: "/pricing/default-multiplier" },
  set_default_cost_multiplier: { method: "PUT", path: "/pricing/default-multiplier" },
  get_pricing_model_source: { method: "GET", path: "/pricing/model-source" },
  set_pricing_model_source: { method: "PUT", path: "/pricing/model-source" },
  get_stream_check_config: { method: "GET", path: "/connectivity/config" },
  save_stream_check_config: { method: "PUT", path: "/connectivity/config" },
  stream_check_provider: { method: "GET", path: "/connectivity/provider" },
  stream_check_all_providers: { method: "GET", path: "/connectivity/all" },
  check_for_updates: { method: "GET", path: "/updates" },
  install_update_and_restart: { method: "POST", path: "/updates/install" },
  check_app_update_available: { method: "GET", path: "/updates/available" },
  auth_list_accounts: { method: "GET", path: "/auth/accounts" },
  auth_get_status: { method: "GET", path: "/auth/status" },
  auth_cancel_login: { method: "POST", path: "/auth/cancel" },
  auth_poll_for_account: { method: "POST", path: "/auth/poll" },
  auth_logout: { method: "POST", path: "/auth/logout" },
  auth_remove_account: { method: "POST", path: "/auth/remove" },
  auth_set_default_account: { method: "POST", path: "/auth/default" },
  auth_start_login: { method: "POST", path: "/auth/login" },
  copilot_is_authenticated: { method: "GET", path: "/copilot/auth-status" },
  copilot_get_models: { method: "GET", path: "/copilot/models" },
  copilot_get_token: { method: "GET", path: "/copilot/token" },
  copilot_get_usage: { method: "GET", path: "/copilot/usage" },
  copilot_logout: { method: "POST", path: "/copilot/logout" },
  copilot_poll_for_auth: { method: "POST", path: "/copilot/poll" },
  get_hermes_live_provider_ids: { method: "GET", path: "/hermes/providers" },
  get_hermes_memory: { method: "GET", path: "/hermes/memory" },
  get_hermes_model_config: { method: "GET", path: "/hermes/memory" },
  set_hermes_memory: { method: "POST", path: "/hermes/memory" },
  set_hermes_memory_enabled: { method: "POST", path: "/hermes/memory" },
  launch_hermes_dashboard: { method: "POST", path: "/hermes/launch" },
  import_hermes_providers_from_live: { method: "GET", path: "/hermes/providers" },
  get_openclaw_live_provider: { method: "GET", path: "/openclaw/live" },
  get_openclaw_live_provider_ids: { method: "GET", path: "/openclaw/live" },
  get_openclaw_default_model: { method: "GET", path: "/openclaw/default-model" },
  set_openclaw_default_model: { method: "POST", path: "/openclaw/default-model" },
  get_openclaw_env: { method: "GET", path: "/openclaw/env" },
  set_openclaw_env: { method: "POST", path: "/openclaw/env" },
  get_openclaw_model_catalog: { method: "GET", path: "/openclaw/model-catalog" },
  set_openclaw_model_catalog: { method: "POST", path: "/openclaw/model-catalog" },
  get_openclaw_tools: { method: "GET", path: "/openclaw/tools" },
  set_openclaw_tools: { method: "POST", path: "/openclaw/tools" },
  get_openclaw_agents_defaults: { method: "GET", path: "/openclaw/agents-defaults" },
  set_openclaw_agents_defaults: { method: "POST", path: "/openclaw/agents-defaults" },
  import_openclaw_providers_from_live: { method: "GET", path: "/openclaw/live" },
  scan_openclaw_config_health: { method: "GET", path: "/openclaw/live" },
  get_current_omo_provider_id: { method: "GET", path: "/omo/current" },
  get_current_omo_slim_provider_id: { method: "GET", path: "/omo/current" },
  disable_current_omo: { method: "POST", path: "/omo/disable" },
  disable_current_omo_slim: { method: "POST", path: "/omo/disable" },
  read_omo_local_file: { method: "GET", path: "/omo/file" },
  read_omo_slim_local_file: { method: "GET", path: "/omo/file" },
  write_daily_memory_file: { method: "POST", path: "/workspace/memory" },
  read_daily_memory_file: { method: "GET", path: "/workspace/memory" },
  delete_daily_memory_file: { method: "DELETE", path: "/workspace/memory" },
  list_daily_memory_files: { method: "GET", path: "/workspace/memory" },
  search_daily_memory_files: { method: "GET", path: "/workspace/memory" },
  read_workspace_file: { method: "GET", path: "/workspace/file" },
  write_workspace_file: { method: "POST", path: "/workspace/file" },
  open_workspace_directory: { method: "POST", path: "/workspace/open" },
  import_from_deeplink_unified: { method: "GET", path: "/deeplink/import" },
  parse_deeplink: { method: "GET", path: "/deeplink/parse" },
  merge_deeplink_config: { method: "GET", path: "/deeplink/merge" },
  discover_available_skills: { method: "GET", path: "/skills/advanced" },
  scan_unmanaged_skills: { method: "GET", path: "/skills/advanced" },
  search_skills_sh: { method: "GET", path: "/skills/advanced" },
  migrate_skill_storage: { method: "POST", path: "/skills/advanced" },
  install_skills_from_zip: { method: "POST", path: "/skills/advanced" },
  install_skill_for_app: { method: "POST", path: "/skills/advanced" },
  uninstall_skill_for_app: { method: "POST", path: "/skills/advanced" },
  install_skill_unified: { method: "POST", path: "/skills/advanced" },
  uninstall_skill_unified: { method: "POST", path: "/skills/advanced" },
  toggle_skill_app: { method: "POST", path: "/skills/advanced" },
  update_skill: { method: "POST", path: "/skills/advanced" },
  import_skills_from_apps: { method: "POST", path: "/skills/advanced" },
  check_skill_updates: { method: "GET", path: "/skills/advanced" },
  add_skill_repo: { method: "POST", path: "/skills/advanced" },
  remove_skill_repo: { method: "POST", path: "/skills/advanced" },
  get_skill_repos: { method: "GET", path: "/skills/advanced" },
  get_skill_backups: { method: "GET", path: "/skills/advanced" },
  delete_skill_backup: { method: "POST", path: "/skills/advanced" },
  restore_skill_backup: { method: "POST", path: "/skills/advanced" },
  webdav_test_connection: { method: "POST", path: "/cloud-sync/test" },
  s3_test_connection: { method: "POST", path: "/cloud-sync/test" },
  webdav_sync_fetch_remote_info: { method: "GET", path: "/cloud-sync/info" },
  s3_sync_fetch_remote_info: { method: "GET", path: "/cloud-sync/info" },
  webdav_sync_upload: { method: "POST", path: "/cloud-sync/upload" },
  webdav_sync_download: { method: "GET", path: "/cloud-sync/download" },
  webdav_sync_save_settings: { method: "POST", path: "/cloud-sync/info" },
  s3_sync_upload: { method: "POST", path: "/cloud-sync/upload" },
  s3_sync_download: { method: "GET", path: "/cloud-sync/download" },
  s3_sync_save_settings: { method: "POST", path: "/cloud-sync/info" },
  get_auto_launch_status: { method: "GET", path: "/autolaunch" },
  set_auto_launch: { method: "PUT", path: "/autolaunch" },
  open_config_folder: { method: "GET", path: "/folders/config" },
  open_app_config_folder: { method: "GET", path: "/folders/app" },
  get_universal_providers: { method: "GET", path: "/universal-providers" },
  get_universal_provider: { method: "GET", path: "/universal-providers" },
  upsert_universal_provider: { method: "POST", path: "/universal-providers" },
  delete_universal_provider: { method: "POST", path: "/universal-providers" },
  sync_universal_provider: { method: "POST", path: "/universal-providers" },
  get_skills: { method: "GET", path: "/skills" },
  get_skills_for_app: { method: "GET", path: "/skills" },
  has_codex_unify_history_backup: { method: "GET", path: "/cloud-sync/info" },
  restore_codex_unified_history: { method: "POST", path: "/cloud-sync/info" },
  get_opencode_models: { method: "GET", path: "/oauth/models" },
  fetch_models_for_config: { method: "GET", path: "/oauth/models" },
  get_codex_oauth_models: { method: "GET", path: "/oauth/models" },
  get_codex_oauth_quota: { method: "GET", path: "/oauth/quota" },
  get_xai_oauth_models: { method: "GET", path: "/oauth/models" },
  get_xai_oauth_quota: { method: "GET", path: "/oauth/quota" },
  get_tool_versions: { method: "GET", path: "/tools/versions" },
  probe_tool_installations: { method: "GET", path: "/tools/versions" },
  run_tool_lifecycle_action: { method: "POST", path: "/tools/lifecycle" },
  set_window_theme: { method: "POST", path: "/window/theme" },
  set_app_config_dir_override: { method: "PUT", path: "/settings/app-config-dir-override" },
  get_app_config_dir_override: { method: "GET", path: "/settings/app-config-dir-override" },
  apply_claude_onboarding_skip: { method: "POST", path: "/claude-desktop/onboarding" },
  clear_claude_onboarding_skip: { method: "POST", path: "/claude-desktop/onboarding" },
  apply_claude_plugin_config: { method: "POST", path: "/claude-desktop/plugin" },
  get_claude_desktop_status: { method: "GET", path: "/claude-desktop/status" },
  get_claude_desktop_default_routes: { method: "GET", path: "/claude-desktop/routes" },
  ensure_claude_desktop_official_provider: { method: "POST", path: "/claude-desktop/provider" },
  ensure_codex_official_provider: { method: "POST", path: "/claude-desktop/provider" },
  ensure_grokbuild_official_provider: { method: "POST", path: "/claude-desktop/provider" },
  sync_current_providers_live: { method: "POST", path: "/claude-desktop/provider" },
  delete_sessions: { method: "POST", path: "/sessions/delete" },
  import_claude_desktop_providers_from_claude: { method: "POST", path: "/claude-desktop/provider" },
  import_opencode_providers_from_live: { method: "GET", path: "/openclaw/live" },
  get_opencode_live_provider_ids: { method: "GET", path: "/openclaw/live" },
  get_claude_mcp_status: { method: "GET", path: "/claude-desktop/status" },
  read_claude_mcp_config: { method: "GET", path: "/claude-desktop/status" },
  upsert_claude_mcp_server: { method: "POST", path: "/claude-desktop/provider" },
  delete_claude_mcp_server: { method: "POST", path: "/claude-desktop/provider" },
  open_provider_terminal: { method: "POST", path: "/terminal/provider" },
  launch_session_terminal: { method: "POST", path: "/terminal/session" },
  open_file_dialog: { method: "GET", path: "/dialog/file" },
  save_file_dialog: { method: "POST", path: "/dialog/file" },
  pick_directory: { method: "GET", path: "/dialog/directory" },
  open_zip_file_dialog: { method: "GET", path: "/dialog/zip" },
  // ── 通用 ──
  copy_text_to_clipboard: { method: "POST", path: "/clipboard/copy" },
  open_external: { method: "POST", path: "/open-external" },
  get_installed_skills: { method: "GET", path: "/skills" },
  list_sessions: { method: "GET", path: "/sessions" },
  get_balance: { method: "GET", path: "/oauth/quota" },
  get_coding_plan_quota: { method: "GET", path: "/oauth/quota" },
  get_subscription_quota: { method: "GET", path: "/oauth/quota" },
  get_claude_common_config_snippet: { method: "GET", path: "/config/common" },
  set_claude_common_config_snippet: { method: "PUT", path: "/config/common" },
  get_hermes_memory_limits: { method: "GET", path: "/hermes/memory" },
  open_hermes_web_ui: { method: "POST", path: "/hermes/launch" },
  copilot_get_auth_status: { method: "GET", path: "/copilot/auth-status" },
  copilot_get_models_for_account: { method: "GET", path: "/copilot/models" },
  copilot_get_token_for_account: { method: "GET", path: "/copilot/token" },
  copilot_get_usage_for_account: { method: "GET", path: "/copilot/usage" },
  copilot_list_accounts: { method: "GET", path: "/auth/accounts" },
  copilot_poll_for_account: { method: "POST", path: "/copilot/poll" },
  copilot_remove_account: { method: "POST", path: "/auth/remove" },
  copilot_set_default_account: { method: "POST", path: "/auth/default" },
  copilot_start_device_flow: { method: "POST", path: "/auth/login" },
  get_pi_current_state: { method: "GET", path: "/prompts/pi-file" },
  get_pi_session_discovery: { method: "GET", path: "/prompts/pi-templates" },
  update_pi_provider_usage_script: { method: "POST", path: "/usage/provider-script" },
  delete_pi_prompt_template: { method: "DELETE", path: "/prompts/pi-templates" },

  restart_app: { method: "POST", path: "/restart" },
  update_tray_menu: { method: "POST", path: "/tray/update" },
};

/** 兼容 Tauri invoke 签名，内部走 axios */
export async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const route = commandRoutes[command];

  if (!route) {
    throw new Error(`[transport] Unknown command: ${command}`);
  }

  const { method, path } = route;
  let url = buildApiUrl(`/api${path}`);
  const cleanArgs = args ? { ...args } : undefined;

  // 路径参数替换
  if (path.includes(":") && cleanArgs) {
    for (const [key, value] of Object.entries(cleanArgs)) {
      if (path.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
        delete cleanArgs[key];
      }
    }
  }

  const config: import("axios").AxiosRequestConfig = {
    method: method as import("axios").Method,
    url,
    // DELETE 资源的定位参数应放在 query string；Fastify 路由也从 req.query 读取。
    params: method === "GET" || method === "DELETE" ? cleanArgs : undefined,
    data: method !== "GET" && method !== "DELETE" ? cleanArgs : undefined,
  };

  const res = await axios.request<T>(config);
  return res.data;
}
