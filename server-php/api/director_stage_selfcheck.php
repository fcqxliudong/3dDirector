<?php
declare(strict_types=1);

/**
 * 3D 导演台 · API: 多模态自校验
 *
 * 路由：POST /api/director_stage_selfcheck.php
 *   body: { scene_id, image_url, render_job_id? }
 *
 * 用多模态 LLM 拿首帧图 + 剧本判断
 * 返回：{ ok, result: { result: pass/warn/fail, issues: [...], summary } }
 */

require_once __DIR__ . '/../../lib/auth.php';
auth_boot();
$u = require_login_api();
session_write_close();
$uid = (int)$u['id'];

require_once __DIR__ . '/../lib/director_stage_schema.php';
require_once __DIR__ . '/../lib/director_stage_selfcheck.php';

$raw = file_get_contents('php://input');
$body = json_decode($raw, true);
if (!is_array($body)) {
    json_response(['ok' => false, 'error' => 'body 必须是 JSON'], 400);
    return;
}

$sceneId      = (int)($body['scene_id'] ?? 0);
$imageUrl     = (string)($body['image_url'] ?? '');
$renderJobId  = isset($body['render_job_id']) ? (int)$body['render_job_id'] : null;

if ($sceneId <= 0 || $imageUrl === '') {
    json_response(['ok' => false, 'error' => 'scene_id / image_url 必填'], 400);
    return;
}

if (!filter_var($imageUrl, FILTER_VALIDATE_URL) && !str_starts_with($imageUrl, 'data:')) {
    json_response(['ok' => false, 'error' => 'image_url 必须是合法 URL 或 data: URI'], 400);
    return;
}

$r = ds_selfcheck($uid, $sceneId, $imageUrl, $renderJobId);

error_log(sprintf(
    '[director_stage] selfcheck uid=%d scene=%d job=%s ok=%d verdict=%s',
    $uid, $sceneId, $renderJobId ? (string)$renderJobId : '-', $r['ok'] ? 1 : 0,
    $r['result']['result'] ?? '-'
));

json_response($r, $r['ok'] ? 200 : 500);