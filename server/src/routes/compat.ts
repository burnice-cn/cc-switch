import type { FastifyInstance } from "fastify";

type Handler = (req: any, reply: any) => unknown;
const value = <T,>(result: T): Handler => async () => result;

/**
 * 桌面版专用能力兼容层。
 * 前后端分离后，这些依赖本机 GUI、OAuth 或外部工具链的功能暂以安全空值返回，
 * 避免前端控制台反复出现 Unknown command / 404。
 */
export function registerCompatRoutes(app: FastifyInstance) {
  const none = async () => null;
  const emptyArray = async () => [] as unknown[];
  const emptyObject = async () => ({});
  const falseResult = async () => false;
  const zeroResult = async () => 0;
  const unsupported = async () => ({
    success: false,
    message: "Web 版后端暂不支持该桌面功能",
  });

  const routes: Array<[string, string, Handler]> = [
    ["GET", "/api/auth/accounts", emptyArray],
    ["GET", "/api/auth/status", none],
    ["POST", "/api/auth/cancel", falseResult],
    ["POST", "/api/auth/poll", none],
    ["POST", "/api/auth/logout", falseResult],
    ["POST", "/api/auth/remove", falseResult],
    ["POST", "/api/auth/default", falseResult],
    ["POST", "/api/auth/login", emptyObject],

    ["GET", "/api/copilot/auth-status", unsupported],
    ["GET", "/api/copilot/models", emptyArray],
    ["GET", "/api/copilot/token", none],
    ["GET", "/api/copilot/usage", unsupported],
    ["POST", "/api/copilot/logout", falseResult],
    ["POST", "/api/copilot/poll", none],

    ["GET", "/api/hermes/providers", emptyArray],
    ["GET", "/api/hermes/memory", none],
    ["GET", "/api/hermes/tools", emptyArray],
    ["POST", "/api/hermes/memory", falseResult],
    ["POST", "/api/hermes/launch", falseResult],

    ["GET", "/api/openclaw/*", emptyObject],

    ["GET", "/api/omo/*", none],

    ["GET", "/api/workspace/*", none],

    ["GET", "/api/deeplink/*", none],

    ["GET", "/api/skills/advanced", emptyArray],
    ["POST", "/api/skills/advanced", zeroResult],
    ["PUT", "/api/skills/advanced", falseResult],
    ["DELETE", "/api/skills/advanced", falseResult],

    ["GET", "/api/cloud-sync/test", unsupported],
    ["POST", "/api/cloud-sync/test", unsupported],
    ["GET", "/api/cloud-sync/info", value(null)],
    ["POST", "/api/cloud-sync/upload", unsupported],
    ["GET", "/api/cloud-sync/download", unsupported],

    ["GET", "/api/updates", value({ status: "up-to-date" })],
    ["POST", "/api/updates/install", falseResult],
    ["GET", "/api/updates/available", value(null)],

    ["GET", "/api/dialog/*", value(null)],
    ["GET", "/api/terminal/*", falseResult],
    ["GET", "/api/claude-desktop/*", emptyObject],
    ["GET", "/api/oauth/*", emptyArray],
    ["GET", "/api/tools/versions", emptyArray],
    ["POST", "/api/tools/lifecycle", falseResult],
    ["POST", "/api/window/theme", value(true)],
    ["GET", "/api/autolaunch", value(false)],
    ["PUT", "/api/autolaunch", value(true)],
    ["GET", "/api/folders/*", value(null)],
    ["GET", "/api/universal-providers", emptyObject],
    ["GET", "/api/proxy/global-url", value(null)],
    ["PUT", "/api/proxy/global-url", value(true)],
    ["GET", "/api/proxy/test-url", unsupported],
    ["GET", "/api/proxy/upstream-status", value({ enabled: false, proxyUrl: null })],
    ["GET", "/api/proxy/scan-local", emptyArray],
    ["GET", "/api/pricing/default-multiplier", value("1")],
    ["PUT", "/api/pricing/default-multiplier", value(true)],
    ["GET", "/api/pricing/model-source", value("response")],
    ["PUT", "/api/pricing/model-source", value(true)],
    ["GET", "/api/usage/provider-script", unsupported],
    ["POST", "/api/usage/provider-script", unsupported],
    ["GET", "/api/connectivity/config", value({ timeoutSecs: 10, maxRetries: 2, degradedThresholdMs: 3000 })],
    ["PUT", "/api/connectivity/config", value(true)],
    ["GET", "/api/connectivity/provider", unsupported],
    ["GET", "/api/connectivity/all", emptyArray],
  ];

  for (const [method, url, handler] of routes) {
    if (url.includes("*")) {
      app.route({ method: ["GET", "POST", "PUT", "DELETE"], url, handler });
    } else {
      app.route({ method: method as any, url, handler });
    }
  }
}
