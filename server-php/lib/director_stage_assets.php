<?php
declare(strict_types=1);

/**
 * 3D 导演台 · 资产模板
 *
 * 给前端展示用的场景预设 / 运镜模板 / Pose 模板
 * 跟 lib/director_stage_schema.php 的枚举一一对应
 * 前端启动时 GET /api/director_stage_assets 拿这份数据
 */

require_once __DIR__ . '/director_stage_schema.php';

/**
 * 场景预设详情（前端下拉用）
 */
function ds_assets_scene_presets(): array
{
    $out = [];
    foreach (DS_SCENE_PRESETS as $key => $info) {
        $out[] = [
            'id'    => $key,
            'label' => $info['label'],
            'size'  => $info['size'],
        ];
    }
    return $out;
}

/**
 * 运镜模板（前端用 · 选模板 + 调参数 → 生成关键帧）
 */
function ds_assets_camera_moves(): array
{
    return [
        [
            'id'          => 'push_in',
            'label'       => '推镜头',
            'description' => '从远到近推进，营造紧张感',
            'params'      => ['distance', 'duration', 'easing'],
            'default'     => ['distance' => 4.0, 'duration' => 4.0, 'easing' => 'easeInOut'],
        ],
        [
            'id'          => 'pull_out',
            'label'       => '拉镜头',
            'description' => '从近到远拉出，揭示环境',
            'params'      => ['distance', 'duration', 'easing'],
            'default'     => ['distance' => 4.0, 'duration' => 4.0, 'easing' => 'easeOut'],
        ],
        [
            'id'          => 'orbit',
            'label'       => '环绕',
            'description' => '环绕主体 180° / 360°',
            'params'      => ['angle', 'radius', 'duration'],
            'default'     => ['angle' => 180, 'radius' => 3.0, 'duration' => 6.0],
        ],
        [
            'id'          => 'crane_up',
            'label'       => '升起',
            'description' => '从地面升起，上帝视角',
            'params'      => ['start_height', 'end_height', 'duration'],
            'default'     => ['start_height' => 1.6, 'end_height' => 6.0, 'duration' => 5.0],
        ],
        [
            'id'          => 'tracking',
            'label'       => '横移',
            'description' => '跟随主体横向移动',
            'params'      => ['distance', 'height', 'duration'],
            'default'     => ['distance' => 4.0, 'height' => 1.6, 'duration' => 4.0],
        ],
        [
            'id'          => 'static',
            'label'       => '固定机位',
            'description' => '不移动 · 适合对话 / 静态展示',
            'params'      => ['duration'],
            'default'     => ['duration' => 5.0],
        ],
    ];
}

/**
 * Actor Pose 模板
 */
function ds_assets_actor_poses(): array
{
    return [
        ['id' => 'stand',  'label' => '站立'],
        ['id' => 'walk',   'label' => '行走'],
        ['id' => 'run',    'label' => '奔跑'],
        ['id' => 'sit',    'label' => '坐下'],
        ['id' => 'crouch', 'label' => '蹲下'],
        ['id' => 'idle',   'label' => '闲置'],
    ];
}

/**
 * 画面比例详情
 */
function ds_assets_aspect_ratios(): array
{
    $out = [];
    foreach (DS_ASPECT_RATIOS as $r) {
        $info = DS_ASPECT_RATIO_INFO[$r];
        $out[] = [
            'id'    => $r,
            'label' => $info['label'],
            'ratio' => $info['ratio'],
            'use'   => $info['use'],
        ];
    }
    return $out;
}

/**
 * 给前端的"启动包"：一次 GET 拿全所有资产
 */
function ds_assets_bootstrap(): array
{
    return [
        'schema_version' => DS_SCHEMA_VERSION,
        'duration'       => [
            'min'    => DS_DURATION_MIN,
            'max'    => DS_DURATION_MAX,
            'default'=> 5,
            'note'   => '30s 硬约束 · 不做超长拼接',
        ],
        'fps'            => DS_FPS_VALUES,
        'aspect_ratios'  => ds_assets_aspect_ratios(),
        'scene_presets'  => ds_assets_scene_presets(),
        'camera_moves'   => ds_assets_camera_moves(),
        'actor_poses'    => ds_assets_actor_poses(),
        'ease_types'     => DS_EASE_TYPES,
        'limits'         => DS_SCENE_LIMITS,
    ];
}