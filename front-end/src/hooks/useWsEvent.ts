/**
 * useWsEvent — 替代 useTauriEvent
 *
 * 订阅 WebSocket 事件，自动清理订阅。
 */
import { useEffect, useRef } from "react";
import { wsClient } from "@/lib/ws/client";

export function useWsEvent<T>(event: string, handler: (payload: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    return wsClient.on<T>(event, (payload: T) => ref.current(payload));
  }, [event]);
}
