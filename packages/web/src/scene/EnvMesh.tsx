/**
 * EnvMesh · 环境象形几何（仍轻量，但比纯大方块更易认景别）
 */

import { useMemo } from 'react';
import { DoubleSide } from 'three';
import type { Vec3, ScenePreset } from '../store/scene';

interface Props {
  preset: ScenePreset;
  size: Vec3;
}

type Part = {
  key: string;
  size: Vec3;
  pos: Vec3;
  color: string;
  kind?: 'box' | 'cyl' | 'cone';
  rot?: Vec3;
};

export function EnvMesh({ preset, size }: Props) {
  const [w, h, d] = size;

  const parts = useMemo((): Part[] => {
    if (preset === 'corridor') {
      const list: Part[] = [
        { key: 'floor', size: [w, 0.12, d], pos: [0, 0, 0], color: '#8a8376' },
        { key: 'ceil', size: [w, 0.12, d], pos: [0, h, 0], color: '#b8b2a2' },
        { key: 'left', size: [0.18, h, d], pos: [-w / 2, h / 2, 0], color: '#d4cfc0' },
        { key: 'right', size: [0.18, h, d], pos: [w / 2, h / 2, 0], color: '#d4cfc0' },
        { key: 'end-dark', size: [w * 0.55, h * 0.7, 0.12], pos: [0, h * 0.4, -d / 2 + 0.15], color: '#4a4550' },
      ];
      // 纵深门框节奏
      for (let i = 0; i < 4; i++) {
        const z = -d / 2 + (i + 1) * (d / 5);
        list.push(
          { key: `arch-l-${i}`, size: [0.12, h * 0.55, 0.12], pos: [-w * 0.28, h * 0.35, z], color: '#c4bdb0' },
          { key: `arch-r-${i}`, size: [0.12, h * 0.55, 0.12], pos: [w * 0.28, h * 0.35, z], color: '#c4bdb0' },
          { key: `arch-t-${i}`, size: [w * 0.56, 0.1, 0.12], pos: [0, h * 0.62, z], color: '#b0a898' },
        );
      }
      return list;
    }

    if (preset === 'room_small') {
      return [
        { key: 'floor', size: [w, 0.12, d], pos: [0, 0, 0], color: '#c8c1ab' },
        { key: 'ceil', size: [w, 0.12, d], pos: [0, h, 0], color: '#e9e3d6' },
        { key: 'wall-z+', size: [w, h, 0.14], pos: [0, h / 2, d / 2], color: '#e4ddd0' },
        { key: 'wall-z-', size: [w, h, 0.14], pos: [0, h / 2, -d / 2], color: '#e4ddd0' },
        { key: 'wall-x+', size: [0.14, h, d], pos: [w / 2, h / 2, 0], color: '#ddd6c8' },
        { key: 'wall-x-', size: [0.14, h, d], pos: [-w / 2, h / 2, 0], color: '#ddd6c8' },
        // 门
        { key: 'door', size: [0.9, 2.0, 0.08], pos: [0, 1.0, d / 2 - 0.08], color: '#8b6914' },
        // 窗
        { key: 'win', size: [1.2, 0.9, 0.06], pos: [-w / 2 + 0.1, 1.5, 0], color: '#9ec9e8' },
        // 简易桌椅暗示
        { key: 'table', size: [1.1, 0.08, 0.7], pos: [0.6, 0.75, -0.4], color: '#a67c52' },
        { key: 'leg1', size: [0.06, 0.7, 0.06], pos: [0.15, 0.35, -0.15], color: '#8b6914' },
        { key: 'leg2', size: [0.06, 0.7, 0.06], pos: [1.05, 0.35, -0.15], color: '#8b6914' },
        { key: 'leg3', size: [0.06, 0.7, 0.06], pos: [0.15, 0.35, -0.65], color: '#8b6914' },
        { key: 'leg4', size: [0.06, 0.7, 0.06], pos: [1.05, 0.35, -0.65], color: '#8b6914' },
      ];
    }

    if (preset === 'street') {
      const list: Part[] = [
        { key: 'road', size: [w * 0.45, 0.08, d], pos: [0, 0, 0], color: '#4a4a4e' },
        { key: 'sidewalk-l', size: [w * 0.22, 0.1, d], pos: [-w * 0.34, 0.02, 0], color: '#7a7a7e' },
        { key: 'sidewalk-r', size: [w * 0.22, 0.1, d], pos: [w * 0.34, 0.02, 0], color: '#7a7a7e' },
      ];
      const bldgs = [
        { x: -w / 2 + 1.3, tall: 7, depth: d * 0.4, z: -d * 0.2, c: '#7a8494' },
        { x: -w / 2 + 1.3, tall: 4.8, depth: d * 0.32, z: d * 0.28, c: '#6a7382' },
        { x: w / 2 - 1.3, tall: 8, depth: d * 0.45, z: -d * 0.12, c: '#8a909c' },
        { x: w / 2 - 1.3, tall: 5.2, depth: d * 0.3, z: d * 0.32, c: '#757c88' },
      ];
      bldgs.forEach((b, i) => {
        list.push({
          key: `bldg-${i}`,
          size: [2.4, b.tall, b.depth],
          pos: [b.x, b.tall / 2, b.z],
          color: b.c,
        });
        // 窗格
        for (let row = 0; row < 3; row++) {
          list.push({
            key: `win-${i}-${row}`,
            size: [0.35, 0.4, 0.05],
            pos: [b.x + (b.x < 0 ? 1.15 : -1.15), 1.2 + row * 1.5, b.z],
            color: '#cfe7ff',
          });
        }
      });
      // 路灯
      list.push(
        { key: 'pole', size: [0.08, 3.2, 0.08], pos: [-w * 0.12, 1.6, d * 0.2], color: '#333', kind: 'cyl' },
        { key: 'lamp', size: [0.25, 0.25, 0.25], pos: [-w * 0.12, 3.3, d * 0.2], color: '#ffe08a' },
      );
      return list;
    }

    if (preset === 'forest') {
      const list: Part[] = [
        { key: 'ground', size: [w, 0.12, d], pos: [0, 0, 0], color: '#3d4f2e' },
      ];
      for (let i = 0; i < 12; i++) {
        const ax = ((i * 37) % 100) / 100 - 0.5;
        const az = ((i * 53) % 100) / 100 - 0.5;
        const trunkH = 1.4 + (i % 4) * 0.35;
        const x = ax * w * 0.8;
        const z = az * d * 0.8;
        list.push(
          {
            key: `trunk-${i}`,
            size: [0.18, trunkH, 0.18],
            pos: [x, trunkH / 2, z],
            color: '#5c4030',
            kind: 'cyl',
          },
          {
            key: `crown-${i}`,
            size: [0.9 + (i % 3) * 0.15, 1.4 + (i % 3) * 0.2, 0.9],
            pos: [x, trunkH + 0.7, z],
            color: i % 2 === 0 ? '#2d6b2d' : '#3a7a3a',
            kind: 'cone',
          },
        );
      }
      return list;
    }

    if (preset === 'space') {
      return [
        { key: 'floor', size: [w, 0.1, d], pos: [0, 0, 0], color: '#2a2a3a' },
        { key: 'back', size: [w, h, 0.14], pos: [0, h / 2, -d / 2], color: '#1a1a2e' },
        // cyl 高度取 size[1]；横放时用长度作高度再 rot X
        { key: 'rail-l', size: [0.05, d * 0.75, 0.05], pos: [-w * 0.32, 0.85, 0], color: '#6a8cff', kind: 'cyl', rot: [Math.PI / 2, 0, 0] },
        { key: 'rail-r', size: [0.05, d * 0.75, 0.05], pos: [w * 0.32, 0.85, 0], color: '#6a8cff', kind: 'cyl', rot: [Math.PI / 2, 0, 0] },
        { key: 'console', size: [w * 0.5, 0.7, 0.55], pos: [0, 0.45, -d / 2 + 1.0], color: '#3a4a6a' },
        { key: 'screen', size: [w * 0.35, 0.45, 0.06], pos: [0, 1.35, -d / 2 + 0.35], color: '#5ad0ff' },
        { key: 'seat', size: [0.55, 0.35, 0.55], pos: [0, 0.35, 0.2], color: '#444a66' },
      ];
    }

    return [];
  }, [preset, w, h, d]);

  return (
    <group>
      {parts.map((p) => {
        const kind = p.kind || 'box';
        const rot = p.rot || [0, 0, 0];
        return (
          <mesh key={p.key} position={p.pos} rotation={rot as unknown as [number, number, number]} castShadow receiveShadow>
            {kind === 'cyl' && <cylinderGeometry args={[p.size[0], p.size[0], p.size[1], 10]} />}
            {kind === 'cone' && <coneGeometry args={[p.size[0], p.size[1], 8]} />}
            {kind === 'box' && <boxGeometry args={p.size} />}
            <meshStandardMaterial
              color={p.color}
              roughness={0.85}
              metalness={preset === 'space' ? 0.35 : 0.04}
              side={DoubleSide}
            />
          </mesh>
        );
      })}
    </group>
  );
}
