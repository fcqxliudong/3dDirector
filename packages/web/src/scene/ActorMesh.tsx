/**
 * ActorMesh · 象形简易人体
 * - 颜色区分身份（脚底色环），无头顶文字
 * - 走位：keyframes 优先(maya 风格 3 轴手柄) · fallback moves · 最后静态
 * - walk / run 振幅与频率不同；sit / crouch 为静态矮姿
 * - scale 各轴独立应用（Maya R 手柄）
 * - facing 用 yaw 角最短路径 slerp（避免绕远路）
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group } from 'three';
import { useSceneStore, type Vec3, type Actor, type ActorKeyframe } from '../store/scene';

interface Props {
  actor: Actor;
  selected: boolean;
  onClick: () => void;
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  const u = Math.max(0, Math.min(1, t));
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
  ];
}

function lerp3Scale(a: Vec3, b: Vec3, t: number): Vec3 {
  const u = Math.max(0, Math.min(1, t));
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
  ];
}

/** yaw 角最短路径 slerp（Maya 默认行为 · 避免 180°→0° 绕远路） */
function slerpYaw(fromYaw: number, toYaw: number, t: number): number {
  let delta = toYaw - fromYaw;
  // 把 delta 归到 [-π, π] 区间（走最短路径）
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const u = Math.max(0, Math.min(1, t));
  return fromYaw + delta * u;
}

function distXZ(a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  return Math.hypot(dx, dz);
}

function facingToYaw(facing: Vec3 | undefined): number {
  if (!facing) return 0;
  return Math.atan2(facing[0], facing[2]);
}

type EvalResult = {
  pos: Vec3;
  /** 当前 yaw 角度（弧度） */
  yaw: number;
  scale: Vec3;
  pose: string;
  moving: boolean;
  /** 本段走位朝向（有位移时），否则 null */
  moveDir: Vec3 | null;
  /** 已走过路程，用于步频相位 */
  traveled: number;
};

/**
 * 评估 actor 在时刻 t 的渲染状态
 *
 * 优先级：
 * 1. actor.keyframes 存在 → 按时间排序的关键帧插值（pos / facing yaw slerp / scale 各轴）
 * 2. actor.moves 存在 → 程序化走位（兼容旧场景）
 * 3. fallback 静态（actor.start / actor.facing / actor.scale / actor.pose）
 */
function evalActor(actor: Actor, t: number): EvalResult {
  const defaultScale: Vec3 = actor.scale ?? [1, 1, 1];
  const defaultYaw = facingToYaw(actor.facing);

  // 1. 优先 keyframes
  const kfs: ActorKeyframe[] = Array.isArray(actor.keyframes)
    ? [...actor.keyframes].sort((a, b) => a.t - b.t)
    : [];
  if (kfs.length >= 1) {
    if (kfs.length === 1 || t <= kfs[0].t) {
      const kf = kfs[0];
      return {
        pos: kf.pos,
        yaw: facingToYaw(kf.facing),
        scale: kf.scale ?? defaultScale,
        pose: kf.pose ?? actor.pose ?? 'stand',
        moving: false,
        moveDir: null,
        traveled: 0,
      };
    }
    if (t >= kfs[kfs.length - 1].t) {
      const kf = kfs[kfs.length - 1];
      return {
        pos: kf.pos,
        yaw: facingToYaw(kf.facing),
        scale: kf.scale ?? defaultScale,
        pose: kf.pose ?? actor.pose ?? 'stand',
        moving: false,
        moveDir: null,
        traveled: 0,
      };
    }
    // 在 segment 内插值
    for (let i = 0; i < kfs.length - 1; i++) {
      const a = kfs[i];
      const b = kfs[i + 1];
      if (t >= a.t && t <= b.t) {
        const span = Math.max(0.001, b.t - a.t);
        const u = (t - a.t) / span;
        const pos = lerp3(a.pos, b.pos, u);
        const yawA = facingToYaw(a.facing);
        const yawB = facingToYaw(b.facing);
        const yaw = slerpYaw(yawA, yawB, u);
        const scaleA = a.scale ?? defaultScale;
        const scaleB = b.scale ?? defaultScale;
        const scale = lerp3Scale(scaleA, scaleB, u);
        const segLen = distXZ(a.pos, b.pos);
        const moving = segLen > 0.05;
        const moveDir: Vec3 | null = moving
          ? [b.pos[0] - a.pos[0], 0, b.pos[2] - a.pos[2]]
          : null;
        return {
          pos,
          yaw,
          scale,
          pose: a.pose ?? actor.pose ?? 'stand',
          moving,
          moveDir,
          traveled: segLen * u,
        };
      }
    }
  }

  // 2. fallback moves
  const start: Vec3 = actor.start ?? [0, 0, 0];
  const moves = Array.isArray(actor.moves) ? [...actor.moves].sort((x, y) => x.t0 - y.t0) : [];
  if (!moves.length) {
    return {
      pos: start,
      yaw: defaultYaw,
      scale: defaultScale,
      pose: actor.pose ?? 'stand',
      moving: false,
      moveDir: null,
      traveled: 0,
    };
  }

  let pose = actor.pose ?? 'stand';
  let cursor = start;
  let traveled = 0;

  for (const m of moves) {
    const to = m.to as Vec3;
    const segLen = distXZ(cursor, to);
    if (t < m.t0) {
      return {
        pos: cursor,
        yaw: defaultYaw,
        scale: defaultScale,
        pose,
        moving: false,
        moveDir: null,
        traveled,
      };
    }
    if (t >= m.t0 && t <= m.t1) {
      const span = Math.max(0.001, m.t1 - m.t0);
      const u = (t - m.t0) / span;
      const pos = lerp3(cursor, to, u);
      const dx = to[0] - cursor[0];
      const dz = to[2] - cursor[2];
      const moving = segLen > 0.05;
      const moveDir: Vec3 | null = moving ? [dx, 0, dz] : null;
      // moves 模式：走位时 actor 自动朝移动方向
      const yaw = moving ? Math.atan2(dx, dz) : defaultYaw;
      return {
        pos,
        yaw,
        scale: defaultScale,
        pose: m.pose || pose,
        moving,
        moveDir,
        traveled: traveled + segLen * u,
      };
    }
    traveled += segLen;
    cursor = to;
    pose = m.pose || pose;
  }
  return {
    pos: cursor,
    yaw: defaultYaw,
    scale: defaultScale,
    pose,
    moving: false,
    moveDir: null,
    traveled,
  };
}

