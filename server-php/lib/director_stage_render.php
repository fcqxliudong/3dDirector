<?php
declare(strict_types=1);

/**
 * 3D 导演台 · 视频模型渲染
 *
 * 复用 ai_video 的 model_entries（用户在 admin 里配的 key / base_url）
 * 喂 mp4 粗略视频 + 派生 prompt 给视频模型 API（可灵 / 海螺 / AGNES）
 *
 * 关键设计：
 * - 不重复实现视频模型调用，复用 ai_video 的 video 模型 category
 * - 派生 prompt：从 SceneJSON 自动生成英文 prompt
 * - 渲染任务用 director_stage_render_job 表异步跟踪
 *
 * 依赖：
 *   ai_video/lib/model_entries.php  -- model_entry_runtime_credentials()
 *   ai_video/lib/media_generate.php -- 视频生成的实际 HTTP 调用（参考实现）
 */

// 部署位置：/home/wwwroot/ai_video/3d/lib/
// 复用 ai_video 的 lib/ → 走 ../lib/ 跨一级目录
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/llm_api.php';
require_once __DIR__ . '/../lib/model_entries.php';
require_once __DIR__ . '/director_stage_schema.php';

/**
 * 从 SceneJSON 派生英文 prompt
 *
 * 设计原则：
 * - 不翻译中文标签（保留原文作为视觉描述）
 * - 加运镜动作词
 * - 加画面比例 / 时长提示
 */
function ds_render_derive_prompt(array $scene): string
{
    $parts = [];

    // 1. 场景描述
    $presetLabels = [
        'room_small' => 'small room',
        'corridor'   => 'corridor',
        'street'     => 'street',
        'forest'     => 'forest',
        'space'      => 'sci-fi space environment',
    ];
    $preset = $scene['scene']['preset'] ?? 'room_small';
    $parts[] = $presetLabels[$preset] ?? 'scene';

    // 2. 角色描述
    foreach ($scene['actors'] ?? [] as $a) {
        $color = $a['color'] ?? '#888888';
        $label = $a['label'] ?? 'character';
        $pose = $a['pose'] ?? 'stand';
        $parts[] = "{$color} {$label} ({$pose})";
    }

    // 3. 运镜描述（从 keyframes 推断）
    $kfs = $scene['camera']['keyframes'] ?? [];
    if (count($kfs) >= 2) {
        $first = $kfs[0]['pos'] ?? [0, 0, 0];
        $last  = end($kfs);
        $lastPos = is_array($last) ? ($last['pos'] ?? $first) : $first;
        $dx = (float)$lastPos[0] - (float)$first[0];
        $dz = (float)$lastPos[2] - (float)$first[2];
        $dist = sqrt($dx * $dx + $dz * $dz);

        if ($dist < 0.5) {
            $parts[] = 'static shot';
        } elseif ($dz > 2.0 && abs($dx) < 1.0) {
            $parts[] = 'push-in shot moving forward';
        } elseif ($dz < -2.0 && abs($dx) < 1.0) {
            $parts[] = 'pull-out shot moving backward';
        } elseif (abs($dx) > 2.0) {
            $parts[] = 'tracking shot moving sideways';
        } else {
            $parts[] = 'cinematic camera movement';
        }
    }

    // 4. 画面比例
    $aspect = $scene['aspect'] ?? '2.39:1';
    $parts[] = "cinematic {$aspect} aspect ratio";

    // 5. 时长
    $duration = (float)($scene['duration'] ?? 5);
    $parts[] = sprintf('%ds duration', (int)$duration);

    return implode(', ', $parts);
}

/**
 * 异步提交渲染任务到 director_stage_render_job 表
 *
 * 实际视频模型 HTTP 调用不在这里做，由 worker 进程（或 cron / queue）
 * 扫描 status='queued' 的行 → 调视频模型 → 更新 status。
 *
 * 这样不阻塞 API 响应 · 用户可以轮询 job 状态。
 */
