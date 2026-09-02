/**
 * 会话 ID 提取 — 对应 Rust 端 proxy/session.rs
 */
import type { IncomingMessage } from "node:http";

/** 从请求中提取会话 ID（用于流式请求的 prompt cache 关联） */
export function extractSessionId(req: IncomingMessage): string | null {
  // 从 headers 中查找
  const sessionHeader = req.headers["x-session-id"] ?? req.headers["x-request-id"];
  if (sessionHeader && typeof sessionHeader === "string") return sessionHeader;

  // 从 user-agent 中提取（Claude Code 使用 conversation_id）
  const ua = req.headers["user-agent"];
  if (ua && typeof ua === "string") {
    const match = ua.match(/conversation[_-]id[=:]([a-f0-9-]+)/i);
    if (match) return match[1];
  }

  return null;
}
