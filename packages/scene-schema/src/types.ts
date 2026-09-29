/**
 * @director-stage/scene-schema · v0.1
 *
 * TypeScript 类型 · 与 Zod schema 一一对应 · 不可二改一处不同步。
 *
 * 关键设计：
 * - lookAt 支持 label 引用（"A"）或原始坐标 [x, y, z]
 *   角色移动时镜头自动跟上是产品差异化
 * - 坐标统一米 · Y 轴向上 · Z 轴朝向相机
 * - 所有时间单位统一秒（避免毫秒 / 秒混用）
 */

import type {
  AspectRatio,
  ActorPose,
  EaseType,
  ScenePreset,
} from './constants.js';

// Re-export Zod 的 input/output 类型（从 schema 层导出）
export type { SceneJSONInput, SceneJSONOutput } from './schema.js';

// ─── 基础类型 ─────────────────────────────────────────
export type Vec3 = [number, number, number];

/**
 * LookAt 目标
 * - string: 引用 actor 的 id（推荐）
 * - Vec3: 原始坐标（用于看场景固定点）
 */
export type LookAtTarget = string | Vec3;

// ─── Actor ────────────────────────────────────────────
export interface ActorMove {
  /** 终点坐标（米） */
  to: Vec3;
  /** 起始时间（秒） */
  t0: number;
  /** 结束时间（秒） */
  t1: number;
  /** 移动期间用什么姿势 */
  pose: ActorPose;
}

export interface Actor {
  /** 唯一标识 · 用于 camera.lookAt 引用 */
  id: string;
  /** 导演可读的标签（"男主"/"反派"/"椅子"） */
  label: string;
  /** 渲染颜色 HEX #RRGGBB（粗略视频用纯色区分） */
  color: string;
  /** 初始位置（米） */
  start: Vec3;
  /** 朝向向量 · 默认 [0, 0, 1] */
  facing?: Vec3;
  /** 初始姿势 */
  pose: ActorPose;
  /** 动作序列 · 按时间排序 */
  moves?: ActorMove[];
}

// ─── Camera ───────────────────────────────────────────
export interface CameraKeyframe {
  /** 关键帧时间（秒） */
  t: number;
  /** 相机位置（米） */
  pos: Vec3;
  /** 看向目标：actor.id 引用 or 坐标 */
  lookAt: LookAtTarget;
  /** 缓动函数（从此关键帧到下一个关键帧之间） */
  ease?: EaseType;
}

export interface Camera {
  /** FOV 视角（度） */
  fov: number;
  /** 关键帧序列 · 按时间排序 · 至少 2 个 */
  keyframes: CameraKeyframe[];
}

// ─── Scene Settings ───────────────────────────────────
export interface SceneSettings {
  /** 场景预设 · 决定默认几何布局 */
  preset: ScenePreset;
  /** 包围盒尺寸 [宽, 高, 深]（米） */
  size: Vec3;
}

// ─── 顶层 ─────────────────────────────────────────────
export interface SceneJSON {
  /** Schema 版本 · 便于迁移 */
  version: '0.1';
  /** 场景设置 */
  scene: SceneSettings;
  /** 角色列表 */
  actors: Actor[];
  /** 相机运镜 */
  camera: Camera;
  /** 总时长（秒） · 1-30 硬约束 */
  duration: number;
  /** 帧率 */
  fps: 24 | 30 | 60;
  /** 画面比例 */
  aspect: AspectRatio;
}