function ds_render_submit(int $uid, int $sceneId, string $provider, string $modelId): array
{
    if ($sceneId <= 0) {
        return ['ok' => false, 'error' => 'sceneId 非法'];
    }

    // 校验用户对这个场景的访问权
    $scene = ds_scene_load($uid, $sceneId);
    if ($scene === null) {
        return ['ok' => false, 'error' => "scene #$sceneId 不存在或不属于当前用户"];
    }

    // 校验 provider/model 在 model_entries 里
    $creds = model_entry_runtime_credentials('video', $provider, $modelId, $uid);
    if (empty($creds['has_key'])) {
        return ['ok' => false, 'error' => "video provider=$provider model=$modelId 未配置凭据"];
    }

    // 派生 prompt
    $prompt = ds_render_derive_prompt($scene);

    // 入库
    $stmt = db()->prepare(
        "INSERT INTO director_stage_render_job
         (scene_id, owner_id, video_model, video_provider, video_model_id, prompt, status)
         VALUES (:scene_id, :owner_id, :video_model, :provider, :model_id, :prompt, 'queued')"
    );
    $stmt->execute([
        ':scene_id'   => $sceneId,
        ':owner_id'   => $uid,
        ':video_model'=> $provider . ':' . $modelId,
        ':provider'   => $provider,
        ':model_id'   => $modelId,
        ':prompt'     => $prompt,
    ]);

    $jobId = (int)db()->lastInsertId();
    return ['ok' => true, 'job_id' => $jobId, 'status' => 'queued', 'prompt' => $prompt];
}

/**
 * 查询渲染任务状态
 */
function ds_render_job_get(int $uid, int $jobId): ?array
{
    $stmt = db()->prepare(
        'SELECT * FROM director_stage_render_job
         WHERE id = :id AND owner_id = :uid LIMIT 1'
    );
    $stmt->execute([':id' => $jobId, ':uid' => $uid]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/**
 * 列出某用户的渲染任务
 */
function ds_render_job_list(int $uid, int $limit = 20): array
{
    $stmt = db()->prepare(
        'SELECT id, scene_id, video_model, status, result_video_url,
                created_at, started_at, finished_at, error_message
         FROM director_stage_render_job
         WHERE owner_id = :uid
         ORDER BY id DESC LIMIT ' . max(1, min($limit, 100))
    );
    $stmt->execute([':uid' => $uid]);
    return $stmt->fetchAll();
}

/**
 * Worker 调用：取出下一个 queued 任务
 * （用 SELECT ... FOR UPDATE SKIP LOCKED 避免多 worker 抢同一行）
 */
function ds_render_job_claim_next(): ?array
{
    $stmt = db()->prepare(
        "SELECT * FROM director_stage_render_job
         WHERE status = 'queued'
         ORDER BY id ASC LIMIT 1
         FOR UPDATE SKIP LOCKED"
    );
    $stmt->execute();
    $row = $stmt->fetch();
    if (!$row) {
        return null;
    }
    $upd = db()->prepare(
        "UPDATE director_stage_render_job
         SET status = 'running', started_at = NOW()
         WHERE id = :id AND status = 'queued'"
    );
    $upd->execute([':id' => $row['id']]);
    $row['status'] = 'running';
    return $row;
}

/**
 * Worker 调用：标记任务完成
 */
function ds_render_job_complete(int $jobId, string $resultVideoUrl, ?array $meta = null): bool
{
    $stmt = db()->prepare(
        "UPDATE director_stage_render_job
         SET status = 'success',
             result_video_url = :url,
             result_meta_json = :meta,
             finished_at = NOW()
         WHERE id = :id AND status = 'running'"
    );
    $stmt->execute([
        ':id'   => $jobId,
        ':url'  => $resultVideoUrl,
        ':meta' => $meta === null ? null : json_encode($meta, JSON_UNESCAPED_UNICODE),
    ]);
    return $stmt->rowCount() > 0;
}

function ds_render_job_fail(int $jobId, string $errorMessage): bool
{
    $stmt = db()->prepare(
        "UPDATE director_stage_render_job
         SET status = 'failed',
             error_message = :err,
             finished_at = NOW()
         WHERE id = :id AND status IN ('queued', 'running')"
    );
    $stmt->execute([
        ':id'  => $jobId,
        ':err' => substr($errorMessage, 0, 1024),
    ]);
    return $stmt->rowCount() > 0;
}