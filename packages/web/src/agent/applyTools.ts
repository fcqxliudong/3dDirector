/**
 * 把助手返回的 tool_calls 落到 zustand scene store
 */

import { useSceneStore, type CameraPresetId } from '../store/scene';
import type {
  Actor,
  ActorMove,
  ActorPose,
  AspectRatio,
  CameraKeyframe,
  EaseType,
  SceneJSON,
  ScenePreset,
  Vec3,
} from '@director-stage/scene-schema';

export interface AgentToolCall {
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  function?: { name?: string; arguments?: string | Record<string, unknown> };
}

export interface ToolApplyResult {
  id: string;
  name: string;
  ok: boolean;
  summary: string;
  error?: string;
}

const ASPECTS = new Set(['2.76:1', '2.39:1', '2.00:1', '1.85:1', '16:9', '4:3', '9:16', '1:1']);
const POSES = new Set(['stand', 'walk', 'run', 'sit', 'crouch', 'idle']);
const PRESETS = new Set(['open', 'room_small', 'corridor', 'street', 'forest', 'space']);
const EASES = new Set(['linear', 'easeIn', 'easeOut', 'easeInOut']);
const CAM_PRESETS = new Set(['push_in', 'pull_out', 'orbit', 'crane_up', 'tracking', 'static']);
const FPS = new Set([24, 30, 60]);

function asVec3(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const a = v.map((n) => Number(n));
  if (a.some((n) => !Number.isFinite(n))) return null;
  return [a[0], a[1], a[2]];
}

function asLookAt(v: unknown): string | Vec3 | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  return asVec3(v);
}

function asHex(v: unknown): string | null {
  const s = String(v || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
}

function toolName(tc: AgentToolCall): string {
  return String(tc.name || tc.function?.name || '').trim();
}

function toolArgs(tc: AgentToolCall): Record<string, unknown> {
  if (tc.arguments && typeof tc.arguments === 'object' && !Array.isArray(tc.arguments)) {
    return tc.arguments;
  }
  const raw = tc.function?.arguments;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
    } catch {
      return {};
    }
  }
  return {};
}

function toolId(tc: AgentToolCall, i: number): string {
  return String(tc.id || `call_${i}`);
}

