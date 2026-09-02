/**
 * listen — 替代 @tauri-apps/api/event 的 listen
 */
import { wsClient } from "./client.js";

export type UnlistenFn = () => void;

export interface WsEvent<P = unknown> {
  payload: P;
  event: string;
  id: number;
}

/** 兼容 Tauri listen 签名的事件订阅 */
export function listen<P>(
  eventName: string,
  handler: (event: WsEvent<P>) => void,
): Promise<UnlistenFn> {
  const unsubscribe = wsClient.on<P>(eventName, (payload) => {
    handler({ payload, event: eventName, id: 0 });
  });
  return Promise.resolve(unsubscribe);
}
