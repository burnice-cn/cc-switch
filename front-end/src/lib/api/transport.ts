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
  remove_provider_from_live_config: { method: "DELETE", path: "/providers/live-config" },

  // ── 设置 ──
  get_settings: { method: "GET", path: "/settings" },
  save_settings: { method: "PUT", path: "/settings" },
  get_config_dir: { method: "GET", path: "/settings/config-dir" },
  get_claude_code_config_path: { method: "GET", path: "/settings/claude-code-config-path" },
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

  // ── 通用 ──
  copy_text_to_clipboard: { method: "POST", path: "/clipboard/copy" },
  open_external: { method: "POST", path: "/open-external" },
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
    params:
      method === "GET" || method === "DELETE" ? cleanArgs : undefined,
    data: method !== "GET" && method !== "DELETE" ? cleanArgs : undefined,
  };

  const res = await axios.request<T>(config);
  return res.data;
}
