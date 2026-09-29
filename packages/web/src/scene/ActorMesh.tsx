/**
 * ActorMesh · 单个角色
 *
 * 渲染策略：
 * - 胶囊体（capsule）· 不同颜色（来自 actor.color）
 * - 高矮 / 体型受 pose 影响（简化）
 * - 选中时显示 outline + 标签
 * - 拖动支持（TransformControls 在父级）
 */

import { useRef } from 'react';
import { Group } from 'three';
import { Text } from '@react-three/drei';

interface Props {
  actor: import('../store/scene').Actor;
  selected: boolean;
  onClick: () => void;
}

export function ActorMesh({ actor, selected, onClick }: Props) {
  const ref = useRef<Group>(null);

  // 简化：胶囊高度 + 颜色 + 标签
  const heightByPose: Record<string, number> = {
    stand: 1.7,
    walk: 1.7,
    run: 1.7,
    sit: 0.9,
    crouch: 1.0,
    idle: 1.7,
  };
  const h = heightByPose[actor.pose] ?? 1.7;
  const facing = actor.facing ?? [0, 0, 1];

  return (
    <group
      ref={ref}
      position={actor.start}
      rotation={[0, Math.atan2(facing[0], facing[2]), 0]}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {/* 胶囊身体 */}
      <mesh position={[0, h / 2, 0]} castShadow>
        <capsuleGeometry args={[0.25, h - 0.5, 4, 12]} />
        <meshStandardMaterial
          color={actor.color}
          roughness={0.6}
          metalness={0.1}
          emissive={selected ? actor.color : '#000'}
          emissiveIntensity={selected ? 0.4 : 0}
        />
      </mesh>

      {/* 头部小球（简化） */}
      <mesh position={[0, h + 0.05, 0]} castShadow>
        <sphereGeometry args={[0.18, 12, 12]} />
        <meshStandardMaterial
          color={actor.color}
          roughness={0.5}
          metalness={0.1}
          emissive={selected ? actor.color : '#000'}
          emissiveIntensity={selected ? 0.4 : 0}
        />
      </mesh>

      {/* 朝向箭头（可视化 facing） */}
      <mesh position={[0, h / 2, 0.4]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.08, 0.3, 6]} />
        <meshBasicMaterial color={actor.color} />
      </mesh>

      {/* 选中环 */}
      {selected && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.4, 0.5, 24]} />
          <meshBasicMaterial color="#c97b3f" transparent opacity={0.8} />
        </mesh>
      )}

      {/* 标签 */}
      <Text
        position={[0, h + 0.5, 0]}
        fontSize={0.18}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.012}
        outlineColor="#000"
      >
        {actor.label}
      </Text>
      <Text
        position={[0, h + 0.3, 0]}
        fontSize={0.12}
        color={actor.color}
        anchorX="center"
        anchorY="middle"
      >
        [{actor.id}] {actor.pose}
      </Text>
    </group>
  );
}