<?php
declare(strict_types=1);

/**
 * 3D 导演台 · v0.1 · JSON Schema 校验（PHP 版）
 *
 * 严格对齐 packages/scene-schema v0.1（TypeScript + Zod 版）
 * 双语同步：TS schema 是规范源，PHP 是 Web 端入口 + API 校验
 *
 * 使用：
 *   require_once __DIR__ . '/director_stage_schema.php';
 *   $r = ds_validate_scene($input);
 *   if (!$r['ok']) { json_response(['errors' => $r['errors']], 400); }
 *   $scene = $r['data'];
 */

// ─── Schema 版本号 · 必须与 packages/scene-schema/src/constants.ts 一致 ────
const DS_SCHEMA_VERSION = '0.1';

// ─── 时长硬约束 · 用户给定 · 不做超 30s 拼接 ────────────────────────────
const DS_DURATION_MIN = 1;
const DS_DURATION_MAX = 30;

// ─── 帧率 ────────────────────────────────────────────────────────────────
const DS_FPS_VALUES = [24, 30, 60];

// ─── 画面比例（8 个 · 与 TS 版一一对应） ──────────────────────────────────
const DS_ASPECT_RATIOS = [
    '2.76:1', // Ultra Panavision 70
    '2.39:1', // Scope / Anamorphic
    '2.00:1', // IMAX 增强
    '1.85:1', // Flat
    '16:9',   // 1.78:1 HDTV / 流媒体
    '4:3',    // 1.33:1 Academy
    '9:16',   // 短视频
    '1:1',    // 社交方形
];

const DS_ASPECT_RATIO_INFO = [
    '2.76:1' => ['label' => 'Ultra Panavision 70', 'ratio' => 2.76,    'use' => '早期 70mm 宽幅'],
    '2.39:1' => ['label' => 'Scope / Anamorphic',  'ratio' => 2.39,    'use' => '现代电影主流'],
    '2.00:1' => ['label' => 'IMAX 增强',          'ratio' => 2.0,     'use' => 'IMAX 数字 / Netflix 顶级'],
    '1.85:1' => ['label' => 'Flat',                'ratio' => 1.85,    'use' => '北美院线标准'],
    '16:9'   => ['label' => '16:9 HDTV',           'ratio' => 16 / 9,  'use' => 'HDTV / 流媒体'],
    '4:3'    => ['label' => '4:3 Academy',         'ratio' => 4 / 3,   'use' => '早期学院 / 复古'],
    '9:16'   => ['label' => '9:16 竖屏',          'ratio' => 9 / 16,  'use' => '短视频 / 移动'],
    '1:1'    => ['label' => '1:1 方形',           'ratio' => 1,       'use' => '社交方形'],
];

// ─── Actor Pose（6 个） ───────────────────────────────────────────────────
const DS_ACTOR_POSES = ['stand', 'walk', 'run', 'sit', 'crouch', 'idle'];

// ─── 运镜模板（6 个 · Week 2 实现） ──────────────────────────────────────
const DS_CAMERA_MOVE_TYPES = ['push_in', 'pull_out', 'orbit', 'crane_up', 'tracking', 'static'];

// ─── Ease（4 个） ────────────────────────────────────────────────────────
const DS_EASE_TYPES = ['linear', 'easeIn', 'easeOut', 'easeInOut'];

// ─── 场景空间（open 为主；旧名仅兼容） ───────────────────────────────────
const DS_SCENE_PRESETS = [
    'open'       => ['label' => '开放空间', 'size' => [24, 3, 24]],
    'room_small' => ['label' => '小房间(旧)', 'size' => [8, 3, 6]],
    'corridor'   => ['label' => '走廊(旧)',   'size' => [4, 3, 20]],
    'street'     => ['label' => '街道(旧)',    'size' => [12, 6, 30]],
    'forest'     => ['label' => '森林(旧)',    'size' => [40, 8, 40]],
    'space'      => ['label' => '太空(旧)',    'size' => [20, 12, 40]],
];

const DS_ENV_KINDS = ['ground', 'box', 'cyl', 'cone', 'wall'];

// ─── 限制常量 ────────────────────────────────────────────────────────────
const DS_SCENE_LIMITS = [
    'actors_max'             => 10,
    'camera_keyframes_min'   => 2,
    'camera_keyframes_max'   => 20,
    'camera_fov_min'         => 10,
    'camera_fov_max'         => 120,
];

/**
 * 创建空场景（与 TS emptyScene() 一一对应）
 */
