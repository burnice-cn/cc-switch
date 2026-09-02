import { copyFile, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { ServerEnv } from "../config/env.js";

function backupDir(env: ServerEnv) {
  return join(env.appConfigDir, "backups");
}

export function registerBackupRoutes(app: FastifyInstance, env: ServerEnv) {
  app.post("/api/backups", async (_req, reply) => {
    const dir = backupDir(env);
    await mkdir(dir, { recursive: true });
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    const filename = `db_backup_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.db`;
    await copyFile(env.dbPath, join(dir, filename));
    return reply.send(filename);
  });

  app.get("/api/backups", async () => {
    const dir = backupDir(env);
    if (!existsSync(dir)) return [];
    const files = await readdir(dir);
    const entries = await Promise.all(
      files.filter((file) => file.endsWith(".db")).map(async (filename) => {
        const item = await stat(join(dir, filename));
        return {
          filename,
          sizeBytes: item.size,
          createdAt: item.mtime.toISOString(),
        };
      }),
    );
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  app.post("/api/backups/restore", async (req, reply) => {
    const { filename } = req.body as { filename?: string };
    if (!filename) {
      return reply.code(400).send({ message: "缺少备份文件名" });
    }
    const source = join(backupDir(env), filename);
    if (!existsSync(source)) {
      return reply.code(404).send({ message: "备份文件不存在" });
    }
    await copyFile(source, env.dbPath);
    return { ok: true, requireRestart: true };
  });

  app.delete("/api/backups", async (req) => {
    const { filename } = req.query as { filename?: string };
    if (!filename) return false;
    await unlink(join(backupDir(env), filename));
    return true;
  });

  app.put("/api/backups/rename", async (req) => {
    const { filename, newName } = req.body as { filename?: string; newName?: string };
    if (!filename || !newName) return false;
    await rename(join(backupDir(env), filename), join(backupDir(env), newName));
    return true;
  });
}
