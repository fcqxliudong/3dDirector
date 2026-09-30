<?php
declare(strict_types=1);

/**
 * 3D 导演台 · 自校验（Self-Check）
 *
 * 多模态 LLM 审片：拿首帧图 + 剧本，问 LLM "画面是否与剧本一致"
 *
 * 输入：场景 JSON + 首帧图 URL/路径
 * 输出：{result: pass / warn / fail, issues: [...]}
 *
 * 这是 3D 导演台的最大产品差异化（没人做）· 必须有。
 */

// 部署位置：/home/wwwroot/ai_video/3d/lib/
// 复用 ai_video 的 lib/ → 走 ../lib/ 跨一级目录
require_once __DIR__ . '/../../lib/auth.php';
require_once __DIR__ . '/../../lib/db.php';
require_once __DIR__ . '/../../lib/llm_api.php';
require_once __DIR__ . '/../../lib/model_entries.php';
require_once __DIR__ . '/director_stage_schema.php';

const DS_CHECK_PROMPT = <<<PROMPT
你是「3D 导演台」的多模态审片助手。我会给你：
1. 一份场景 JSON（含 actors / camera / aspect）
2. 一张首帧图（视频模型生成结果的第 0 帧）

请严格按以下 4 维度审查：

1. **角色站位**：图中是否有 JSON 中声明的所有 actor？颜色 / 朝向 / 数量是否对得上？
2. **角色朝向**：每个 actor 的 facing 方向是否符合剧本？
3. **构图**：camera.lookAt 的目标在画面中是否清晰可见？
4. **画面比例**：画面比例是否符合 JSON.aspect？

输出格式（严格 JSON，不要 markdown）：
{
  "result": "pass" | "warn" | "fail",
  "issues": [
    {"dimension": "角色站位", "severity": "high|medium|low", "description": "..."}
  ],
  "summary": "一句话总评"
}

判定规则：
- pass：无问题，或只有 low 严重度问题
- warn：有 1-2 个 medium 严重度问题
- fail：有 1+ 个 high 严重度问题
PROMPT;

/**
 * 调多模态 LLM 审片
 *
 * @param int    $uid
 * @param int    $sceneId
 * @param string $imageUrl  首帧图 URL（外网可访问）或 data: URI
 * @param ?int   $renderJobId
 * @return array{ok: bool, result?: array, error?: string}
 */
function ds_selfcheck(int $uid, int $sceneId, string $imageUrl, ?int $renderJobId = null): array
{
    if (trim($imageUrl) === '') {
        return ['ok' => false, 'error' => 'imageUrl 不能为空'];
    }

    $scene = ds_scene_load($uid, $sceneId);
    if ($scene === null) {
        return ['ok' => false, 'error' => "scene #$sceneId 不存在或不属于当前用户"];
    }

    // 默认用多模态友好的 provider（cloudflare 走 @cf/llava / openai 走 gpt-4o）
    // 这里跑默认通道 · 用户在 admin 配的多模态模型自动生效
    $provider = 'cloudflare';
    $conn = llm_connection_for($provider, $uid);
    $apiKey = (string)($conn['api_key'] ?? '');
    $baseUrl = (string)($conn['base_url'] ?? '');
    if ($apiKey === '' || $baseUrl === '') {
        return ['ok' => false, 'error' => '未配置多模态 LLM 凭据（provider=' . $provider . '）'];
    }
    $modelId = (string)($conn['default_model'] ?? '');

    // 构造 OpenAI 兼容多模态消息
    $payload = [
        'model' => $modelId,
        'messages' => [
            ['role' => 'system', 'content' => DS_CHECK_PROMPT],
            [
                'role' => 'user',
                'content' => [
                    ['type' => 'text',      'text' => "场景 JSON：\n" . json_encode($scene, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)],
                    ['type' => 'image_url', 'image_url' => ['url' => $imageUrl]],
                ],
            ],
        ],
        'temperature' => 0.2,
        'response_format' => ['type' => 'json_object'],
    ];

    $ch = curl_init(rtrim($baseUrl, '/') . '/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $apiKey,
        ],
        CURLOPT_TIMEOUT        => 60,
    ]);
    $respBody = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr  = curl_error($ch);
    curl_close($ch);

    if ($respBody === false) {
        return ['ok' => false, 'error' => '多模态 LLM 请求失败: ' . $curlErr];
    }
    if ($httpCode < 200 || $httpCode >= 300) {
        return ['ok' => false, 'error' => "LLM 返回 $httpCode: " . substr((string)$respBody, 0, 500)];
    }

    $data = json_decode((string)$respBody, true);
    $content = $data['choices'][0]['message']['content'] ?? null;
    if (!is_string($content) || $content === '') {
        return ['ok' => false, 'error' => 'LLM 返回 content 为空'];
    }

    $checkResult = json_decode($content, true);
    if (!is_array($checkResult)) {
        $stripped = preg_replace('/^```(?:json)?\s*/i', '', trim($content));
        $stripped = preg_replace('/\s*```\s*$/', '', $stripped);
        $checkResult = json_decode($stripped, true);
    }
    if (!is_array($checkResult) || !isset($checkResult['result'])) {
        return ['ok' => false, 'error' => 'LLM 返回的不是合法 JSON', 'raw' => $content];
    }

    $verdict = (string)$checkResult['result'];
    if (!in_array($verdict, ['pass', 'warn', 'fail'], true)) {
        $verdict = 'warn';
    }

    // 入库
    try {
        $stmt = db()->prepare(
            "INSERT INTO director_stage_selfcheck
             (scene_id, render_job_id, owner_id, first_frame_path, check_result, check_json, llm_provider, llm_model_id)
             VALUES (:scene_id, :render_job_id, :owner_id, :image_url, :result, :check_json, :provider, :model_id)"
        );
        $stmt->execute([
            ':scene_id'      => $sceneId,
            ':render_job_id' => $renderJobId,
            ':owner_id'      => $uid,
            ':image_url'     => $imageUrl,
            ':result'        => $verdict,
            ':check_json'    => json_encode($checkResult, JSON_UNESCAPED_UNICODE),
            ':provider'      => $provider,
            ':model_id'      => $modelId,
        ]);
    } catch (Throwable $e) {
        // 入库失败不影响主流程
        error_log('[director_stage] selfcheck insert failed: ' . $e->getMessage());
    }

    return ['ok' => true, 'result' => $checkResult];
}