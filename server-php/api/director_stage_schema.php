<?php
declare(strict_types=1);

/**
 * 3D 导演台 · API: 暴露 v0.1 JSON Schema
 *
 * 路由：GET /api/director_stage_schema.php
 * 用途：前端启动时拿 schema 自己做客户端校验
 *
 * 返回：
 *   {
 *     "ok": true,
 *     "schema_version": "0.1",
 *     "duration": { "min": 1, "max": 30, "note": "30s 硬约束" },
 *     "aspect_ratios": [...],
 *     "scene_presets": [...],
 *     "camera_moves": [...],
 *     "actor_poses": [...],
 *     "ease_types": [...]
 *   }
 */

require_once __DIR__ . '/../../lib/auth.php';
auth_boot();
$u = require_login_api();
session_write_close();

require_once __DIR__ . '/../lib/director_stage_schema.php';

json_response([
    'ok'             => true,
    'schema_version' => DS_SCHEMA_VERSION,
    'duration'       => [
        'min'    => DS_DURATION_MIN,
        'max'    => DS_DURATION_MAX,
        'default'=> 5,
        'note'   => '30s 硬约束 · 不做超长拼接',
    ],
    'fps'            => DS_FPS_VALUES,
    'aspect_ratios'  => array_map(
        fn($r) => ['id' => $r, 'label' => DS_ASPECT_RATIO_INFO[$r]['label'], 'ratio' => DS_ASPECT_RATIO_INFO[$r]['ratio']],
        DS_ASPECT_RATIOS,
    ),
    'scene_presets'  => array_keys(DS_SCENE_PRESETS),
    'camera_moves'   => DS_CAMERA_MOVE_TYPES,
    'actor_poses'    => DS_ACTOR_POSES,
    'ease_types'     => DS_EASE_TYPES,
    'limits'         => DS_SCENE_LIMITS,
]);