import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";

/**
 * WebSocket 事件广播器
 */
export class EventBroadcaster {
  private connections = new Set<WebSocket>();

  constructor(app: FastifyInstance) {
    app.get("/ws", { websocket: true }, (connection) => {
      // @fastify/websocket v11+ 传 connection 对象
      const ws = (connection as any).socket ?? (connection as unknown as WebSocket);
      this.connections.add(ws);
      ws.on("close", () => {
        this.connections.delete(ws);
      });
    });
  }

  emit(event: string, payload?: unknown): void {
    const message = JSON.stringify({ event, payload });
    for (const ws of this.connections) {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(message);
      }
    }
  }

  emitProviderSwitched(appType: string, providerId: string) {
    this.emit("provider-switched", { appType, providerId });
  }

  emitMcpServersChanged() {
    this.emit("mcp-servers-changed");
  }

  emitProxyFlagsChanged(flags: Record<string, unknown>) {
    this.emit("proxy-flags-changed", flags);
  }

  emitUsageLogRecorded() {
    this.emit("usage-log-recorded");
  }

  emitUsageCacheUpdated(payload: unknown) {
    this.emit("usage-cache-updated", payload);
  }

  emitSyncStatusUpdated(source: string, status: string, error?: string) {
    this.emit("sync-status-updated", { source, status, error });
  }
}
