/**
 * @director-stage/scene-schema · v0.1
 *
 * Zod 校验层 · 与 types.ts 一一对应
 *
 * 校验关键点：
 * 1. duration 硬约束 1-30s（用户给的硬约束）
 * 2. aspect 必须是 8 个合法枚举值之一
 * 3. actor.id 全局唯一（不能有重复）
 * 4. camera.keyframes 至少 2 个 · 时间必须单调递增
 * 5. camera.lookAt 引用 actor.id 时必须存在（cross-reference）
 * 6. actor.moves 的 t0 < t1 · 同一 actor 内 moves 不重叠
 * 7. color 必须是合法 HEX
 */

import { z } from 'zod';
import {
  SCHEMA_VERSION,
  DURATION_MIN,
  DURATION_MAX,
  ASPECT_RATIOS,
  ACTOR_POSES,
  EASE_TYPES,
  SCENE_PRESETS,
  SCENE_LIMITS,
} from './constants.js';

// ─── 基础原子 ─────────────────────────────────────────
const Vec3Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'color 必须是 #RRGGBB 格式 HEX');

// ─── LookAt ───────────────────────────────────────────
const LookAtTargetSchema = z.union([
  z.string().min(1),
  Vec3Schema,
]);

// ─── Actor ────────────────────────────────────────────
const ActorMoveSchema = z
  .object({
    to: Vec3Schema,
    t0: z.number().min(0),
    t1: z.number().min(0),
    pose: z.enum(ACTOR_POSES),
  })
  .refine((m) => m.t0 < m.t1, {
    message: 'move.t0 必须 < t1',
  });

/** Actor 关键帧 · 替代 moves 的统一走位方案 */
const ActorKeyframeSchema = z.object({
  t: z.number().min(0),
  pos: Vec3Schema,
  facing: Vec3Schema.optional(),
  scale: Vec3Schema.optional(),
  pose: z.enum(ACTOR_POSES).optional(),
  ease: z.enum(EASE_TYPES).optional(),
});

const ActorSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    color: HexColorSchema,
    /** 关键帧轨道 · 至少 1 个 · 推荐 t=0 起步 · 兼容旧场景可选 */
    keyframes: z.array(ActorKeyframeSchema).min(0).max(100).optional(),
    /** Actor 整体默认缩放 · 默认 [1,1,1] */
    scale: Vec3Schema.optional(),
    // ── 兼容旧版 ──
    start: Vec3Schema.optional(),
    facing: Vec3Schema.optional(),
    pose: z.enum(ACTOR_POSES).optional(),
    moves: z.array(ActorMoveSchema).max(20).optional(),
  })
  .refine(
    (a) => {
      // 同一 actor 内 moves 不能时间重叠
      if (!a.moves || a.moves.length < 2) return true;
      const sorted = [...a.moves].sort((x, y) => x.t0 - y.t0);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].t0 < sorted[i - 1].t1) return false;
      }
      return true;
    },
    { message: '同一 actor 的 moves 不能时间重叠' },
  )
  .refine(
    (a) => {
      // actor.keyframes 时间单调非递减
      if (!a.keyframes || a.keyframes.length < 2) return true;
      const sorted = [...a.keyframes].sort((x, y) => x.t - y.t);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].t < sorted[i - 1].t - 0.001) return false;
      }
      return true;
    },
    { message: '同一 actor 的 keyframes 时间必须单调非递减' },
  );

// ─── Camera ───────────────────────────────────────────
const CameraKeyframeSchema = z.object({
  t: z.number().min(0),
  pos: Vec3Schema,
  lookAt: LookAtTargetSchema,
  ease: z.enum(EASE_TYPES).optional(),
});

const CameraSchema = z
  .object({
    fov: z
      .number()
      .min(SCENE_LIMITS.CAMERA_FOV_MIN)
      .max(SCENE_LIMITS.CAMERA_FOV_MAX),
    keyframes: z
      .array(CameraKeyframeSchema)
      .min(SCENE_LIMITS.CAMERA_KEYFRAMES_MIN)
      .max(SCENE_LIMITS.CAMERA_KEYFRAMES_MAX)
      .refine(
        (kfs) => kfs.every((k, i) => i === 0 || k.t >= kfs[i - 1].t),
        { message: 'keyframes 时间必须单调非递减' },
      ),
  });

