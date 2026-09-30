/**
 * CameraRig · 相机沿 keyframes 移动 (GSAP ease 版)
 *
 * 设计：
 * - 用 useFrame 每帧自己插值（避开 GSAP timeline 跟 R3F 时序冲突）
 * - 缓动函数用 GSAP.parseEase —— 享受 30+ 缓动，不用维护 ease 曲线
 * - keyframes 数组不变（schema 不破坏）
 *
 * 缓动值表（keyframe.ease → GSAP ease）：
 * - linear     → none
 * - easeIn     → power2.in
 * - easeOut    → power2.out
 * - easeInOut  → power2.inOut
 *
 * 未来如果要加 elastic / back / bounce 等缓动，只需要在 EASE_MAP 加一行
 */

import { useEffect, useMemo } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';
import gsap from 'gsap';
import { useSceneStore, type Vec3 } from '../store/scene';

const EASE_MAP: Record<string, string> = {
  linear: 'none',
  easeIn: 'power2.in',
  easeOut: 'power2.out',
  easeInOut: 'power2.inOut',
};

/** 解析 keyframe.lookAt（array | actor.id）→ Vector3 */
function resolveLookAt(
  raw: Vec3 | string | undefined,
  actors: Array<{ id: string; start?: Vec3; keyframes?: Array<{ pos: Vec3 }> }>,
): Vector3 {
  if (!raw) return new Vector3(0, 1.5, 0);
  if (typeof raw === 'string') {
    const a = actors.find((x) => x.id === raw);
    if (!a) return new Vector3(0, 1.5, 0);
    // 优先 keyframes[0].pos · fallback start
    const pos = a.keyframes?.[0]?.pos ?? a.start ?? [0, 0, 0];
    return new Vector3(...pos);
  }
  return new Vector3(...raw);
}

export function CameraRig() {
  const { camera } = useThree();
  const scene = useSceneStore((s) => s.scene);
  const setPreviewT = useSceneStore((s) => s.setPreviewT);

  /** 把 ease 字符串预编译成 GSAP 缓动函数 (只在 keyframes 变化时重编译) */
  const eases = useMemo(() => {
    return scene.camera.keyframes.map((kf) => {
      const easeName = EASE_MAP[kf.ease ?? 'easeInOut'] ?? 'power2.inOut';
      return gsap.parseEase(easeName);
    });
  }, [scene.camera.keyframes]);

  /**
   * 计算 previewT 时刻的相机 pos + lookAt
   * 找出当前 t 所在的 segment · 用 segment 的 ease 缓动插值
   */
  const evalCamera = (t: number) => {
    const kfs = scene.camera.keyframes;
    if (kfs.length === 0) {
      return {
        pos: new Vector3(0, 4, 10),
        lookAt: new Vector3(0, 1.5, 0),
      };
    }
    if (kfs.length === 1 || t <= kfs[0].t) {
      return {
        pos: new Vector3(...kfs[0].pos),
        lookAt: resolveLookAt(kfs[0].lookAt, scene.actors),
      };
    }
    if (t >= kfs[kfs.length - 1].t) {
      return {
        pos: new Vector3(...kfs[kfs.length - 1].pos),
        lookAt: resolveLookAt(kfs[kfs.length - 1].lookAt, scene.actors),
      };
    }
    // 找 segment
    for (let i = 0; i < kfs.length - 1; i++) {
      if (t >= kfs[i].t && t <= kfs[i + 1].t) {
        const a = kfs[i];
        const b = kfs[i + 1];
        const dur = b.t - a.t;
        const raw = dur > 0 ? (t - a.t) / dur : 0;
        const eased = eases[i] ? eases[i](raw) : raw;
        const pos = new Vector3(...a.pos).lerp(new Vector3(...b.pos), eased);
        const lookA = resolveLookAt(a.lookAt, scene.actors);
        const lookB = resolveLookAt(b.lookAt, scene.actors);
        return { pos, lookAt: lookA.lerp(lookB, eased) };
      }
    }
    return {
      pos: new Vector3(...kfs[kfs.length - 1].pos),
      lookAt: resolveLookAt(kfs[kfs.length - 1].lookAt, scene.actors),
    };
  };

  /** mount 时把 camera 设到 kfs[0] 位置（避免 Canvas 默认 [0,4,10] 跟 keyframe 不一致）*/
  useEffect(() => {
    const { pos, lookAt } = evalCamera(0);
    camera.position.copy(pos);
    camera.lookAt(lookAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 所见即所得核心：previewT 变化时同步 camera 视角
   * - playing = true → 推进 previewT → camera 跟着 timeline 走
   * - playing = false → 拖 Timeline playhead → camera 跳到该时刻视角
   * - freeViewMode = true → 用户自由调 OrbitControls · 不动 camera
   *
   * 用 useSceneStore.getState() 实时读最新值，避免 stale closure
   * （playing 时每帧推进 + exporter 录制时手动 setPreviewT 都依赖实时读取）
   */
  useFrame((_, delta) => {
    if (useSceneStore.getState().freeViewMode) return; // 自由模式 → OrbitControls 接管
    // 实时读最新值 · 避免 closure 滞后
    const store = useSceneStore.getState();
    let t = store.previewT;
    if (store.playing) {
      t = t + delta;
      if (t > scene.duration) {
        setPreviewT(0);
        return;
      }
      setPreviewT(t);
    }
    const { pos, lookAt } = evalCamera(t);
    camera.position.copy(pos);
    camera.lookAt(lookAt);
  });

  // 不在 Canvas 里渲染关键帧标记（球/线）· Timeline 上已经有完整信息
  // AI 参考视频也不应该被标记干扰
  return null;
}