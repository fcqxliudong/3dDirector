/**
 * @director-stage/scene-schema · v0.1
 *
 * 工具函数
 */

import { ZodError } from 'zod';
import { SceneJSONSchema } from './schema.js';
import type { SceneJSON } from './types.js';

/**
 * 严格校验 · 失败抛 ZodError
 */
export function parseScene(input: unknown): SceneJSON {
  return SceneJSONSchema.parse(input);
}

/**
 * 安全校验 · 失败不抛
 */
export function safeParseScene(input: unknown):
  | { ok: true; data: SceneJSON }
  | { ok: false; error: ZodError } {
  const result = SceneJSONSchema.safeParse(input);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, error: result.error };
}

/**
 * 稳定序列化（key 排序）· 用于 hash / diff
 *
 * 避免 JSON.stringify 的 key 顺序不确定性导致同样内容产生不同字符串
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep(obj[key]);
        return acc;
      }, {});
  }
  return value;
}