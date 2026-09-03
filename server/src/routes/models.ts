import type { FastifyInstance } from "fastify";
import {
  fetchModelsForConfig,
  type FetchModelsParams,
} from "../services/model-fetch-service.js";

export function registerModelRoutes(app: FastifyInstance) {
  // POST /api/models/fetch
  // 前端 fetchModelsForConfig 对应端点：根据供应商 baseURL/API Key
  // 拉取 OpenAI 兼容的模型列表。
  app.post("/api/models/fetch", async (req) => {
    const body = (req.body ?? {}) as FetchModelsParams;
    return fetchModelsForConfig(body);
  });
}
