/**
 * @director-stage/scene-schema · v0.1
 *
 * 默认场景工厂 · 给导演一个"打开就能用"的起点
 *
 * 设计原则：
 * - 默认值必须 self-validate（直接过 SceneJSONSchema 校验）
 * - 不带演员预设（导演用对话加）
 * - 2 个相机关键帧（起始 + 结束）满足硬约束
 */

import { SCHEMA_VERSION, FPS_DEFAULT, SCENE_PRESET_INFO } from './constants.js';
import type { SceneJSON } from './types.js';

/**
 * 创建一个空场景
 * @param preset 场景预设 · 决定默认 size
 * @param duration 可选 · 外部传入的时长（默认 10s）· 尾帧关键帧 t 自动跟到最后一秒
 * @returns 合法 SceneJSON
 *
 * 设计要点：
 * - 第二个关键帧 t === duration（不是 hardcoded 5）
 * - 未来从 URL / Agent / 后端接收 duration 时，emptyScene(preset, duration) 直接联动
 * - 调用方不传 duration → 默认 10s（旧调用方 zero-cost 兼容）
 */
export function emptyScene(
  preset: keyof typeof SCENE_PRESET_INFO = 'room_small',
  durationOpt?: number,
): SceneJSON {
  const info = SCENE_PRESET_INFO[preset];
  const duration = durationOpt ?? 10;
  return {
    version: SCHEMA_VERSION,
    scene: {
      preset,
      size: info.size,
    },
    actors: [],
    camera: {
      fov: 35,
      keyframes: [
        {
          t: 0,
          pos: [0, 1.6, 6],
          lookAt: [0, 1.5, 0],
        },
        {
          t: duration,
          pos: [0, 1.5, 3],
          lookAt: [0, 1.5, 0],
          ease: 'easeInOut',
        },
      ],
    },
    duration,
    fps: FPS_DEFAULT,
    aspect: '16:9',
  };
}

/**
 * 创建一个角色（默认值版）
 */
export function makeActor(
  partial: Partial<import('./types.js').Actor> & {
    id: string;
    label: string;
    start: [number, number, number];
  },
): import('./types.js').Actor {
  return {
    color: '#888888',
    pose: 'stand',
    facing: [0, 0, 1],
    ...partial,
  };
}