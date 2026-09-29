<?php
declare(strict_types=1);

/**
 * 3D 导演台 · API: Agent 生成场景
 *
 * 路由：POST /api/director_stage_scene_agent.php
 *   body: { prompt: "...", provider?: "cloudflare" | "agnes" | ... }
 *
 * 返回：{ ok, scene?, error?, errors?, raw? }
 *
 * 关键：
 * - 调 ai_video 的 llm_connection_for（用户配的 model_entries 优先）
 * - LLM 输出做两次校验：JSON parse + SceneJSONSchema
 * - 失败透传 Zod 风格详细 issues
 */

require_once __DIR__ . '/../lib/auth.php';
auth_boot();
$u = require_login_api();
session_write_close();
$uid = (int)$u['id'];

require_once __DIR__ . '/../lib/director_stage_schema.php';
require_once __DIR__ . '/../lib/director_stage_scene_agent.php';

// 限流（MVP 简单实现 · 后续可上 Redis token bucket）
$rateKey = "ds_agent_{$uid}_" . gmdate('YmdH');
$rateFile = sys_get_temp_dir() . "/{$rateKey}";
$count = (int)(@file_get_contents($rateFile) ?: 0);
if ($count >= 60) { // 每小时 60 次
    json_response(['ok' => false, 'error' => 'rate limit · 每小时 60 次'], 429);
}
@file_put_contents($rateFile, (string)($count + 1), LOCK_EX);

$raw = file_get_contents('php://input');
$body = json_decode($raw, true);
if (!is_array($body)) {
    json_response(['ok' => false, 'error' => 'body 必须是 JSON'], 400);
    return;
}

$prompt   = (string)($body['prompt'] ?? '');
$provider = (string)($body['provider'] ?? 'cloudflare');

if (trim($prompt) === '') {
    json_response(['ok' => false, 'error' => 'prompt 不能为空'], 400);
    return;
}

if (mb_strlen($prompt) > 2000) {
    json_response(['ok' => false, 'error' => 'prompt 太长（> 2000 字符）'], 400);
    return;
}

$r = ds_scene_agent_generate($uid, $prompt, $provider);

// 审计日志
error_log(sprintf(
    '[director_stage] scene_agent uid=%d provider=%s ok=%d prompt_len=%d',
    $uid, $provider, $r['ok'] ? 1 : 0, mb_strlen($prompt)
));

if (!$r['ok'] && isset($r['errors'])) {
    json_response($r, 422);
} else {
    json_response($r, $r['ok'] ? 200 : 500);
}