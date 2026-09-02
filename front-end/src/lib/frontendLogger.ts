/**
 * 前端日志 — 替代 @tauri-apps/plugin-log
 *
 * Web 版直接使用 console + 可选的远程日志上报。
 */

export function reportFrontendError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${context}]`, message, error);
}

export function installGlobalErrorHandlers(): void {
  window.addEventListener("error", (event) => {
    reportFrontendError("window.onerror", event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportFrontendError("unhandledrejection", event.reason);
  });
}

// 兼容旧接口（保留导出避免编译错误）
export function error(context: string, message: string): void {
  console.error(`[${context}]`, message);
}
export function warn(context: string, message: string): void {
  console.warn(`[${context}]`, message);
}
export function info(context: string, message: string): void {
  console.info(`[${context}]`, message);
}