function applyOne(name: string, args: Record<string, unknown>): { ok: boolean; summary: string; error?: string } {
  const store = useSceneStore.getState();

  switch (name) {
    case 'set_preset': {
      // 兼容旧工具：只取尺寸，落到 open 地面
      const preset = String(args.preset || 'open');
      store.setPreset((PRESETS.has(preset) ? preset : 'open') as ScenePreset);
      return { ok: true, summary: `空间尺寸（兼容 preset）→ ${preset}` };
    }
    case 'set_scene_size': {
      const size = asVec3(args.size);
      if (!size) return { ok: false, summary: '', error: 'size 必须是 [w,h,d]' };
      store.setSceneSize(size);
      return { ok: true, summary: `空间尺寸 → [${size.map((n) => Math.round(n * 10) / 10).join(', ')}]` };
    }
    case 'set_env': {
      const raw = args.env;
      if (!Array.isArray(raw)) return { ok: false, summary: '', error: 'env 必须是数组' };
      const env: import('@director-stage/scene-schema').EnvProp[] = [];
      for (const item of raw.slice(0, 40)) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const id = String(o.id || '').trim();
        const kind = String(o.kind || 'box');
        if (!id) continue;
        if (!['ground', 'box', 'cyl', 'cone', 'wall'].includes(kind)) continue;
        const pos = asVec3(o.pos) || [0, 0, 0];
        const size = asVec3(o.size) || [1, 1, 1];
        const color = asHex(o.color) || undefined;
        const rot = asVec3(o.rot) || undefined;
        env.push({
          id,
          kind: kind as 'ground' | 'box' | 'cyl' | 'cone' | 'wall',
          pos,
          size,
          ...(color ? { color } : {}),
          ...(rot ? { rot } : {}),
        });
      }
      store.setEnv(env);
      return { ok: true, summary: `环境几何 → ${env.length} 件（无天花板）` };
    }
    case 'set_aspect': {
      const aspect = String(args.aspect || '');
      if (!ASPECTS.has(aspect)) return { ok: false, summary: '', error: '非法 aspect' };
      store.setAspect(aspect as AspectRatio);
      return { ok: true, summary: `画面比例 → ${aspect}` };
    }
    case 'set_duration': {
      const d = Number(args.duration);
      if (!Number.isFinite(d)) return { ok: false, summary: '', error: 'duration 非法' };
      store.setDuration(d);
      return { ok: true, summary: `时长 → ${Math.max(1, Math.min(30, Math.round(d)))}s` };
    }
    case 'set_fps': {
      const fps = Number(args.fps);
      if (!FPS.has(fps)) return { ok: false, summary: '', error: 'fps 非法' };
      store.setScene({ ...store.scene, fps: fps as 24 | 30 | 60 });
      return { ok: true, summary: `帧率 → ${fps}` };
    }
    case 'add_actor': {
      const id = String(args.id || '').trim();
      const label = String(args.label || id || '角色').trim();
      const color = asHex(args.color) || '#e74c3c';
      const start = asVec3(args.start) || [0, 0, 0];
      const pose = String(args.pose || 'stand');
      if (!id) return { ok: false, summary: '', error: '缺少 actor.id' };
      if (!POSES.has(pose)) return { ok: false, summary: '', error: '非法 pose' };
      const actor: Actor = {
        id,
        label,
        color,
        start,
        pose: pose as ActorPose,
      };
      const facing = asVec3(args.facing);
      if (facing) actor.facing = facing;
      store.addActor(actor);
      store.select(id);
      return { ok: true, summary: `添加角色 ${label} (${id}) @ [${start.join(', ')}]` };
    }
    case 'update_actor': {
      const id = String(args.id || '').trim();
      if (!id) return { ok: false, summary: '', error: '缺少 id' };
      if (!store.scene.actors.some((a) => a.id === id)) {
        return { ok: false, summary: '', error: `角色不存在: ${id}` };
      }
      const patch: Partial<Actor> = {};
      if (args.label != null) patch.label = String(args.label);
      const color = asHex(args.color);
      if (color) patch.color = color;
      const start = asVec3(args.start);
      if (start) patch.start = start;
      const facing = asVec3(args.facing);
      if (facing) patch.facing = facing;
      if (args.pose != null) {
        const pose = String(args.pose);
        if (!POSES.has(pose)) return { ok: false, summary: '', error: '非法 pose' };
        patch.pose = pose as ActorPose;
      }
      store.updateActor(id, patch);
      store.select(id);
      const bits = Object.keys(patch);
      return { ok: true, summary: `更新角色 ${id}（${bits.join(', ') || '无字段'}）` };
    }
    case 'set_actor_moves': {
      const id = String(args.id || '').trim();
      if (!id) return { ok: false, summary: '', error: '缺少 id' };
      if (!store.scene.actors.some((a) => a.id === id)) {
        return { ok: false, summary: '', error: `角色不存在: ${id}` };
      }
      const rawMoves = Array.isArray(args.moves) ? args.moves : [];
      const moves: ActorMove[] = [];
      for (const m of rawMoves) {
        if (!m || typeof m !== 'object') continue;
        const row = m as Record<string, unknown>;
        const to = asVec3(row.to);
        const t0 = Number(row.t0);
        const t1 = Number(row.t1);
        const pose = String(row.pose || 'walk');
        if (!to || !Number.isFinite(t0) || !Number.isFinite(t1) || t0 >= t1 || !POSES.has(pose)) continue;
        moves.push({ to, t0, t1, pose: pose as ActorPose });
      }
      store.updateActor(id, { moves });
      store.select(id);
      return { ok: true, summary: `角色 ${id} 移动段 ×${moves.length}` };
    }
    case 'remove_actor': {
      const id = String(args.id || '').trim();
      if (!id) return { ok: false, summary: '', error: '缺少 id' };
      store.removeActor(id);
      return { ok: true, summary: `删除角色 ${id}` };
    }
    case 'select_actor': {
      const id = String(args.id || '').trim();
      if (!id) return { ok: false, summary: '', error: '缺少 id' };
      store.select(id);
      return { ok: true, summary: `选中 ${id}` };
    }
    case 'set_camera_fov': {
      const fov = Number(args.fov);
      if (!Number.isFinite(fov) || fov < 10 || fov > 120) {
        return { ok: false, summary: '', error: 'fov 非法' };
      }
      store.setScene({
        ...store.scene,
        camera: { ...store.scene.camera, fov },
      });
      return { ok: true, summary: `FOV → ${fov}` };
    }
    case 'add_camera_keyframe': {
      const t = Number(args.t);
      const pos = asVec3(args.pos);
      const lookAt = asLookAt(args.lookAt);
      if (!Number.isFinite(t) || !pos || !lookAt) {
        return { ok: false, summary: '', error: '关键帧参数不完整' };
      }
      const kf: CameraKeyframe = { t, pos, lookAt };
      const ease = String(args.ease || '');
      if (ease && EASES.has(ease)) kf.ease = ease as EaseType;
      const kfs = [...store.scene.camera.keyframes, kf].sort((a, b) => a.t - b.t);
      store.setScene({
        ...store.scene,
        camera: { ...store.scene.camera, keyframes: kfs },
      });
      return { ok: true, summary: `新增关键帧 t=${t}` };
    }
    case 'update_camera_keyframe': {
      const index = Number(args.index);
      if (!Number.isInteger(index) || index < 0 || index >= store.scene.camera.keyframes.length) {
        return { ok: false, summary: '', error: '关键帧索引非法' };
      }
      const patch: Partial<CameraKeyframe> = {};
      if (args.t != null) {
        const t = Number(args.t);
        if (!Number.isFinite(t)) return { ok: false, summary: '', error: 't 非法' };
        patch.t = t;
      }
      const pos = asVec3(args.pos);
      if (pos) patch.pos = pos;
      const lookAt = asLookAt(args.lookAt);
      if (lookAt) patch.lookAt = lookAt;
      if (args.ease != null) {
        const ease = String(args.ease);
        if (!EASES.has(ease)) return { ok: false, summary: '', error: 'ease 非法' };
        patch.ease = ease as EaseType;
      }
      store.updateKeyframe(index, patch);
      return { ok: true, summary: `更新关键帧 #${index}` };
    }
    case 'remove_camera_keyframe': {
      const index = Number(args.index);
      if (!Number.isInteger(index) || index < 0) {
        return { ok: false, summary: '', error: '索引非法' };
      }
      if (store.scene.camera.keyframes.length <= 2) {
        return { ok: false, summary: '', error: '至少保留 2 个关键帧' };
      }
      store.removeKeyframe(index);
      return { ok: true, summary: `删除关键帧 #${index}` };
    }
    case 'apply_camera_preset': {
      const preset = String(args.preset || '');
      if (!CAM_PRESETS.has(preset)) return { ok: false, summary: '', error: '非法运镜模板' };
      const options: { distance?: number; duration?: number; target?: Vec3 } = {};
      if (args.distance != null) options.distance = Number(args.distance);
      if (args.duration != null) options.duration = Number(args.duration);
      const target = asVec3(args.target);
      if (target) options.target = target;
      store.applyCameraPreset(preset as CameraPresetId, options);
      return { ok: true, summary: `运镜模板 → ${preset}` };
    }
    case 'set_preview_t': {
      const t = Number(args.t);
      if (!Number.isFinite(t) || t < 0) return { ok: false, summary: '', error: 't 非法' };
      store.setPreviewT(Math.min(store.scene.duration, t));
      store.setPlaying(false);
      return { ok: true, summary: `时间轴 → ${t.toFixed(2)}s` };
    }
    case 'replace_scene': {
      const scene = args.scene;
      if (!scene || typeof scene !== 'object') {
        return { ok: false, summary: '', error: '缺少 scene' };
      }
      const ok = store.loadJson(JSON.stringify(scene));
      if (!ok) {
        const err = store.errors[0];
        return {
          ok: false,
          summary: '',
          error: err ? `${err.path}: ${err.message}` : 'SceneJSON 校验失败',
        };
      }
      store.setPreviewT(0);
      store.setPlaying(false);
      return { ok: true, summary: '已替换整场场景' };
    }
    default:
      return { ok: false, summary: '', error: `未知工具: ${name}` };
  }
}

export function applyAgentToolCalls(calls: AgentToolCall[]): ToolApplyResult[] {
  const out: ToolApplyResult[] = [];
  calls.forEach((tc, i) => {
    const name = toolName(tc);
    const id = toolId(tc, i);
    if (!name) {
      out.push({ id, name: '', ok: false, summary: '', error: '空工具名' });
      return;
    }
    try {
      const r = applyOne(name, toolArgs(tc));
      out.push({
        id,
        name,
        ok: r.ok,
        summary: r.summary,
        error: r.error,
      });
    } catch (e) {
      out.push({
        id,
        name,
        ok: false,
        summary: '',
        error: (e as Error).message || '执行失败',
      });
    }
  });
  return out;
}

export function sceneSnapshot(): SceneJSON {
  return useSceneStore.getState().scene;
}