function ds_empty_scene(string $preset = 'open'): array
{
    if (!isset(DS_SCENE_PRESETS[$preset])) {
        $preset = 'open';
    }
    $info = DS_SCENE_PRESETS[$preset];
    $size = $info['size'];
    $w = (float)$size[0];
    $d = (float)$size[2];
    return [
        'version'  => DS_SCHEMA_VERSION,
        'scene'    => [
            'preset' => 'open',
            'size'   => $size,
            'env'    => [
                [
                    'id' => 'ground',
                    'kind' => 'ground',
                    'pos' => [0, 0, 0],
                    'size' => [$w, 0.08, $d],
                    'color' => '#6a7360',
                ],
            ],
        ],
        'actors'   => [],
        'camera'   => [
            'fov'       => 35,
            'keyframes' => [
                ['t' => 0, 'pos' => [0, 1.6, max(6.0, $d * 0.35)],  'lookAt' => [0, 1.5, 0]],
                ['t' => 5, 'pos' => [0, 1.5, max(3.0, $d * 0.2)],  'lookAt' => [0, 1.5, 0], 'ease' => 'easeInOut'],
            ],
        ],
        'duration' => 5,
        'fps'      => 24,
        'aspect'   => '2.39:1',
    ];
}

/**
 * 校验场景 JSON
 *
 * 返回：
 *   ['ok' => true,  'data' => $normalized]
 *   ['ok' => false, 'errors' => [['path' => '...', 'message' => '...']]]
 */
