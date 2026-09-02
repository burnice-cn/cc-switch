import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

let tempCounter = 0;

function replaceFile(tempPath: string, path: string): void {
  // Windows rename cannot replace an existing read-only destination. A crash
  // between unlink and rename still leaves the complete temp file available.
  if (existsSync(path)) unlinkSync(path);
  try {
    renameSync(tempPath, path);
  } catch {
    copyFileSync(tempPath, path);
    unlinkSync(tempPath);
  }
}

function withTempFile(path: string, data: string, mode: number | null): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = join(
    dirname(path),
    `.${randomUUID()}.cc-switch-${process.pid}-${tempCounter++}.tmp`,
  );
  const fd = openSync(tempPath, "wx", mode ?? 0o600);
  try {
    writeSync(fd, data, null, "utf8");
    closeSync(fd);
    replaceFile(tempPath, path);
  } catch (error) {
    try { closeSync(fd); } catch {}
    try { unlinkSync(tempPath); } catch {}
    throw error;
  }
  if (mode !== null) {
    try { chmodSync(path, mode); } catch {}
  }
}

/** Atomically replace a text file. A reader sees either the old or new complete file. */
export function atomicWriteText(path: string, content: string, mode: number | null = null): void {
  withTempFile(path, content, mode);
}

/** Atomically replace a JSON file. Key order is preserved. */
export function atomicWriteJson(path: string, value: unknown, mode: number | null = null): void {
  atomicWriteText(path, JSON.stringify(value, null, 2), mode);
}

/** Read a JSON object, returning null when missing or malformed. */
export function readJsonObject(path: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function fileExists(path: string): boolean {
  try { statSync(path); return true; } catch { return false; }
}

export function deleteFile(path: string): boolean {
  try { unlinkSync(path); return true; } catch { return false; }
}
