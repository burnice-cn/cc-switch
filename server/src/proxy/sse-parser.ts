/**
 * SSE 解析器 — 对应 Rust 端 proxy/sse.rs
 * 解析 Server-Sent Events 流，提取 usage 数据
 */
import { Transform } from "node:stream";

export interface SseEvent {
  event?: string;
  data: string;
}

export interface SseUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** SSE 流解析 Transform */
export class SseParser extends Transform {
  private buffer = "";

  _transform(chunk: Buffer, _enc: string, callback: () => void) {
    this.buffer += chunk.toString("utf-8");
    const blocks = this.buffer.split("\n\n");
    this.buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      if (block.trim()) {
        const parsed = this.parseBlock(block);
        if (parsed) this.push(parsed);
      }
    }
    callback();
  }

  _flush(callback: () => void) {
    if (this.buffer.trim()) {
      const parsed = this.parseBlock(this.buffer);
      if (parsed) this.push(parsed);
      this.buffer = "";
    }
    callback();
  }

  private parseBlock(block: string): string | null {
    return block;
  }

  /** 静态方法：解析 SSE 事件 */
  static parseBlock(block: string): SseEvent | null {
    const lines = block.split("\n");
    const event: SseEvent = { data: "" };
    let hasData = false;

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        event.data += line.slice(6);
        hasData = true;
      } else if (line.startsWith("event: ")) {
        event.event = line.slice(7);
      }
    }

    return hasData ? event : null;
  }

  /** 从 SSE 数据中提取 usage */
  static extractUsage(data: string): SseUsage | null {
    try {
      const json = JSON.parse(data);

      // Claude format
      if (json.usage) {
        return {
          inputTokens: json.usage.input_tokens ?? 0,
          outputTokens: json.usage.output_tokens ?? 0,
          cacheReadTokens: json.usage.cache_read_input_tokens ?? 0,
          cacheCreationTokens: json.usage.cache_creation_input_tokens ?? 0,
        };
      }

      // OpenAI format
      if (json.usage?.prompt_tokens !== undefined) {
        return {
          inputTokens: json.usage.prompt_tokens ?? 0,
          outputTokens: json.usage.completion_tokens ?? 0,
          cacheReadTokens: json.usage.cache_read_tokens ?? 0,
          cacheCreationTokens: json.usage.cache_creation_tokens ?? 0,
        };
      }

      return null;
    } catch {
      return null;
    }
  }
}
