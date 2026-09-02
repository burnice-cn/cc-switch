/**
 * 前端可连接的后端服务器配置。
 * 同源部署时使用相对地址；跨机器部署时保存完整 HTTP(S) Origin。
 */

export interface BackendServer {
  id: string;
  name: string;
  baseUrl: string;
  createdAt: number;
}

const SERVERS_KEY = "cc-switch-backend-servers";
const ACTIVE_KEY = "cc-switch-active-backend-server";
const LEGACY_URL_KEY = "cc-switch-backend-url";

const normalizeBaseUrl = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }

  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Backend URL must use http or https");
  }
  return url.origin;
};

const readServers = (): BackendServer[] => {
  try {
    const raw = localStorage.getItem(SERVERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BackendServer[];
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item?.name && item?.baseUrl) : [];
  } catch {
    return [];
  }
};

const writeServers = (servers: BackendServer[]) => {
  localStorage.setItem(SERVERS_KEY, JSON.stringify(servers));
};

const defaultBaseUrl = (): string => {
  const legacy = localStorage.getItem(LEGACY_URL_KEY);
  if (legacy) {
    try {
      return normalizeBaseUrl(legacy);
    } catch {
      localStorage.removeItem(LEGACY_URL_KEY);
    }
  }

  const port = import.meta.env.VITE_API_PORT ?? "37800";
  return `${window.location.protocol}//${window.location.hostname}:${port}`;
};

const ensureDefaultServer = (): BackendServer => {
  const servers = readServers();
  const existing = servers[0];
  if (existing) return existing;

  const server: BackendServer = {
    id: crypto.randomUUID(),
    name: "Default",
    baseUrl: defaultBaseUrl(),
    createdAt: Date.now(),
  };
  writeServers([server]);
  localStorage.setItem(ACTIVE_KEY, server.id);
  return server;
};

export const serverConfig = {
  getActive(): BackendServer {
    const servers = readServers();
    if (servers.length === 0) return ensureDefaultServer();

    const activeId = localStorage.getItem(ACTIVE_KEY);
    return servers.find((item) => item.id === activeId) ?? servers[0];
  },

  list(): BackendServer[] {
    if (readServers().length === 0) ensureDefaultServer();
    return readServers();
  },

  add(name: string, url: string): BackendServer {
    const baseUrl = normalizeBaseUrl(url);
    const servers = readServers();
    const existing = servers.find((item) => item.baseUrl === baseUrl);
    if (existing) {
      localStorage.setItem(ACTIVE_KEY, existing.id);
      return existing;
    }

    const server: BackendServer = {
      id: crypto.randomUUID(),
      name: name.trim() || new URL(baseUrl).host,
      baseUrl,
      createdAt: Date.now(),
    };
    writeServers([...servers, server]);
    localStorage.setItem(ACTIVE_KEY, server.id);
    return server;
  },

  setActive(id: string): BackendServer {
    const server = readServers().find((item) => item.id === id);
    if (!server) throw new Error("Backend server not found");
    localStorage.setItem(ACTIVE_KEY, id);
    return server;
  },

  remove(id: string): BackendServer | null {
    const servers = readServers();
    const active = this.getActive();
    const next = servers.filter((item) => item.id !== id);
    if (next.length === 0) throw new Error("At least one backend server is required");

    writeServers(next);
    if (active.id === id) {
      localStorage.setItem(ACTIVE_KEY, next[0].id);
      return next[0];
    }
    return null;
  },
};

export const buildApiUrl = (path: string): string => {
  const server = serverConfig.getActive();
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${server.baseUrl}${suffix}`;
};

export const buildWebSocketUrl = (): string => {
  const server = serverConfig.getActive();
  const base = server.baseUrl;
  if (base.startsWith("/") && !base.startsWith("//")) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${base}/ws`;
  }
  return `${base.replace(/^http/, "ws")}/ws`;
};
