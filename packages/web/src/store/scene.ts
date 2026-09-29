/**
 * Zustand store · JSON 单一数据源（SSOT）镜像
 *
 * 与 packages/scene-schema v0.1 严格对齐
 * 任何修改都触发 set → React 重渲染
 *
 * 关键设计：
 * - scene 是单一对象，整个 store 就这一个状态
 * - 操作都是 immutable · 用 spread 创建新对象
 * - stableStringify 用于 diff / hash
 */

import { create } from 'zustand';
import {
  emptyScene,
  SceneJSONSchema,
  stableStringify,
  SCENE_PRESET_INFO,
  ASPECT_RATIO_INFO,
  CAMERA_MOVE_TYPES,
  ACTOR_POSES,
  type SceneJSON,
  type Actor,
  type CameraKeyframe,
  type Vec3,
  type ActorPose,
  type ScenePreset,
  type AspectRatio,
} from '@director-stage/scene-schema';

export type { SceneJSON, Actor, CameraKeyframe, Vec3, ActorPose, ScenePreset, AspectRatio };

interface SceneState {
  scene: SceneJSON;
  /** 当前选中的物体 id（actor.id 或 camera keyframe 索引 "kf:0"）*/
  selectedId: string | null;
  /** 当前时间 t（秒）· 用于预览运镜 */
  previewT: number;
  /** 是否在播放 */
  playing: boolean;
  /** 错误信息（JSON 校验失败时显示）*/
  errors: Array<{ path: string; message: string }>;

  /**
   * 自由视角模式
   * - false（默认）：所见即所得 · previewT 决定 camera · OrbitControls 禁用
   * - true：用户用 OrbitControls 自由调视角 · Timeline playhead 暂停
   * 点 CaptureView 按钮存视角后自动切回 false
   */
  freeViewMode: boolean;

  // ─── 操作 ────────────────────────────────────────
  init: (preset: ScenePreset) => void;
  setScene: (s: SceneJSON) => void;
  loadJson: (raw: string) => boolean;

  setPreset: (preset: ScenePreset) => void;
  setAspect: (aspect: AspectRatio) => void;
  setDuration: (d: number) => void;

  addActor: (actor: Actor) => void;
  updateActor: (id: string, patch: Partial<Actor>) => void;
  removeActor: (id: string) => void;

  addKeyframe: () => void;
  updateKeyframe: (i: number, patch: Partial<CameraKeyframe>) => void;
  removeKeyframe: (i: number) => void;
  addKeyframeAtCurrentT: (override?: { pos?: Vec3; lookAt?: Vec3 | string }) => void;

  /** 一键应用 6 个运镜模板（替换现有 keyframes）*/
  applyCameraPreset: (presetId: CameraPresetId, options?: CameraPresetOptions) => void;

  select: (id: string | null) => void;
  setPreviewT: (t: number) => void;
  setPlaying: (p: boolean) => void;

  setFreeViewMode: (on: boolean) => void;

  /** 派生：序列化用于 hash / diff */
  hash: () => string;
  /** 派生：序列化为 JSON 字符串 */
  toJson: () => string;
}

export type CameraPresetId = 'push_in' | 'pull_out' | 'orbit' | 'crane_up' | 'tracking' | 'static';
export interface CameraPresetOptions {
  distance?: number;
  duration?: number;
  target?: Vec3;
}

