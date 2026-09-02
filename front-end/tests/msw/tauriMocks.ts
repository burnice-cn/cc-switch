import { vi } from "vitest";

const eventListeners = new Map<
  string,
  Set<(event: { payload: unknown }) => void>
>();

const ensureListenerSet = (event: string) => {
  if (!eventListeners.has(event)) {
    eventListeners.set(event, new Set());
  }
  return eventListeners.get(event)!;
};

/** Test helper for emitting backend event payloads over the WebSocket-compatible API. */
export const emitTauriEvent = (event: string, payload: unknown) => {
  ensureListenerSet(event);
  eventListeners.get(event)?.forEach((handler) => handler({ payload }));
};

vi.mock("@/lib/ws/listen", () => ({
  listen: async (
    event: string,
    handler: (event: { payload: unknown }) => void,
  ) => {
    const set = ensureListenerSet(event);
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  },
}));
