/**
 * EnvMesh · 环境几何体
 *
 * 5 个预设（与 schema 一致）：
 * - room_small: 8x3x6 小房间 + 4 面墙
 * - corridor: 4x3x20 长走廊
 * - street: 12x6x30 街道 + 两侧楼
 * - forest: 40x8x40 森林（树）
 * - space: 20x12x40 太空舱
 *
 * MVP 只画最基本几何 · 给导演看空间感
 */

import { useMemo } from 'react';
import { DoubleSide } from 'three';
import type { Vec3, ScenePreset } from '../store/scene';

interface Props {
  preset: ScenePreset;
  size: Vec3;
}

export function EnvMesh({ preset, size }: Props) {
  const [w, h, d] = size;

  const walls = useMemo(() => {
    if (preset === 'corridor') {
      // 长走廊：左墙 + 右墙 + 天花 + 地板
      return [
        { key: 'left',  size: [0.2, h, d] as Vec3, pos: [-w / 2, h / 2, 0] as Vec3 },
        { key: 'right', size: [0.2, h, d] as Vec3, pos: [w / 2, h / 2, 0] as Vec3 },
        { key: 'ceil',  size: [w, 0.2, d] as Vec3, pos: [0, h, 0] as Vec3 },
        { key: 'floor', size: [w, 0.2, d] as Vec3, pos: [0, 0, 0] as Vec3 },
      ];
    }
    if (preset === 'room_small') {
      // 小房间：四面墙 + 天花 + 地板
      return [
        { key: 'floor', size: [w, 0.2, d] as Vec3, pos: [0, 0, 0] as Vec3 },
        { key: 'ceil',  size: [w, 0.2, d] as Vec3, pos: [0, h, 0] as Vec3 },
        { key: 'wall-z+', size: [w, h, 0.2] as Vec3, pos: [0, h / 2, d / 2] as Vec3 },
        { key: 'wall-z-', size: [w, h, 0.2] as Vec3, pos: [0, h / 2, -d / 2] as Vec3 },
        { key: 'wall-x+', size: [0.2, h, d] as Vec3, pos: [w / 2, h / 2, 0] as Vec3 },
        { key: 'wall-x-', size: [0.2, h, d] as Vec3, pos: [-w / 2, h / 2, 0] as Vec3 },
      ];
    }
    if (preset === 'street') {
      // 街道：两侧楼 + 地面
      return [
        { key: 'floor', size: [w, 0.2, d] as Vec3, pos: [0, 0, 0] as Vec3 },
        { key: 'bldg-1', size: [3, 5, d] as Vec3, pos: [-w / 2 + 1.5, 2.5, 0] as Vec3 },
        { key: 'bldg-2', size: [3, 5, d] as Vec3, pos: [w / 2 - 1.5, 2.5, 0] as Vec3 },
      ];
    }
    if (preset === 'forest') {
      // 森林：地面 + 树（4 个随机位置）
      const trees: Array<{ key: string; pos: Vec3 }> = [];
      for (let i = 0; i < 12; i++) {
        trees.push({
          key: `tree-${i}`,
          pos: [(Math.random() - 0.5) * w * 0.9, 0, (Math.random() - 0.5) * d * 0.9] as Vec3,
        });
      }
      return [
        { key: 'floor', size: [w, 0.2, d] as Vec3, pos: [0, 0, 0] as Vec3 },
        ...trees.map((t) => ({ key: t.key, size: [1, 6, 1] as Vec3, pos: t.pos })),
      ];
    }
    if (preset === 'space') {
      // 太空舱：地板 + 远处星空参考（用一个大盒子）
      return [
        { key: 'floor', size: [w, 0.2, d] as Vec3, pos: [0, 0, 0] as Vec3 },
        { key: 'back-wall', size: [w, h, 0.2] as Vec3, pos: [0, h / 2, -d / 2] as Vec3 },
      ];
    }
    return [];
  }, [preset, w, h, d]);

  return (
    <group>
      {walls.map((w) => (
        <mesh key={w.key} position={w.pos}>
          <boxGeometry args={w.size} />
          <meshStandardMaterial
            color={preset === 'forest' ? '#2d4a2d' : preset === 'space' ? '#1a1a2e' : '#e9e3d6'}
            roughness={0.9}
            metalness={0}
            side={DoubleSide}
          />
        </mesh>
      ))}
      {/* 房间 / 走廊的地面用稍深的色 */}
      {preset !== 'forest' && preset !== 'space' && (
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[preset === 'corridor' ? d : w, preset === 'corridor' ? w : d]} />
          <meshStandardMaterial color="#c8c1ab" roughness={1} />
        </mesh>
      )}
    </group>
  );
}