export const useSceneStore = create<SceneState>((set, get) => ({
  scene: emptyScene('room_small'),
  selectedId: null,
  previewT: 0,
  playing: false,
  errors: [],

  freeViewMode: false,

  init: (preset) => {
    const s = emptyScene(preset);
    set({ scene: s, selectedId: null, previewT: 0, playing: false, errors: [] });
  },

  setScene: (s) => {
    const r = SceneJSONSchema.safeParse(s);
    set({
      scene: r.success ? r.data : s,
      errors: r.success ? [] : r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  },

  loadJson: (raw) => {
    try {
      const obj = JSON.parse(raw);
      const r = SceneJSONSchema.safeParse(obj);
      if (!r.success) {
        set({ errors: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
        return false;
      }
      set({ scene: r.data, errors: [] });
      return true;
    } catch (e) {
      set({ errors: [{ path: '$', message: `JSON parse failed: ${(e as Error).message}` }] });
      return false;
    }
  },

  setPreset: (preset) => {
    set((st) => {
      const size = SCENE_PRESET_INFO[preset].size;
      return { scene: { ...st.scene, scene: { preset, size } } };
    });
  },

  setAspect: (aspect) => {
    set((st) => ({ scene: { ...st.scene, aspect } }));
  },

  setDuration: (d) => {
    set((st) => {
      const newDuration = Math.max(1, Math.min(30, d));
      // 超出新 duration 的关键帧 t 截到边界 · 避免 schema 校验失败
      const clippedKfs = st.scene.camera.keyframes.map((kf) =>
        kf.t > newDuration ? { ...kf, t: newDuration } : kf
      );
      return {
        scene: {
          ...st.scene,
          duration: newDuration,
          camera: { ...st.scene.camera, keyframes: clippedKfs },
        },
      };
    });
  },

  addActor: (actor) => {
    set((st) => {
      // id 唯一性
      let id = actor.id;
      let n = 1;
      while (st.scene.actors.some((a) => a.id === id)) {
        id = `${actor.id}_${n++}`;
      }
      const newActor = { ...actor, id };
      return { scene: { ...st.scene, actors: [...st.scene.actors, newActor] } };
    });
  },

  updateActor: (id, patch) => {
    set((st) => ({
      scene: {
        ...st.scene,
        actors: st.scene.actors.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      },
    }));
  },

  removeActor: (id) => {
    set((st) => ({
      scene: {
        ...st.scene,
        actors: st.scene.actors.filter((a) => a.id !== id),
        camera: {
          ...st.scene.camera,
          keyframes: st.scene.camera.keyframes.map((kf) =>
            kf.lookAt === id ? { ...kf, lookAt: [0, 1.5, 0] } : kf,
          ),
        },
      },
      selectedId: st.selectedId === id ? null : st.selectedId,
    }));
  },

  addKeyframe: () => {
    set((st) => {
      const kfs = st.scene.camera.keyframes;
      const last = kfs[kfs.length - 1] ?? { t: 0, pos: [0, 1.6, 6], lookAt: [0, 1.5, 0] };
      const newT = Math.min(st.scene.duration, last.t + 1);
      const newKf: CameraKeyframe = {
        t: newT,
        pos: [last.pos[0] + 1, last.pos[1], last.pos[2]],
        lookAt: last.lookAt,
      };
      return { scene: { ...st.scene, camera: { ...st.scene.camera, keyframes: [...kfs, newKf] } } };
    });
  },

  updateKeyframe: (i, patch) => {
    set((st) => {
      const kfs = st.scene.camera.keyframes.map((kf, idx) => (idx === i ? { ...kf, ...patch } : kf));
      return { scene: { ...st.scene, camera: { ...st.scene.camera, keyframes: kfs } } };
    });
  },

  removeKeyframe: (i) => {
    set((st) => {
      if (st.scene.camera.keyframes.length <= 2) return st; // 最少 2 个
      const kfs = st.scene.camera.keyframes.filter((_, idx) => idx !== i);
      return { scene: { ...st.scene, camera: { ...st.scene.camera, keyframes: kfs } } };
    });
  },

  addKeyframeAtCurrentT: (override) => {
    set((st) => {
      const t = st.previewT;
      const pos = override?.pos ?? st.scene.camera.keyframes[st.scene.camera.keyframes.length - 1]?.pos ?? [0, 1.6, 6];
      const lookAt = override?.lookAt ?? st.scene.camera.keyframes[0]?.lookAt ?? [0, 1.5, 0];
      const kfs = st.scene.camera.keyframes;
      // 检查同 t 是否已有关键帧
      const existingIdx = kfs.findIndex((k) => Math.abs(k.t - t) < 0.1);
      if (existingIdx >= 0) {
        // 覆盖现有
        const newKfs = [...kfs];
        newKfs[existingIdx] = { ...newKfs[existingIdx], pos, lookAt };
        return { scene: { ...st.scene, camera: { ...st.scene.camera, keyframes: newKfs } } };
      }
      // 新增 · 按时间排序
      const newKf: CameraKeyframe = {
        t,
        pos,
        lookAt,
      };
      const newKfs = [...kfs, newKf].sort((a, b) => a.t - b.t);
      return { scene: { ...st.scene, camera: { ...st.scene.camera, keyframes: newKfs } } };
    });
  },

  applyCameraPreset: (presetId, options) => {
    set((st) => {
      const distance = options?.distance ?? 4;
      const target = options?.target ?? [0, 1.5, 0];
      const duration = options?.duration ?? Math.max(3, st.scene.duration);

      const startPos: Vec3 = st.scene.camera.keyframes[0]?.pos ?? [0, 1.6, 6];
      let endPos: Vec3 = startPos;
      switch (presetId) {
        case 'push_in':
          endPos = [startPos[0], startPos[1], startPos[2] - distance];
          break;
        case 'pull_out':
          endPos = [startPos[0], startPos[1], startPos[2] + distance];
          break;
        case 'orbit':
          // 绕 target 旋转 180°
          endPos = [
            2 * target[0] - startPos[0],
            startPos[1],
            2 * target[2] - startPos[2],
          ];
          break;
        case 'crane_up':
          endPos = [startPos[0], startPos[1] + distance, startPos[2]];
          break;
        case 'tracking':
          endPos = [startPos[0] + distance, startPos[1], startPos[2]];
          break;
        case 'static':
          // 保留现有 · 不改
          return st;
      }
      return {
        scene: {
          ...st.scene,
          camera: {
            ...st.scene.camera,
            keyframes: [
              { t: 0, pos: startPos, lookAt: target, ease: 'easeInOut' },
              { t: duration, pos: endPos, lookAt: target, ease: 'easeInOut' },
            ],
          },
        },
      };
    });
  },

  select: (id) => set({ selectedId: id }),
  setPreviewT: (t) => set({ previewT: t }),
  setPlaying: (p) => set({ playing: p }),

  setFreeViewMode: (on) => set({ freeViewMode: on }),

  hash: () => stableStringify(get().scene),
  toJson: () => JSON.stringify(get().scene, null, 2),
}));

// 暴露静态常量（用于 UI 下拉）
export const PRESET_LIST = Object.entries(SCENE_PRESET_INFO).map(([id, info]) => ({ id, ...info })) as Array<{
  id: ScenePreset;
  label: string;
  size: Vec3;
}>;

export const ASPECT_LIST = Object.entries(ASPECT_RATIO_INFO).map(([id, info]) => ({ id: id as AspectRatio, ...info }));

export const POSE_LIST = ACTOR_POSES;

export const CAMERA_MOVE_PRESETS = CAMERA_MOVE_TYPES;