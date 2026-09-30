<?php
declare(strict_types=1);

/**
 * 3D 导演台 · API: 启动包（场景/运镜/Pose 模板）
 *
 * 路由：GET /api/director_stage_assets.php
 * 用途：前端启动时一次拿全所有 UI 下拉数据
 */

require_once __DIR__ . '/../../lib/auth.php';
auth_boot();
$u = require_login_api();
session_write_close();

require_once __DIR__ . '/../lib/director_stage_assets.php';

json_response([
    'ok'   => true,
    'data' => ds_assets_bootstrap(),
]);