// ─── Env prop（开放空间几何） ─────────────────────────
const EnvPropSchema = z.object({
  id: z.string().min(1).max(32),
  kind: z.enum(['ground', 'box', 'cyl', 'cone', 'wall']),
  pos: Vec3Schema,
  size: Vec3Schema.refine(
    ([w, h, d]) => w > 0 && h > 0 && d > 0,
    { message: 'env.size 三维必须 > 0' },
  ),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'color 必须是 #RRGGBB')
    .optional(),
  rot: Vec3Schema.optional(),
});

// ─── Scene Settings ───────────────────────────────────
const SceneSettingsSchema = z.object({
  /** 兼容字段；渲染不再套模板，统一按 size + env */
  preset: z.enum(SCENE_PRESETS),
  size: Vec3Schema.refine(
    ([w, h, d]) => w > 0 && h > 0 && d > 0,
    { message: 'scene.size 三维必须 > 0' },
  ),
  env: z.array(EnvPropSchema).max(SCENE_LIMITS.ENV_PROPS_MAX).optional(),
});

// ─── 顶层 SceneJSON ───────────────────────────────────
export const SceneJSONSchema = z
  .object({
    version: z.literal(SCHEMA_VERSION),
    scene: SceneSettingsSchema,
    actors: z
      .array(ActorSchema)
      .max(SCENE_LIMITS.ACTORS_MAX)
      .refine(
        (actors) => {
          const ids = actors.map((a) => a.id);
          return new Set(ids).size === ids.length;
        },
        { message: 'actor.id 必须全局唯一' },
      ),
    camera: CameraSchema,
    duration: z
      .number()
      .min(DURATION_MIN)
      .max(DURATION_MAX), // 硬约束 1-30s
    fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
    aspect: z.enum(ASPECT_RATIOS),
  })
  .superRefine((json, ctx) => {
    // 跨字段：camera.lookAt 引用的 actor.id 必须存在
    const actorIds = new Set(json.actors.map((a) => a.id));
    json.camera.keyframes.forEach((kf, i) => {
      if (typeof kf.lookAt === 'string' && !actorIds.has(kf.lookAt)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['camera', 'keyframes', i, 'lookAt'],
          message: `camera.keyframes[${i}].lookAt 引用了不存在的 actor.id="${kf.lookAt}"`,
        });
      }
    });

    // 跨字段：所有 camera.keyframes 的 t 必须 <= duration
    json.camera.keyframes.forEach((kf, i) => {
      if (kf.t > json.duration) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['camera', 'keyframes', i, 't'],
          message: `camera.keyframes[${i}].t(${kf.t}) 不能超过 duration(${json.duration})`,
        });
      }
    });

    // 跨字段：所有 actor.keyframes 的 t 必须 <= duration
    json.actors.forEach((actor, ai) => {
      if (!actor.keyframes) return;
      actor.keyframes.forEach((kf, ki) => {
        if (kf.t > json.duration) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['actors', ai, 'keyframes', ki, 't'],
            message: `actors[${ai}].keyframes[${ki}].t(${kf.t}) 不能超过 duration(${json.duration})`,
          });
        }
      });
    });
  });

// ─── 宽松版本：用于 LLM 生成时的中间态 ────────────────
// LLM 经常生成"看起来合理但不完全合法"的 JSON，这里给个宽松入口，
// 让上层应用可以选择"严格拒绝"还是"自动修复"
export const SceneJSONLooseSchema = z.object({
  version: z.string().optional(),
  scene: z
    .object({
      preset: z.string(),
      size: z.array(z.number()),
      env: z.array(z.object({}).passthrough()).optional(),
    })
    .passthrough(),
  actors: z.array(z.object({}).passthrough()),
  camera: z.object({}).passthrough(),
  duration: z.number(),
  fps: z.number().optional(),
  aspect: z.string(),
});

// ─── 类型导出（再导一次方便） ─────────────────────────
export type SceneJSONInput = z.input<typeof SceneJSONSchema>;
export type SceneJSONOutput = z.output<typeof SceneJSONSchema>;