function ds_validate_scene(mixed $input): array
{
    $errors = [];

    if (!is_array($input)) {
        return ['ok' => false, 'errors' => [['path' => '$', 'message' => '顶层必须是对象']]];
    }

    // version
    if (($input['version'] ?? null) !== DS_SCHEMA_VERSION) {
        $errors[] = ['path' => 'version', 'message' => "version 必须是 " . DS_SCHEMA_VERSION];
    }

    // scene
    if (!isset($input['scene']) || !is_array($input['scene'])) {
        $errors[] = ['path' => 'scene', 'message' => 'scene 字段缺失或不是对象'];
    } else {
        $preset = $input['scene']['preset'] ?? null;
        if (!is_string($preset) || !isset(DS_SCENE_PRESETS[$preset])) {
            $errors[] = ['path' => 'scene.preset', 'message' => 'scene.preset 非法'];
        }
        $size = $input['scene']['size'] ?? null;
        if (!ds_is_vec3($size)) {
            $errors[] = ['path' => 'scene.size', 'message' => 'scene.size 必须是 [w, h, d] 三元数组'];
        } else {
            foreach ($size as $i => $v) {
                if ($v <= 0) {
                    $errors[] = ['path' => "scene.size[$i]", 'message' => "scene.size[$i] 必须 > 0"];
                }
            }
        }
        if (isset($input['scene']['env'])) {
            $env = $input['scene']['env'];
            if (!is_array($env)) {
                $errors[] = ['path' => 'scene.env', 'message' => 'scene.env 必须是数组'];
            } elseif (count($env) > 40) {
                $errors[] = ['path' => 'scene.env', 'message' => 'scene.env 最多 40 项'];
            } else {
                foreach ($env as $ei => $ep) {
                    if (!is_array($ep)) {
                        $errors[] = ['path' => "scene.env[$ei]", 'message' => 'env 项必须是对象'];
                        continue;
                    }
                    $kind = $ep['kind'] ?? '';
                    if (!is_string($kind) || !in_array($kind, DS_ENV_KINDS, true)) {
                        $errors[] = ['path' => "scene.env[$ei].kind", 'message' => 'env.kind 非法'];
                    }
                    if (!isset($ep['id']) || !is_string($ep['id']) || $ep['id'] === '') {
                        $errors[] = ['path' => "scene.env[$ei].id", 'message' => 'env.id 必填'];
                    }
                    if (!ds_is_vec3($ep['pos'] ?? null)) {
                        $errors[] = ['path' => "scene.env[$ei].pos", 'message' => 'env.pos 必须是 vec3'];
                    }
                    if (!ds_is_vec3($ep['size'] ?? null)) {
                        $errors[] = ['path' => "scene.env[$ei].size", 'message' => 'env.size 必须是 vec3'];
                    }
                }
            }
        }
    }

    // actors
    $actors = $input['actors'] ?? null;
    if (!is_array($actors)) {
        $errors[] = ['path' => 'actors', 'message' => 'actors 字段缺失或不是数组'];
    } elseif (count($actors) > DS_SCENE_LIMITS['actors_max']) {
        $errors[] = ['path' => 'actors', 'message' => 'actors 数量超过 ' . DS_SCENE_LIMITS['actors_max']];
    } else {
        $ids = [];
        foreach ($actors as $i => $a) {
            if (!is_array($a)) {
                $errors[] = ['path' => "actors[$i]", 'message' => 'actor 必须是对象'];
                continue;
            }
            $id = $a['id'] ?? null;
            if (!is_string($id) || $id === '') {
                $errors[] = ['path' => "actors[$i].id", 'message' => 'actor.id 缺失或非字符串'];
            } else {
                if (isset($ids[$id])) {
                    $errors[] = ['path' => "actors[$i].id", 'message' => "actor.id='$id' 重复"];
                }
                $ids[$id] = true;
            }
            if (!is_string($a['label'] ?? null) || $a['label'] === '') {
                $errors[] = ['path' => "actors[$i].label", 'message' => 'actor.label 缺失'];
            }
            if (!preg_match('/^#[0-9a-fA-F]{6}$/', (string)($a['color'] ?? ''))) {
                $errors[] = ['path' => "actors[$i].color", 'message' => 'actor.color 必须是 #RRGGBB'];
            }
            if (!ds_is_vec3($a['start'] ?? null)) {
                $errors[] = ['path' => "actors[$i].start", 'message' => 'actor.start 必须是 Vec3'];
            }
            if (isset($a['facing']) && !ds_is_vec3($a['facing'])) {
                $errors[] = ['path' => "actors[$i].facing", 'message' => 'actor.facing 必须是 Vec3'];
            }
            $pose = $a['pose'] ?? null;
            if (!in_array($pose, DS_ACTOR_POSES, true)) {
                $errors[] = ['path' => "actors[$i].pose", 'message' => 'actor.pose 必须是 6 个枚举之一'];
            }

            // moves
            if (isset($a['moves'])) {
                if (!is_array($a['moves'])) {
                    $errors[] = ['path' => "actors[$i].moves", 'message' => 'actor.moves 必须是数组'];
                } else {
                    $sortedMoves = $a['moves'];
                    usort($sortedMoves, fn ($x, $y) => ($x['t0'] ?? 0) <=> ($y['t0'] ?? 0));
                    foreach ($a['moves'] as $j => $m) {
                        if (!ds_is_vec3($m['to'] ?? null)) {
                            $errors[] = ["path" => "actors[$i].moves[$j].to", 'message' => 'move.to 必须是 Vec3'];
                        }
                        if (!is_numeric($m['t0'] ?? null) || !is_numeric($m['t1'] ?? null)) {
                            $errors[] = ['path' => "actors[$i].moves[$j]", 'message' => 'move.t0/t1 必须是数字'];
                            continue;
                        }
                        if ($m['t0'] >= $m['t1']) {
                            $errors[] = ['path' => "actors[$i].moves[$j]", 'message' => 'move.t0 必须 < t1'];
                        }
                        if (!in_array($m['pose'] ?? null, DS_ACTOR_POSES, true)) {
                            $errors[] = ['path' => "actors[$i].moves[$j].pose", 'message' => 'move.pose 必须是 6 个枚举之一'];
                        }
                    }
                    // 时间重叠检测
                    for ($k = 1; $k < count($sortedMoves); $k++) {
                        if ($sortedMoves[$k]['t0'] < $sortedMoves[$k - 1]['t1']) {
                            $errors[] = ['path' => "actors[$i].moves", 'message' => 'actor.moves 时间不能重叠'];
                            break;
                        }
                    }
                }
            }
        }
    }

    // camera
    if (!isset($input['camera']) || !is_array($input['camera'])) {
        $errors[] = ['path' => 'camera', 'message' => 'camera 字段缺失'];
    } else {
        $cam = $input['camera'];
        $fov = $cam['fov'] ?? null;
        if (!is_numeric($fov) || $fov < DS_SCENE_LIMITS['camera_fov_min'] || $fov > DS_SCENE_LIMITS['camera_fov_max']) {
            $errors[] = ['path' => 'camera.fov', 'message' => 'camera.fov 必须在 [' . DS_SCENE_LIMITS['camera_fov_min'] . ', ' . DS_SCENE_LIMITS['camera_fov_max'] . ']'];
        }
        $kfs = $cam['keyframes'] ?? null;
        if (!is_array($kfs)) {
            $errors[] = ['path' => 'camera.keyframes', 'message' => 'camera.keyframes 缺失或不是数组'];
        } else {
            if (count($kfs) < DS_SCENE_LIMITS['camera_keyframes_min']) {
                $errors[] = ['path' => 'camera.keyframes', 'message' => 'camera.keyframes 至少 ' . DS_SCENE_LIMITS['camera_keyframes_min'] . ' 个'];
            }
            if (count($kfs) > DS_SCENE_LIMITS['camera_keyframes_max']) {
                $errors[] = ['path' => 'camera.keyframes', 'message' => 'camera.keyframes 最多 ' . DS_SCENE_LIMITS['camera_keyframes_max'] . ' 个'];
            }
            foreach ($kfs as $i => $kf) {
                if (!is_array($kf)) {
                    $errors[] = ['path' => "camera.keyframes[$i]", 'message' => 'keyframe 必须是对象'];
                    continue;
                }
                if (!ds_is_vec3($kf['pos'] ?? null)) {
                    $errors[] = ['path' => "camera.keyframes[$i].pos", 'message' => 'keyframe.pos 必须是 Vec3'];
                }
                $la = $kf['lookAt'] ?? null;
                if (is_string($la)) {
                    // 引用 actor.id
                    if (!isset($ids[$la])) {
                        $errors[] = ['path' => "camera.keyframes[$i].lookAt", 'message' => "keyframe.lookAt 引用了不存在的 actor.id=\"$la\""];
                    }
                } elseif (!ds_is_vec3($la)) {
                    $errors[] = ['path' => "camera.keyframes[$i].lookAt", 'message' => 'keyframe.lookAt 必须是 actor.id 或 Vec3'];
                }
                if (isset($kf['ease']) && !in_array($kf['ease'], DS_EASE_TYPES, true)) {
                    $errors[] = ['path' => "camera.keyframes[$i].ease", 'message' => 'ease 必须是 4 个枚举之一'];
                }
                if (isset($kf['t']) && !is_numeric($kf['t'])) {
                    $errors[] = ['path' => "camera.keyframes[$i].t", 'message' => 'keyframe.t 必须是数字'];
                }
            }
            // 时间单调非递减
            for ($i = 1; $i < count($kfs); $i++) {
                if (($kfs[$i]['t'] ?? 0) < ($kfs[$i - 1]['t'] ?? 0)) {
                    $errors[] = ['path' => 'camera.keyframes', 'message' => 'keyframes 时间必须单调非递减'];
                    break;
                }
            }
        }
    }

    // duration（硬约束 1-30s）
    $dur = $input['duration'] ?? null;
    if (!is_numeric($dur)) {
        $errors[] = ['path' => 'duration', 'message' => 'duration 必须是数字'];
    } elseif ($dur < DS_DURATION_MIN || $dur > DS_DURATION_MAX) {
        $errors[] = ['path' => 'duration', 'message' => "duration 必须在 [" . DS_DURATION_MIN . ", " . DS_DURATION_MAX . "] 秒之间（硬约束）"];
    }

    // fps
    $fps = $input['fps'] ?? null;
    if (!in_array($fps, DS_FPS_VALUES, true)) {
        $errors[] = ['path' => 'fps', 'message' => 'fps 必须是 ' . implode(' / ', DS_FPS_VALUES)];
    }

    // aspect
    $aspect = $input['aspect'] ?? null;
    if (!in_array($aspect, DS_ASPECT_RATIOS, true)) {
        $errors[] = ['path' => 'aspect', 'message' => 'aspect 必须是 8 个合法值之一: ' . implode(', ', DS_ASPECT_RATIOS)];
    }

    // 跨字段：keyframe.t <= duration
    if (is_array($kfs ?? null) && is_numeric($dur)) {
        foreach ($kfs as $i => $kf) {
            if (is_numeric($kf['t'] ?? null) && $kf['t'] > $dur) {
                $errors[] = ['path' => "camera.keyframes[$i].t", 'message' => "keyframe.t({$kf['t']}) 不能超过 duration($dur)"];
            }
        }
    }

    if (count($errors) > 0) {
        return ['ok' => false, 'errors' => $errors];
    }

    return ['ok' => true, 'data' => $input];
}

/**
 * 稳定序列化（key 排序）—— 与 TS stableStringify() 对齐
 * 用于 hash / diff
 */
function ds_stable_stringify(mixed $value): string
{
    return json_encode(ds_sort_keys_deep($value), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function ds_sort_keys_deep(mixed $value): mixed
{
    if (is_array($value)) {
        $is_list = array_keys($value) === range(0, count($value) - 1);
        if ($is_list) {
            return array_map('ds_sort_keys_deep', $value);
        }
        $sorted = [];
        foreach (array_keys($value) as $k) {
            $sorted[$k] = ds_sort_keys_deep($value[$k]);
        }
        ksort($sorted);
        return $sorted;
    }
    return $value;
}

// ─── 内部 helper ─────────────────────────────────────────────────────────
function ds_is_vec3(mixed $v): bool
{
    if (!is_array($v) || count($v) !== 3) {
        return false;
    }
    foreach ($v as $x) {
        if (!is_numeric($x)) {
            return false;
        }
    }
    return true;
}