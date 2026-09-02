/**
 * WebSocket 客户端 — 替代 @tauri-apps/api/event 的 listen()
 *
 * 自动重连，向后端订阅实时事件。
 */

import { buildWebSocketUrl } from "@/lib/api/server";

type EventHandler = (payload: any) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<EventHandler>>();
  private reconnectTimer: number | null = null;
  private url: string = "";

  connect(url?: string) {
    this.url = url ?? buildWebSocketUrl();

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log("[WS] connected");
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    };

    this.ws.onmessage = (ev) => {
      try {
        const { event, payload } = JSON.parse(ev.data);
        this.handlers.get(event)?.forEach((h) => h(payload));
      } catch {
        // 忽略解析错误
      }
    };

    this.ws.onclose = () => {
      console.log("[WS] disconnected, reconnecting...");
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // 由 onclose 处理重连
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(this.url);
    }, 2000);
  }

  /** 订阅事件，返回取消订阅函数 */
  on<P = unknown>(event: string, handler: (payload: P) => void): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler);
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.url = "";
  }
}

export const wsClient = new WsClient();
