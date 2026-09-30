/**
 * EnvMesh · 开放空间：默认地面 + 智能体 env 几何
 * 不再套 corridor/room/street 等预设模板；一般不建天花板。
 */

import { useMemo } from 'react';
import { DoubleSide } from 'three';
import type { Vec3, ScenePreset, EnvProp } from '../store/scene';

interface Props {
  preset: ScenePreset;
  size: Vec3;
  env?: EnvProp[];
}

type Part = {
  key: string;
  size: Vec3;
  pos: Vec3;
  color: string;
  kind: 'box' | 'cyl' | 'cone';
  rot?: Vec3;
};

function defaultGroundColor(_preset: ScenePreset): string {
  return '#6a7360';
}

export function EnvMesh({ preset, size, env }: Props) {
  const [w, , d] = size;

  const parts = useMemo((): Part[] => {
    const list: Part[] = [];
    const props = Array.isArray(env) ? env : [];
    const hasGround = props.some((p) => p && p.kind === 'ground');

    if (!hasGround) {
      list.push({
        key: 'auto-ground',
        size: [Math.max(4, w), 0.08, Math.max(4, d)],
        pos: [0, 0, 0],
        color: defaultGroundColor(preset),
        kind: 'box',
      });
    }

    for (const p of props) {
      if (!p || !p.id) continue;
      const s = (p.size || [1, 1, 1]) as Vec3;
      const pos = (p.pos || [0, 0, 0]) as Vec3;
      const color = p.color || '#9a9384';
      const rot = p.rot as Vec3 | undefined;
      const kind = p.kind || 'box';

      if (kind === 'ground') {
        list.push({
          key: p.id,
          size: [s[0], Math.max(0.04, s[1]), s[2]],
          pos: [pos[0], pos[1], pos[2]],
          color,
          kind: 'box',
        });
        continue;
      }
      if (kind === 'wall') {
        // wall: size = [宽, 高, 厚] · 默认沿 X 方向铺，中心在 pos
        list.push({
          key: p.id,
          size: [s[0], s[1], Math.max(0.08, s[2])],
          pos: [pos[0], pos[1] + s[1] / 2, pos[2]],
          color,
          kind: 'box',
          rot,
        });
        continue;
      }
      if (kind === 'cyl') {
        list.push({
          key: p.id,
          size: [s[0], s[1], s[2]],
          pos: [pos[0], pos[1] + s[1] / 2, pos[2]],
          color,
          kind: 'cyl',
          rot,
        });
        continue;
      }
      if (kind === 'cone') {
        list.push({
          key: p.id,
          size: [s[0], s[1], s[2]],
          pos: [pos[0], pos[1] + s[1] / 2, pos[2]],
          color,
          kind: 'cone',
          rot,
        });
        continue;
      }
      // box
      list.push({
        key: p.id,
        size: s,
        pos: [pos[0], pos[1] + s[1] / 2, pos[2]],
        color,
        kind: 'box',
        rot,
      });
    }

    return list;
  }, [preset, w, d, env]);

  return (
    <group>
      {/* 淡网格 · 帮助感知尺度，不挡景 */}
      <gridHelper args={[Math.max(w, d), Math.max(8, Math.round(Math.max(w, d) / 2)), '#8a8578', '#7a766a']} position={[0, 0.01, 0]} />
      {parts.map((p) => {
        const rot = p.rot || [0, 0, 0];
        return (
          <mesh
            key={p.key}
            position={p.pos}
            rotation={rot as unknown as [number, number, number]}
            castShadow
            receiveShadow
          >
            {p.kind === 'cyl' && <cylinderGeometry args={[p.size[0], p.size[0], p.size[1], 12]} />}
            {p.kind === 'cone' && <coneGeometry args={[p.size[0], p.size[1], 8]} />}
            {p.kind === 'box' && <boxGeometry args={p.size} />}
            <meshStandardMaterial color={p.color} roughness={0.88} metalness={0.04} side={DoubleSide} />
          </mesh>
        );
      })}
    </group>
  );
}
