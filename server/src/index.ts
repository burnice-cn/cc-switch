import { createApp } from "./app.js";
import { getServerEnv } from "./config/env.js";
import { AppDatabase } from "./db/database.js";
import { exec } from "node:child_process";
import { platform } from "node:os";

const env = getServerEnv();

async function main() {
  // 1. 单实例检测
  try {
    const res = await fetch(`http://127.0.0.1:${env.port}/api/health`);
    if (res.ok) {
      console.log(`CC Switch 已在运行，打开浏览器: http://localhost:${env.port}`);
      if (env.host !== "0.0.0.0") openBrowser(`http://localhost:${env.port}`);
      process.exit(0);
    }
  } catch {
    /* 端口未占用，继续启动 */
  }

  // 2. 初始化数据库
  const db = new AppDatabase(env.dbPath);
  db.init();

  // 3. 创建 Fastify 应用
  const { app } = await createApp(db);

  // 4. 启动 HTTP 服务器；远程部署必须绑定 0.0.0.0
  await app.listen({ port: env.port, host: env.host });
  console.log(
    `CC Switch 服务已启动: http://${env.host === "0.0.0.0" ? "0.0.0.0" : env.host}:${env.port}`,
  );
  console.log(
    `数据目录: ${env.appConfigDir}\n静态前端目录: ${env.staticDir}`,
  );

  // 5. 仅本机部署时自动打开浏览器
  if (env.host === "127.0.0.1" || env.host === "localhost") {
    openBrowser(`http://localhost:${env.port}`);
  }
}

function openBrowser(url: string) {
  switch (platform()) {
    case "darwin":
      exec(`open "${url}"`);
      break;
    case "win32":
      exec(`start "${url}"`);
      break;
    default:
      exec(`xdg-open "${url}"`);
      break;
  }
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