function shadeHex(hex: string, factor: number): string {
  const h = String(hex || '#888888').replace('#', '');
  if (h.length < 6) return hex;
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return hex;
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * factor)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/** 步态：仅位移中摆腿；静止 pose 只改体态不迈步 */
function gaitParams(pose: string, moving: boolean): {
  gait: number;
  freq: number;
  legAmp: number;
  armAmp: number;
  bob: number;
  bodyY: number;
  baseY: number;
  lean: number;
} {
  if (pose === 'sit') {
    return { gait: 0, freq: 0, legAmp: 0, armAmp: 0, bob: 0, bodyY: 0.55, baseY: 0.15, lean: 0 };
  }
  if (pose === 'crouch') {
    return { gait: 0, freq: 0, legAmp: 0, armAmp: 0, bob: 0, bodyY: 0.72, baseY: 0.05, lean: 0.12 };
  }

  if (!moving) {
    return { gait: 0, freq: 0, legAmp: 0, armAmp: 0, bob: 0, bodyY: 1, baseY: 0, lean: 0 };
  }

  // 正在移动：按 pose 选走/跑摆幅
  if (pose === 'run') {
    return {
      gait: 1,
      freq: 2.6,
      legAmp: 0.85,
      armAmp: 0.95,
      bob: 0.045,
      bodyY: 1,
      baseY: 0,
      lean: 0.22,
    };
  }

  return {
    gait: 1,
    freq: 1.7,
    legAmp: 0.55,
    armAmp: 0.5,
    bob: 0.025,
    bodyY: 1,
    baseY: 0,
    lean: 0.08,
  };
}

