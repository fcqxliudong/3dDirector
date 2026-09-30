/**
 * ActorMesh · 象形简易人体
 * - 颜色区分身份（脚底色环），无头顶文字
 * - 走位：moves 插值平移 + 程序化步态（腿/臂正弦摆动）
 * - walk / run 振幅与频率不同；sit / crouch 为静态矮姿
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group } from 'three';
import { useSceneStore, type Vec3 } from '../store/scene';

interface Props {
  actor: import('../store/scene').Actor;
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

function distXZ(a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  return Math.hypot(dx, dz);
}

type EvalResult = {
  pos: Vec3;
  pose: string;
  moving: boolean;
  /** 本段走位朝向（有位移时），否则 null */
  moveDir: Vec3 | null;
  /** 已走过路程，用于步频相位 */
  traveled: number;
};

function evalActorPos(actor: import('../store/scene').Actor, t: number): EvalResult {
  const start = actor.start;
  const moves = Array.isArray(actor.moves) ? [...actor.moves].sort((x, y) => x.t0 - y.t0) : [];
  if (!moves.length) {
    return { pos: start, pose: actor.pose, moving: false, moveDir: null, traveled: 0 };
  }

  let pose = actor.pose;
  let cursor = start;
  let traveled = 0;

  for (const m of moves) {
    const to = m.to as Vec3;
    const segLen = distXZ(cursor, to);
    if (t < m.t0) {
      return { pos: cursor, pose, moving: false, moveDir: null, traveled };
    }
    if (t >= m.t0 && t <= m.t1) {
      const span = Math.max(0.001, m.t1 - m.t0);
      const u = (t - m.t0) / span;
      const pos = lerp3(cursor, to, u);
      const dx = to[0] - cursor[0];
      const dz = to[2] - cursor[2];
      const moving = segLen > 0.05;
      const moveDir: Vec3 | null = moving ? [dx, 0, dz] : null;
      return {
        pos,
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
  return { pos: cursor, pose, moving: false, moveDir: null, traveled };
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

/** 步态参数：按 pose；静止时 gait=0 */
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

  // run：明示跑步；walk / 或位移中：走路摆臂（stand 有 moves 也会走）
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

  if (pose === 'walk' || moving) {
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

  return { gait: 0, freq: 0, legAmp: 0, armAmp: 0, bob: 0, bodyY: 1, baseY: 0, lean: 0 };
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
  const lastTRef = useRef(-1);

  useFrame((_, delta) => {
    if (!rootRef.current) return;
    const t = useSceneStore.getState().previewT;
    const { pos, pose, moving, moveDir, traveled } = evalActorPos(actor, t);
    rootRef.current.position.set(pos[0], pos[1], pos[2]);

    // 有走位方向时转向移动方向，否则用 facing
    if (moveDir && (Math.abs(moveDir[0]) + Math.abs(moveDir[2]) > 1e-4)) {
      rootRef.current.rotation.y = Math.atan2(moveDir[0], moveDir[2]);
    } else {
      const facing = actor.facing ?? [0, 0, 1];
      rootRef.current.rotation.y = Math.atan2(facing[0], facing[2]);
    }

    const gp = gaitParams(pose, moving);

    if (bodyRef.current) {
      bodyRef.current.scale.set(1, gp.bodyY, 1);
      bodyRef.current.position.y = gp.baseY;
    }

    // 相位：优先用路程（步幅稳定）， scrub 时间轴也能对上；无位移时用时间
    if (gp.gait > 0) {
      if (moving) {
        phaseRef.current = traveled * gp.freq * Math.PI * 2 * 0.55;
      } else {
        // pose=walk/run 但停在原地：轻步态（预览姿态）
        if (lastTRef.current >= 0 && Math.abs(t - lastTRef.current) < 0.5) {
          phaseRef.current += delta * gp.freq * Math.PI * 2;
        } else {
          phaseRef.current = t * gp.freq * Math.PI * 2;
        }
      }
    } else {
      phaseRef.current *= 0.85;
    }
    lastTRef.current = t;

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
