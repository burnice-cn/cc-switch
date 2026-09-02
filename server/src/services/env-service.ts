/**
 * 环境变量冲突检测与管理。
 *
 * 与桌面版保持一致：按应用匹配进程环境和常见 shell 配置文件中的导出项；
 * 删除前先写入 JSON 备份。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface EnvConflict {
  varName: string;
  varValue: string;
  sourceType: "system" | "file";
  sourcePath: string;
}

export interface EnvBackup {
  backupPath: string;
  timestamp: string;
  conflicts: EnvConflict[];
}

type EnvKeyword =
  | { type: "exact"; name: string }
  | { type: "prefix"; name: string };

function keywordsForApp(app: string): EnvKeyword[] {
  switch (app.toLowerCase()) {
    case "claude":
      return [{ type: "prefix", name: "ANTHROPIC" }];
    case "codex":
      return [{ type: "prefix", name: "OPENAI" }];
    case "gemini":
      return [
        { type: "prefix", name: "GEMINI" },
        { type: "prefix", name: "GOOGLE_GEMINI" },
      ];
    case "grokbuild":
    case "grok":
      return [
        { type: "exact", name: "XAI_API_KEY" },
        { type: "exact", name: "GROK_DEFAULT_MODEL" },
      ];
    default:
      return [];
  }
}

function matchesKeyword(name: string, keywords: EnvKeyword[]): boolean {
  const upperName = name.toUpperCase();
  return keywords.some((keyword) =>
    keyword.type === "exact"
      ? upperName === keyword.name
      : upperName.startsWith(keyword.name),
  );
}

/** 应用关键字与桌面版一致；`grok` 是 `grokbuild` 的兼容别名。 */
export function checkEnvConflicts(app: string): EnvConflict[] {
  const keywords = keywordsForApp(app);
  if (keywords.length === 0) return [];

  const conflicts = new Map<string, EnvConflict>();

  for (const [varName, varValue] of Object.entries(process.env)) {
    if (varValue === undefined || !matchesKeyword(varName, keywords)) continue;
    conflicts.set(`${varName}:Process Environment`, {
      varName,
      varValue,
      sourceType: "system",
      sourcePath: "Process Environment",
    });
  }

  const home = process.env.HOME ?? homedir();
  const configFiles: [string, number][] = [
    [join(home, ".bashrc"), 0],
    [join(home, ".bash_profile"), 0],
    [join(home, ".zshrc"), 0],
    [join(home, ".zprofile"), 0],
    [join(home, ".profile"), 0],
    ["/etc/profile", 1],
    ["/etc/bashrc", 1],
  ];

  for (const [filePath, lineOffset] of configFiles) {
    if (!existsSync(filePath)) continue;
    try {
      const content = readFileSync(filePath, "utf8");
      content.split(/\r?\n/).forEach((rawLine, fileLineIndex) => {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) return;

        const exportLine = line.startsWith("export ")
          ? line.slice(7).trim()
          : line;
        const eqIndex = exportLine.indexOf("=");
        if (eqIndex <= 0) return;

        const varName = exportLine.slice(0, eqIndex).trim();
        if (!matchesKeyword(varName, keywords)) return;

        const varValue = exportLine
          .slice(eqIndex + 1)
          .trim()
          .replace(/^(['"])([\s\S]*)\1$/, "$2");

        const lineNumber = fileLineIndex + lineOffset + 1;
        conflicts.set(`${varName}:${filePath}:${lineNumber}`, {
          varName,
          varValue,
          sourceType: "file",
          sourcePath: `${filePath}:${lineNumber}`,
        });
      });
    } catch {
      // 无权限读取的配置文件不应影响其他来源检查。
    }
  }

  return [...conflicts.values()];
}

function parseSourcePath(sourcePath: string): { path: string; line?: number } {
  const lastSeparator = sourcePath.lastIndexOf(":");
  const lineText = sourcePath.slice(lastSeparator + 1);
  if (lastSeparator === -1 || !/^\d+$/.test(lineText)) {
    return { path: sourcePath };
  }
  return {
    path: sourcePath.slice(0, lastSeparator),
    line: Number.parseInt(lineText, 10),
  };
}

function backupDir(): string {
  return join(homedir(), ".cc-switch", "backups");
}

function createEnvBackup(conflicts: EnvConflict[]): EnvBackup {
  mkdirSync(backupDir(), { recursive: true });
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "_");
  const backupPath = join(backupDir(), `env-backup-${timestamp}.json`);
  const backup: EnvBackup = { backupPath, timestamp, conflicts };

  writeFileSync(backupPath, `${JSON.stringify(backup, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return backup;
}

function editedFilePaths(conflicts: EnvConflict[]): Set<string> {
  return new Set(
    conflicts
      .filter((conflict) => conflict.sourceType === "file")
      .map((conflict) => parseSourcePath(conflict.sourcePath).path),
  );
}

/** 删除配置文件行后移除文件末尾产生的连续空行，避免 shell 配置被逐渐拉长。 */
function trimTrailingBlankLines(filePath: string): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  let endIndex = lines.length;
  while (endIndex > 0 && lines[endIndex - 1].trim() === "") {
    endIndex -= 1;
  }
  if (endIndex === lines.length) return;

  const nextContent = `${lines.slice(0, endIndex).join("\n")}\n`;
  if (nextContent !== content) {
    writeFileSync(filePath, nextContent, "utf8");
  }
}

export function deleteEnvVars(conflicts: EnvConflict[]): EnvBackup {
  const backup = createEnvBackup(conflicts);

  try {
    for (const conflict of conflicts) {
      if (conflict.sourceType !== "file") continue;

      const { path: filePath, line } = parseSourcePath(conflict.sourcePath);
      if (line === undefined) {
        throw new Error(`无效的来源路径: ${conflict.sourcePath}`);
      }

      const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
      const targetIndex = line - 1;
      const targetLine = lines[targetIndex]?.trim() ?? "";
      const exportLine = targetLine.startsWith("export ")
        ? targetLine.slice(7).trim()
        : targetLine;
      const eqIndex = exportLine.indexOf("=");
      const varName = eqIndex === -1 ? "" : exportLine.slice(0, eqIndex).trim();

      if (varName !== conflict.varName) {
        throw new Error(
          `环境变量已变化，删除失败: ${conflict.varName} (${conflict.sourcePath})`,
        );
      }

      lines.splice(targetIndex, 1);
      writeFileSync(filePath, lines.join("\n"), "utf8");
    }
  } finally {
    for (const filePath of editedFilePaths(conflicts)) {
      trimTrailingBlankLines(filePath);
    }
  }

  return backup;
}

export function restoreEnvBackup(backupPath: string): void {
  if (!backupPath.startsWith(backupDir())) {
    throw new Error("只允许恢复 CC Switch 生成的环境变量备份");
  }

  const backup = JSON.parse(readFileSync(backupPath, "utf8")) as EnvBackup;
  if (!Array.isArray(backup.conflicts)) {
    throw new Error("备份文件格式无效");
  }

  for (const conflict of backup.conflicts) {
    if (conflict.sourceType !== "file") continue;

    const { path: filePath, line } = parseSourcePath(conflict.sourcePath);
    if (line === undefined) {
      throw new Error(`无效的备份来源路径: ${conflict.sourcePath}`);
    }

    let content = readFileSync(filePath, "utf8");
    if (!content.endsWith("\n")) content += "\n";
    content += `export ${conflict.varName}=${conflict.varValue}\n`;
    writeFileSync(filePath, content, "utf8");
  }
}
