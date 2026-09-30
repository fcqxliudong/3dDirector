/**
 * @director-stage/scene-schema · v0.1
 *
 * 枚举常量是 v0.1 的"硬骨头" —— 后期改这层要带迁移脚本，别直接动。
 *
 * 设计原则：
 * - 尽量小集合，方便 LLM 在生成时严格命中
 * - 所有枚举必须有"用途映射"显示给导演（UI 标签）
 * - 加新枚举值必须同步更新 LLM prompt 的 few-shot
 */

// ─── 版本号 ─────────────────────────────────────────
export const SCHEMA_VERSION = '0.1' as const;

// ─── 时长硬约束 ──────────────────────────────────────
// 商业 API 单次生成上限 30s · 用户给的硬约束 · 不做超长拼接
export const DURATION_MIN = 1; // 秒
export const DURATION_MAX = 30; // 秒

// ─── 帧率 ────────────────────────────────────────────
export const FPS_VALUES = [24, 30, 60] as const;
export const FPS_DEFAULT: (typeof FPS_VALUES)[number] = 24;

// ─── 画面比例（8 个） ────────────────────────────────
export const ASPECT_RATIOS = [
  '2.76:1', // Ultra Panavision 70（早期 70mm 宽幅）
  '2.39:1', // Scope / Anamorphic（现代电影主流）
  '2.00:1', // IMAX 增强（IMAX 数字影厅 / Netflix 顶级）
  '1.85:1', // Flat（北美院线标准宽银幕）
  '16:9',   // 1.78:1 HDTV / 流媒体主流
  '4:3',    // 1.33:1 Academy 早期学院标准
  '9:16',   // 短视频 / 移动端
  '1:1',    // 社交方形
] as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const ASPECT_RATIO_INFO: Record<
  AspectRatio,
  { label: string; ratio: number; use: string }
> = {
  '2.76:1': {
    label: 'Ultra Panavision 70',
    ratio: 2.76,
    use: '早期 70mm 宽幅（《阿拉伯的劳伦斯》《2001 太空漫游》原始版）',
  },
  '2.39:1': {
    label: 'Scope / Anamorphic',
    ratio: 2.39,
    use: '现代电影主流（《沙丘》《银翼杀手 2049》《奥本海默》）',
  },
  '2.00:1': {
    label: 'IMAX 增强',
    ratio: 2.0,
    use: 'IMAX 数字影厅 / Netflix 顶级剧集（《怪奇物语》《1899》）',
  },
  '1.85:1': {
    label: 'Flat',
    ratio: 1.85,
    use: '北美院线标准宽银幕（绝大多数好莱坞剧情片）',
  },
  '16:9': {
    label: '16:9 HDTV',
    ratio: 16 / 9,
    use: 'HDTV / 流媒体主流（B站 / YouTube / 优爱腾）',
  },
  '4:3': {
    label: '4:3 Academy',
    ratio: 4 / 3,
    use: '早期学院标准 / 复古艺术片 / Wes Anderson（《布达佩斯大饭店》）',
  },
  '9:16': {
    label: '9:16 竖屏',
    ratio: 9 / 16,
    use: '短视频 / 移动端（抖音 / Reels / TikTok / 视频号）',
  },
  '1:1': {
    label: '1:1 方形',
    ratio: 1,
    use: '社交方形（Instagram / 小红书）',
  },
};

// ─── Actor Pose ──────────────────────────────────────
export const ACTOR_POSES = [
  'stand',   // 站立
  'walk',    // 走
  'run',     // 跑
  'sit',     // 坐
  'crouch',  // 蹲
  'idle',    // 闲置（轻微呼吸 / 摆动）
] as const;

export type ActorPose = (typeof ACTOR_POSES)[number];

// ─── 运镜模板（6 个，v0.1） ─────────────────────────
export const CAMERA_MOVE_TYPES = [
  'push_in',     // 推：从远到近推进，营造紧张感
  'pull_out',    // 拉：从近到远拉出，揭示环境
  'orbit',       // 环绕：环绕主体 180° / 360°
  'crane_up',    // 升起：从地面升起，上帝视角
  'tracking',    // 横移：跟随主体横向移动
  'static',      // 固定机位
] as const;

export type CameraMoveType = (typeof CAMERA_MOVE_TYPES)[number];

// ─── Ease 缓动（4 个） ───────────────────────────────
export const EASE_TYPES = [
  'linear',     // 线性
  'easeIn',     // 缓入
  'easeOut',    // 缓出
  'easeInOut',  // 缓入缓出
] as const;

export type EaseType = (typeof EASE_TYPES)[number];

// ─── 场景空间（open = 智能体自建；旧 preset 名仅兼容旧 JSON） ───
export const SCENE_PRESETS = [
  'open',           // 开放地面 · 默认；几何由 scene.env 描述
  'room_small',     // 兼容旧数据
  'corridor',
  'street',
  'forest',
  'space',
] as const;

export type ScenePreset = (typeof SCENE_PRESETS)[number];

export const SCENE_PRESET_INFO: Record<ScenePreset, { label: string; size: [number, number, number] }> = {
  open:      { label: '开放空间', size: [24, 3, 24] },
  room_small: { label: '小房间(旧)', size: [8, 3, 6] },
  corridor:  { label: '走廊(旧)',   size: [4, 3, 20] },
  street:    { label: '街道(旧)',    size: [12, 6, 30] },
  forest:    { label: '森林(旧)',    size: [40, 8, 40] },
  space:     { label: '太空(旧)',    size: [20, 12, 40] },
};

/** 环境几何（智能体自建 · 一般只要地面+少量墙/道具，不要天花板） */
export const ENV_KINDS = ['ground', 'box', 'cyl', 'cone', 'wall'] as const;
export type EnvKind = (typeof ENV_KINDS)[number];

// ─── 约束检查快捷常量 ────────────────────────────────
export const SCENE_LIMITS = {
  ACTORS_MAX: 10,           // 单场景最多 10 个角色
  ENV_PROPS_MAX: 40,        // 环境几何上限
  CAMERA_KEYFRAMES_MIN: 2,  // 至少 2 个关键帧（起始 + 结束）
  CAMERA_KEYFRAMES_MAX: 20, // 最多 20 个（运镜编辑上限）
  CAMERA_FOV_MIN: 10,       // 广角端
  CAMERA_FOV_MAX: 120,      // 长焦端
} as const;