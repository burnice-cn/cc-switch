/**
 * 模型列表获取服务。
 *
 * 通过 OpenAI 兼容的 GET /v1/models 端点获取供应商可用模型列表，
 * 与桌面版 services/model_fetch.rs 保持一致：按候选 URL 顺序尝试、
 * 对 404/405 尝试下一候选、剥离 Anthropic 兼容子路径兜底。
 */
import axios, { type AxiosResponse } from "axios";

export interface FetchedModel {
  id: string;
  ownedBy: string | null;
}

export interface FetchModelsParams {
  baseUrl?: string;
  apiKey?: string;
  isFullUrl?: boolean;
  modelsUrl?: string;
  customUserAgent?: string;
  apiFormat?: string;
  requestHeaders?: Record<string, string>;
}

const FETCH_TIMEOUT_MS = 15_000;
const MAX_REQUEST_HEADERS = 64;
const MAX_HEADER_NAME_BYTES = 256;
const MAX_HEADER_VALUE_BYTES = 16 * 1024;
const ERROR_BODY_MAX_CHARS = 512;

const KNOWN_COMPAT_SUFFIXES = [
  "/api/claudecode",
  "/api/anthropic",
  "/apps/anthropic",
  "/api/coding",
  "/claudecode",
  "/anthropic",
  "/step_plan",
  "/coding",
  "/claude",
];

const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export async function fetchModelsForConfig(
  params: FetchModelsParams,
): Promise<FetchedModel[]> {
  const baseUrl = (params.baseUrl ?? "").trim();
  const apiKey = (params.apiKey ?? "").trim();
  const candidates = buildModelsUrlCandidates(
    baseUrl,
    params.isFullUrl === true,
    params.modelsUrl,
  );
  const headers = buildModelFetchHeaders(
    apiKey,
    params.apiFormat,
    params.customUserAgent,
    params.requestHeaders,
  );

  const secrets = [apiKey, ...Object.values(params.requestHeaders ?? {})].filter(
    (secret) => secret.length > 0,
  );

  let lastErr: string | null = null;
  for (const url of candidates) {
    let response: AxiosResponse<string>;
    try {
      response = await axios.get(url, {
        headers,
        timeout: FETCH_TIMEOUT_MS,
        // 状态码全部放行，由下方按 404/405/其它错误分别处理。
        validateStatus: () => true,
        responseType: "text",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Request failed: ${message}`);
    }

    const status = response.status;
    const body =
      typeof response.data === "string" ? response.data : String(response.data ?? "");

    if (status >= 200 && status < 300) {
      return parseModelsResponse(body);
    }

    const detail = redactModelFetchErrorBody(body, secrets);
    if (status === 404 || status === 405) {
      lastErr = `HTTP ${status}: ${detail}`;
      continue;
    }
    throw new Error(`HTTP ${status}: ${detail}`);
  }

  throw new Error(`All candidates failed: ${lastErr ?? "no candidates"}`);
}

function parseModelsResponse(body: string): FetchedModel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse response: ${message}`);
  }

  const data =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).data
      : undefined;
  if (!Array.isArray(data)) return [];

  const models: FetchedModel[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) continue;
    models.push({
      id,
      ownedBy: typeof record.owned_by === "string" ? record.owned_by : null,
    });
  }

  models.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return models;
}

function buildModelFetchHeaders(
  apiKey: string,
  apiFormat: string | undefined,
  customUserAgent: string | undefined,
  requestHeaders: Record<string, string> | undefined,
): Record<string, string> {
  const entries = Object.entries(requestHeaders ?? {});
  if (!apiKey && entries.length === 0) {
    throw new Error("API Key or request headers are required to fetch models");
  }
  if (entries.length > MAX_REQUEST_HEADERS) {
    throw new Error(
      `Too many model-fetch request headers (maximum ${MAX_REQUEST_HEADERS})`,
    );
  }

  const headers: Record<string, string> = {};
  if (apiKey) {
    if (apiFormat === "anthropic-messages") {
      headers["x-api-key"] = apiKey;
    } else if (apiFormat === "google-generative-ai") {
      headers["x-goog-api-key"] = apiKey;
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
    }
  }

  const userAgent = (customUserAgent ?? "").trim();
  if (userAgent) headers["User-Agent"] = userAgent;

  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim();
    if (!name || Buffer.byteLength(name) > MAX_HEADER_NAME_BYTES) {
      throw new Error(`Invalid model-fetch header name: ${rawName}`);
    }
    if (Buffer.byteLength(rawValue) > MAX_HEADER_VALUE_BYTES) {
      throw new Error(`Model-fetch header value is too large: ${name}`);
    }
    if (!HEADER_TOKEN.test(name)) {
      throw new Error(`Invalid model-fetch header name ${name}`);
    }
    headers[name] = rawValue;
  }

  return headers;
}

export function buildModelsUrlCandidates(
  baseUrl: string,
  isFullUrl: boolean,
  modelsUrlOverride?: string,
): string[] {
  const override = (modelsUrlOverride ?? "").trim();
  if (override) return [override];

  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Base URL is empty");

  const candidates: string[] = [];

  if (isFullUrl) {
    const v1Index = trimmed.indexOf("/v1/");
    if (v1Index >= 0) {
      candidates.push(`${trimmed.slice(0, v1Index)}/v1/models`);
    } else {
      const slashIndex = trimmed.lastIndexOf("/");
      const schemeIndex = trimmed.indexOf("://");
      if (slashIndex > schemeIndex + 2) {
        candidates.push(`${trimmed.slice(0, slashIndex)}/v1/models`);
      }
    }
    if (candidates.length === 0) {
      throw new Error("Cannot derive models endpoint from full URL");
    }
    return dedupe(candidates);
  }

  if (endsWithVersionSegment(trimmed)) {
    candidates.push(`${trimmed}/models`);
    if (!trimmed.endsWith("/v1")) {
      candidates.push(`${trimmed}/v1/models`);
    }
  } else {
    candidates.push(`${trimmed}/v1/models`);
  }

  const stripped = stripCompatSuffix(trimmed);
  if (stripped) {
    const root = stripped.replace(/\/+$/, "");
    if (root && root.includes("://")) {
      candidates.push(`${root}/v1/models`);
      candidates.push(`${root}/models`);
    }
  }

  return dedupe(candidates);
}

function stripCompatSuffix(baseUrl: string): string | undefined {
  for (const suffix of KNOWN_COMPAT_SUFFIXES) {
    if (baseUrl.endsWith(suffix)) {
      return baseUrl.slice(0, baseUrl.length - suffix.length);
    }
  }
  return undefined;
}

function endsWithVersionSegment(url: string): boolean {
  const last = url.split("/").at(-1) ?? "";
  return (
    last.length > 1 &&
    last.startsWith("v") &&
    [...last.slice(1)].every((char) => char >= "0" && char <= "9")
  );
}

function dedupe(values: string[]): string[] {
  const unique: string[] = [];
  for (const value of values) {
    if (!unique.includes(value)) unique.push(value);
  }
  return unique;
}

function redactModelFetchErrorBody(body: string, secrets: string[]): string {
  let redacted = body;
  for (const secret of secrets) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  if (redacted.length <= ERROR_BODY_MAX_CHARS) return redacted;
  return `${redacted.slice(0, ERROR_BODY_MAX_CHARS)}…`;
}
