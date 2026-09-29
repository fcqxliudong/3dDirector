/**
 * @director-stage/scene-schema · v0.1
 *
 * 公共入口 · 统一导出
 *
 * 用法：
 * ```ts
 * import {
 *   SceneJSONSchema,        // Zod 校验
 *   emptyScene,                  // 工厂函数
 *   ASPECT_RATIOS,              // 枚举常量
 *   type SceneJSON,             // TypeScript 类型
 * } from '@director-stage/scene-schema';
 *
 * // 校验外部 JSON
 * const result = SceneJSONSchema.safeParse(json);
 *
 * // 创建空场景
 * const scene = emptyScene('corridor');
 * ```
 */

// 枚举常量
export * from './constants.js';

// TypeScript 类型
export type {
  Vec3,
  LookAtTarget,
  ActorMove,
  Actor,
  CameraKeyframe,
  Camera,
  SceneSettings,
  SceneJSON,
  SceneJSONInput,
  SceneJSONOutput,
} from './types.js';

// Zod schema
export { SceneJSONSchema, SceneJSONLooseSchema } from './schema.js';

// 默认值工厂
export { emptyScene, makeActor } from './defaults.js';

// 工具函数
export {
  /**
   * 校验并规范化 JSON
   * @throws ZodError 如果校验失败
   */
  parseScene,
  /**
   * 安全校验（不抛错）· 返回 { ok, data?, error? }
   */
  safeParseScene,
  /**
   * 把 scene JSON 序列化为稳定的字符串（key 排序）· 用于 hash / diff
   */
  stableStringify,
} from './utils.js';