export function ActorMesh({ actor, selected, onClick }: Props) {
  const rootRef = useRef<Group>(null);
  const bodyRef = useRef<Group>(null);
  const torsoRef = useRef<Group>(null);
  const lArmRef = useRef<Group>(null);
  const rArmRef = useRef<Group>(null);
  const lLegRef = useRef<Group>(null);
  const rLegRef = useRef<Group>(null);
  const phaseRef = useRef(0);

  useFrame(() => {
    if (!rootRef.current) return;
    const t = useSceneStore.getState().previewT;
    const { pos, yaw, scale, pose, moving, traveled } = evalActor(actor, t);
    rootRef.current.position.set(pos[0], pos[1], pos[2]);
    // yaw 已由 evalActor 根据 keyframes/moves/static 决策好
    rootRef.current.rotation.y = yaw;
    // scale 各轴独立应用（Maya R 手柄）
    rootRef.current.scale.set(scale[0], scale[1], scale[2]);

    const gp = gaitParams(pose, moving);

    if (bodyRef.current) {
      bodyRef.current.scale.set(1, gp.bodyY, 1);
      bodyRef.current.position.y = gp.baseY;
    }

    // 仅位移中按路程摆腿；停下立刻直立
    if (moving && gp.gait > 0) {
      phaseRef.current = traveled * gp.freq * Math.PI * 2 * 0.55;
    } else {
      phaseRef.current = 0;
    }

    const swing = Math.sin(phaseRef.current) * gp.gait;
    const bob = Math.abs(Math.sin(phaseRef.current * 2)) * gp.bob * gp.gait;

    if (torsoRef.current) {
      torsoRef.current.position.y = bob;
      torsoRef.current.rotation.x = gp.lean * gp.gait;
    }

    // 腿：绕 X 前后摆（左正右负）
    if (lLegRef.current) {
      lLegRef.current.rotation.x = swing * gp.legAmp;
    }
    if (rLegRef.current) {
      rLegRef.current.rotation.x = -swing * gp.legAmp;
    }
    // 臂：与对侧腿同相（左臂随右腿）
    const armZ = 0.32;
    if (lArmRef.current) {
      lArmRef.current.rotation.set(-swing * gp.armAmp, 0, armZ);
    }
    if (rArmRef.current) {
      rArmRef.current.rotation.set(swing * gp.armAmp, 0, -armZ);
    }
  });

  const facing = actor.facing ?? [0, 0, 1];
  const cloth = actor.color;
  const clothDark = useMemo(() => shadeHex(cloth, 0.72), [cloth]);
  const skin = useMemo(() => shadeHex(cloth, 1.25), [cloth]);

  const mat = (color: string, rough = 0.55) => (
    <meshStandardMaterial
      color={color}
      roughness={rough}
      metalness={0.06}
      emissive={selected ? cloth : '#000000'}
      emissiveIntensity={selected ? 0.28 : 0}
    />
  );

  return (
    <group
      ref={rootRef}
      position={actor.start}
      rotation={[0, Math.atan2(facing[0], facing[2]), 0]}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <group ref={bodyRef}>
        <group ref={torsoRef}>
          {/* 头 */}
          <mesh position={[0, 1.55, 0]} castShadow>
            <sphereGeometry args={[0.16, 16, 16]} />
            {mat(skin, 0.45)}
          </mesh>
          <mesh position={[0, 1.38, 0]} castShadow>
            <cylinderGeometry args={[0.05, 0.06, 0.1, 8]} />
            {mat(skin, 0.5)}
          </mesh>
          <mesh position={[0, 1.05, 0]} castShadow>
            <capsuleGeometry args={[0.18, 0.42, 6, 12]} />
            {mat(cloth, 0.6)}
          </mesh>
          <mesh position={[0, 0.72, 0]} castShadow>
            <boxGeometry args={[0.34, 0.16, 0.2]} />
            {mat(clothDark, 0.65)}
          </mesh>

          {/* 左臂 · 肩枢 */}
          <group ref={lArmRef} position={[-0.28, 1.22, 0]} rotation={[0, 0, 0.32]}>
            <mesh position={[0, -0.22, 0]} castShadow>
              <capsuleGeometry args={[0.055, 0.28, 4, 8]} />
              {mat(cloth, 0.58)}
            </mesh>
            <mesh position={[0, -0.48, 0]} castShadow>
              <sphereGeometry args={[0.055, 10, 10]} />
              {mat(skin, 0.5)}
            </mesh>
          </group>
          {/* 右臂 */}
          <group ref={rArmRef} position={[0.28, 1.22, 0]} rotation={[0, 0, -0.32]}>
            <mesh position={[0, -0.22, 0]} castShadow>
              <capsuleGeometry args={[0.055, 0.28, 4, 8]} />
              {mat(cloth, 0.58)}
            </mesh>
            <mesh position={[0, -0.48, 0]} castShadow>
              <sphereGeometry args={[0.055, 10, 10]} />
              {mat(skin, 0.5)}
            </mesh>
          </group>

          {/* 朝向三角 */}
          <mesh position={[0, 1.12, 0.2]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.04, 0.1, 3]} />
            <meshBasicMaterial color={clothDark} />
          </mesh>
        </group>

        {/* 左腿 · 髋枢 */}
        <group ref={lLegRef} position={[-0.1, 0.68, 0]}>
          <mesh position={[0, -0.28, 0.02]} castShadow>
            <capsuleGeometry args={[0.07, 0.32, 4, 8]} />
            {mat(clothDark, 0.62)}
          </mesh>
          <mesh position={[0, -0.55, 0.06]} rotation={[0.12, 0, 0]} castShadow>
            <boxGeometry args={[0.12, 0.06, 0.22]} />
            {mat(clothDark, 0.7)}
          </mesh>
        </group>
        {/* 右腿 */}
        <group ref={rLegRef} position={[0.1, 0.68, 0]}>
          <mesh position={[0, -0.28, 0.02]} castShadow>
            <capsuleGeometry args={[0.07, 0.32, 4, 8]} />
            {mat(clothDark, 0.62)}
          </mesh>
          <mesh position={[0, -0.55, 0.06]} rotation={[0.12, 0, 0]} castShadow>
            <boxGeometry args={[0.12, 0.06, 0.22]} />
            {mat(clothDark, 0.7)}
          </mesh>
        </group>
      </group>

      <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.22, selected ? 0.38 : 0.32, 28]} />
        <meshBasicMaterial color={cloth} transparent opacity={selected ? 0.95 : 0.7} />
      </mesh>
    </group>
  );
}
