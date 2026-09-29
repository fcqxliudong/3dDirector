<?php
declare(strict_types=1);

/**
 * 3D 导演台 · 场景生成 Agent
 *
 * 复用 ai_video 的 llm_api.php 调度
 * 输入：用户剧本（自然语言）
 * 输出：合法 SceneJSON v0.1
 *
 * 关键设计：
 * - 用 system prompt 强约束 LLM 输出严格 JSON
 * - 用 ds_validate_scene() 二次校验（防御 LLM 幻觉）
 * - 不通过则重试一次，再不行返回错误
 */

// 部署位置：/home/wwwroot/ai_video/3d/lib/
// 复用 ai_video 的 lib/ → 走 ../lib/ 跨一级目录
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/llm_api.php';
require_once __DIR__ . '/../lib/model_entries.php';
require_once __DIR__ . '/director_stage_schema.php';

/**
 * System prompt · 把 v0.1 schema 用自然语言 + JSON 范例告诉 LLM
 * 保持简洁 · 减少 token · 引导 LLM 一次写对
 */
function ds_agent_system_prompt(): string
{
    $aspectList = implode(' / ', DS_ASPECT_RATIOS);
    $poseList = implode(' / ', DS_ACTOR_POSES);
    $presetList = implode(' / ', array_keys(DS_SCENE_PRESETS));
    $easeList = implode(' / ', DS_EASE_TYPES);

    return <<<PROMPT
你是「3D 导演台」的场景生成助手。根据用户用自然语言描述的剧本，输出一份严格符合 v0.1 schema 的 JSON 场景。

## 硬约束（必须遵守）
1. version 必须是 "0.1"
2. duration 在 [1, 30] 秒之间 · 时长 30s 是硬上限
3. aspect 取值：{$aspectList}
4. fps 取值：24 / 30 / 60（默认 24）
5. actor.pose 取值：{$poseList}
6. scene.preset 取值：{$presetList}
7. actor.color 必须是 #RRGGBB（红 #e74c3c / 蓝 #3498db / 绿 #2ecc71 / 黄 #f1c40f 等）
8. actor.id 全局唯一
9. camera.keyframes 至少 2 个 · 时间单调非递增 · t 不能超过 duration
10. camera.lookAt 可以是 actor.id 引用（推荐）或 [x, y, z] 坐标
11. ease 取值：{$easeList}

## 输出范例
{
  "version": "0.1",
  "scene": {"preset": "room_small", "size": [8, 3, 6]},
  "actors": [
    {"id": "A", "label": "男主", "color": "#e74c3c",
     "start": [-2, 0, 1], "facing": [1, 0, 0], "pose": "stand"}
  ],
  "camera": {
    "fov": 35,
    "keyframes": [
      {"t": 0, "pos": [0, 1.6, 6], "lookAt": "A"},
      {"t": 5, "pos": [0, 1.5, 3], "lookAt": [0, 1.5, 0], "ease": "easeInOut"}
    ]
  },
  "duration": 5, "fps": 24, "aspect": "2.39:1"
}

## 规则
- 只输出 JSON · 不要 markdown 代码块围栏 · 不要解释
- 不要编造 schema 外的字段
- 不要给 actor.moves · MVP 阶段只生成初始场景
PROMPT;
}

/**
 * 生成场景 JSON
 *
 * @param int    $uid          用户 ID
 * @param string $userPrompt   用户自然语言剧本
 * @param string $provider     LLM provider（默认 'cloudflare'，可被 model_entries 覆盖）
 * @return array{ok: bool, scene?: array, error?: string, raw?: string}
 */
function ds_scene_agent_generate(int $uid, string $userPrompt, string $provider = 'cloudflare'): array
{
    if (trim($userPrompt) === '') {
        return ['ok' => false, 'error' => 'userPrompt 不能为空'];
    }

    // 拿 LLM 连接
    $conn = llm_connection_for($provider, $uid);
    $apiKey = (string)($conn['api_key'] ?? '');
    $baseUrl = (string)($conn['base_url'] ?? '');
    if ($apiKey === '' || $baseUrl === '') {
        return ['ok' => false, 'error' => '未配置 LLM 凭据（provider=' . $provider . '）'];
    }
    $modelId = (string)($conn['default_model'] ?? '');

    // 调 LLM（OpenAI Chat Completions 兼容）
    $payload = [
        'model' => $modelId,
        'messages' => [
            ['role' => 'system', 'content' => ds_agent_system_prompt()],
            ['role' => 'user',   'content' => $userPrompt],
        ],
        'temperature' => 0.4,
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
        return ['ok' => false, 'error' => 'LLM HTTP 请求失败: ' . $curlErr];
    }
    if ($httpCode < 200 || $httpCode >= 300) {
        return ['ok' => false, 'error' => "LLM 返回 $httpCode: " . substr((string)$respBody, 0, 500), 'raw' => (string)$respBody];
    }

    $data = json_decode((string)$respBody, true);
    $content = $data['choices'][0]['message']['content'] ?? null;
    if (!is_string($content) || $content === '') {
        return ['ok' => false, 'error' => 'LLM 返回 content 为空', 'raw' => (string)$respBody];
    }

    // 解析 LLM 返回的 JSON
    $scene = json_decode($content, true);
    if (!is_array($scene)) {
        // 兜底：有些 LLM 会包 ```json ... ``` · 尝试剥离
        $stripped = trim((string)$content);
        $stripped = preg_replace('/^```(?:json)?\s*/i', '', $stripped);
        $stripped = preg_replace('/\s*```\s*$/', '', $stripped);
        $scene = json_decode($stripped, true);
    }
    if (!is_array($scene)) {
        return ['ok' => false, 'error' => 'LLM 返回的不是合法 JSON', 'raw' => $content];
    }

    // 校验 v0.1 schema
    $validated = ds_validate_scene($scene);
    if (!$validated['ok']) {
        return ['ok' => false, 'error' => 'LLM 生成的 JSON 不符合 schema', 'errors' => $validated['errors'], 'raw' => $content];
    }

    return ['ok' => true, 'scene' => $validated['data']];
}