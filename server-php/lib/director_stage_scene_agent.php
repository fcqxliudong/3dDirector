<?php
declare(strict_types=1);

/**
 * 3D 导演台 · 场景助手（LLM + OpenAI tools）
 *
 * 前端把当前 SceneJSON + 对话发来；后端调 category=agent 的模型，
 * 让模型以 tool_calls 改场景，前端再落到 zustand store。
 */

require_once __DIR__ . '/../../lib/auth.php';
require_once __DIR__ . '/../../lib/llm_api.php';
require_once __DIR__ . '/../../lib/model_entries.php';
require_once __DIR__ . '/director_stage_schema.php';

/**
 * @return list<array{id:string,provider:string,model_id:string,label:string,is_default:bool,has_key:bool}>
 */
function ds_agent_list_models(array $viewer): array
{
    $list = model_entries_list('agent', $viewer);
    $default = model_entry_pick_default($list);
    $defaultId = $default ? (int)($default['id'] ?? 0) : 0;
    $out = [];
    foreach ($list as $row) {
        $id = (int)($row['id'] ?? 0);
        $provider = llm_normalize_provider_id((string)($row['provider'] ?? ''));
        $modelId = trim((string)($row['model_id'] ?? ''));
        if ($provider === '' && $modelId === '') {
            continue;
        }
        $label = trim((string)($row['label'] ?? ''));
        if ($label === '') {
            $label = trim($provider . ' · ' . $modelId);
        }
        $out[] = [
            'id' => (string)$id,
            'entry_id' => $id,
            'provider' => $provider,
            'model_id' => $modelId,
            'label' => $label,
            'is_default' => $id > 0 && $id === $defaultId,
            'has_key' => !empty($row['has_api_key']) || !empty($row['has_api_key_flag']),
        ];
    }
    return $out;
}

/**
 * @return array{ok:bool,error?:string,api_key?:string,base_url?:string,provider?:string,model_id?:string,entry_id?:int}
 */
function ds_agent_resolve_connection(int $uid, string $provider, string $modelId): array
{
    $provider = llm_normalize_provider_id($provider);
    $modelId = trim($modelId);
    $viewer = ['id' => $uid];

    if ($provider !== '' || $modelId !== '') {
        if ($provider === '') {
            return ['ok' => false, 'error' => '缺少 provider'];
        }
        $creds = model_entry_runtime_credentials('agent', $provider, $modelId, $uid);
        if (!empty($creds['has_key']) && $creds['base_url'] !== '') {
            return [
                'ok' => true,
                'api_key' => (string)$creds['api_key'],
                'base_url' => (string)$creds['base_url'],
                'provider' => (string)$creds['provider'],
                'model_id' => $modelId !== '' ? $modelId : (string)$creds['model_id'],
                'entry_id' => (int)$creds['entry_id'],
            ];
        }
        // fall through to platform connection for known providers
        $conn = llm_connection_for($provider, $uid);
        if (!empty($conn['has_key']) && (string)($conn['base_url'] ?? '') !== '') {
            return [
                'ok' => true,
                'api_key' => (string)$conn['api_key'],
                'base_url' => (string)$conn['base_url'],
                'provider' => $provider,
                'model_id' => $modelId !== '' ? $modelId : (string)($conn['default_model'] ?? ''),
                'entry_id' => 0,
            ];
        }
        return ['ok' => false, 'error' => '该智能体模型未配置可用凭据（provider=' . $provider . '）'];
    }

    $list = model_entries_list('agent', $viewer);
    $pick = model_entry_pick_default($list);
    if ($pick) {
        $p = llm_normalize_provider_id((string)($pick['provider'] ?? ''));
        $m = trim((string)($pick['model_id'] ?? ''));
        return ds_agent_resolve_connection($uid, $p, $m);
    }

    $conn = llm_user_connection($uid);
    if (!empty($conn['has_key']) && (string)($conn['base_url'] ?? '') !== '') {
        return [
            'ok' => true,
            'api_key' => (string)$conn['api_key'],
            'base_url' => (string)$conn['base_url'],
            'provider' => (string)($conn['provider'] ?? ''),
            'model_id' => (string)($conn['default_model'] ?? ''),
            'entry_id' => 0,
        ];
    }
    return ['ok' => false, 'error' => '未配置智能体模型。请到设置 → 模型库添加 category=智能体 的模型与 API Key。'];
}

function ds_agent_system_prompt(): string
{
    $aspectList = implode(', ', DS_ASPECT_RATIOS);
    $poseList = implode(', ', DS_ACTOR_POSES);
    $easeList = implode(', ', DS_EASE_TYPES);
    $camPresets = 'push_in, pull_out, orbit, crane_up, tracking, static';
    $envKinds = implode(', ', DS_ENV_KINDS);

    return <<<PROMPT
你是「3D导演台」场景助手。用户用自然语言指挥布景与运镜，你必须通过工具修改场景，不要只口头描述。

## 场景坐标系
- 单位：米；Y 向上；角色站在地面时 y≈0
- 相机默认高度约 1.5–1.8
- duration 硬约束 1–30 秒；keyframes.t 不能超过 duration
- aspect ∈ {{$aspectList}}
- pose ∈ {{$poseList}}
- ease ∈ {{$easeList}}
- 运镜模板 id ∈ {{$camPresets}}
- 环境几何 kind ∈ {{$envKinds}}（ground/box/cyl/cone/wall）
- color 必须是 #RRGGBB
- actor.id 全局唯一；camera.lookAt 可写 actor.id 或 [x,y,z]
- scene.preset 固定用 open；用 set_scene_size + set_env 建空间，不要选房间/走廊等旧预设模板
- 一般只要地面 + 必要墙/道具，不要天花板；室内才加矮墙/门框暗示

## 工作方式
1. 先看消息里附带的当前 SceneJSON
2. 用工具完成改动（可连续多个工具）
3. 工具执行后用一两句中文说明改了什么
4. 复杂重建可用 replace_scene，但优先用细粒度工具
5. 不要输出 markdown 代码块；信息写在助手回复或工具参数里

## 常用意图映射
- 「加角色 / 人 / 道具」→ add_actor
- 「挪到 / 移动到 / 走到」→ update_actor(start=...) 或 set_actor_moves
- 「推镜头 / 拉镜头 / 环绕」→ apply_camera_preset 或改 keyframes
- 「改时长 / 比例 / 空间大小」→ set_duration / set_aspect / set_scene_size
- 「地面 / 墙 / 树 / 建筑」→ set_env（整表替换环境几何）
PROMPT;
}

/**
 * 从节点上下文搭建：额外系统约束（面向下游参考视频）
 */
function ds_agent_build_from_node_rules(): string
{
    return <<<PROMPT
## 任务：根据节点素材重建整场阻塞（build_from_node）
目标是生成可导出的运镜参考视频（人数、站位、景别、走位、相机路径），不是写剧本。

规则：
1. 素材优先级：视频提示词 > 节点正文/标题 > 参考标题列表 > 仅时长/比例兜底
2. 从素材抽出角色（≤10），每人 id/label/color(#RRGGBB)/start/pose；颜色要明显可辨
3. 空间：preset 一律 open；按剧情估 scene.size（室内约 8–16m，街道/户外更大）；用 env 自建地面(+可选墙/树/建筑)，不要天花板，不要套旧房间/走廊模板
4. 有走位才写 moves，时间落在 duration 内且不重叠
5. 至少 2～6 个 camera keyframes；lookAt 尽量引用 actor.id；可先 apply_camera_preset 再微调
6. 不要编造大段对白；几何只服务景别与人物关系
7. 优先一次 replace_scene 成型；参数必须通过 schema
8. 素材极少时：1 个角色 + 一片 ground + push_in 占位即可
PROMPT;
}

/**
 * @param array<string,mixed> $pack
 */
function ds_agent_format_node_pack(array $pack): string
{
    $title = trim((string)($pack['title'] ?? ''));
    $type = trim((string)($pack['type'] ?? ''));
    $body = trim((string)($pack['body'] ?? ''));
    if (mb_strlen($body) > 4000) {
        $body = mb_substr($body, 0, 4000) . '…';
    }
    $prompt = trim((string)($pack['gen_prompt_video'] ?? ''));
    if (mb_strlen($prompt) > 6000) {
        $prompt = mb_substr($prompt, 0, 6000) . '…';
    }
    $aspect = trim((string)($pack['aspect'] ?? '16:9'));
    $duration = (float)($pack['duration'] ?? 10);
    if ($duration < 1) {
        $duration = 10;
    }
    if ($duration > 30) {
        $duration = 30;
    }
    $refLines = [];
    $refs = $pack['refs'] ?? [];
    if (is_array($refs)) {
        foreach ($refs as $r) {
            if (!is_array($r)) {
                continue;
            }
            $kind = trim((string)($r['kind'] ?? 'ref'));
            $rt = trim((string)($r['title'] ?? ''));
            $url = trim((string)($r['url'] ?? ''));
            $id = (int)($r['id'] ?? 0);
            if ($rt === '' && $url === '') {
                continue;
            }
            $refLines[] = '- [' . $kind . '] ' . ($rt !== '' ? $rt : '未命名')
                . ($id > 0 ? (' #' . $id) : '')
                . ($url !== '' ? (' · ' . $url) : '');
            if (count($refLines) >= 30) {
                break;
            }
        }
    }
    $chars = [];
    $charTitles = $pack['character_titles'] ?? [];
    if (is_array($charTitles)) {
        foreach ($charTitles as $ct) {
            $s = trim((string)$ct);
            if ($s !== '') {
                $chars[] = $s;
            }
            if (count($chars) >= 20) {
                break;
            }
        }
    }

    $parts = [];
    $parts[] = 'node_id=' . (int)($pack['node_id'] ?? 0)
        . ' project_id=' . (int)($pack['project_id'] ?? 0)
        . ' type=' . ($type !== '' ? $type : '?')
        . ' title=' . ($title !== '' ? $title : '(无标题)');
    $parts[] = 'aspect=' . $aspect . ' duration=' . $duration . 's';
    $parts[] = "## 视频提示词\n" . ($prompt !== '' ? $prompt : '(空)');
    $parts[] = "## 节点正文\n" . ($body !== '' ? $body : '(空)');
    $parts[] = "## 参考列表\n" . ($refLines !== [] ? implode("\n", $refLines) : '(无)');
    if ($chars !== []) {
        $parts[] = "## 关联角色标题\n- " . implode("\n- ", $chars);
    }
    $sparse = ($prompt === '' && $body === '' && $refLines === []);
    if ($sparse) {
        $parts[] = '（素材偏少：请搭单人+默认房间+简单推镜占位）';
    }
    return implode("\n\n", $parts);
}

/**
 * @param array<string,mixed> $pack
 * @param array<string,mixed> $scene
 * @return array{ok:bool,error?:string,message?:array,model?:string,provider?:string,entry_id?:int,usage?:mixed,sparse?:bool}
 */
function ds_agent_build_from_node(int $uid, array $pack, array $scene, string $provider = '', string $modelId = ''): array
{
    $prompt = trim((string)($pack['gen_prompt_video'] ?? ''));
    $body = trim((string)($pack['body'] ?? ''));
    $refs = is_array($pack['refs'] ?? null) ? $pack['refs'] : [];
    $sparse = ($prompt === '' && $body === '' && $refs === []);

    $userContent = "请根据下列节点素材，用工具（优先 replace_scene）重建整场 3D 阻塞。\n\n"
        . ds_agent_format_node_pack($pack);

    // 注入 build 规则到对话：临时包一层 system 友好的 user 前缀不够，改走 chat 前改写 system
    $conn = ds_agent_resolve_connection($uid, $provider, $modelId);
    if (empty($conn['ok'])) {
        return ['ok' => false, 'error' => (string)($conn['error'] ?? '无可用模型'), 'sparse' => $sparse];
    }

    $apiKey = (string)$conn['api_key'];
    $baseUrl = (string)$conn['base_url'];
    $model = (string)$conn['model_id'];
    if ($model === '') {
        return ['ok' => false, 'error' => '模型 ID 为空', 'sparse' => $sparse];
    }

    $sceneJson = json_encode($scene, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (!is_string($sceneJson) || strlen($sceneJson) > 80000) {
        return ['ok' => false, 'error' => '场景过大，无法送入助手', 'sparse' => $sparse];
    }

    $sys = ds_agent_system_prompt()
        . "\n\n" . ds_agent_build_from_node_rules()
        . "\n\n## 当前 SceneJSON\n" . $sceneJson;

    $chatMessages = [
        ['role' => 'system', 'content' => $sys],
        ['role' => 'user', 'content' => $userContent],
    ];

    $extra = [
        'temperature' => 0.25,
        'tools' => ds_agent_tools(),
        'tool_choice' => 'auto',
    ];

    $res = llm_chat($apiKey, $baseUrl, $model, $chatMessages, $extra);
    if (empty($res['ok'])) {
        $err = (string)($res['error'] ?? 'LLM 调用失败');
        $detail = '';
        if (isset($res['data']) && is_array($res['data'])) {
            $detail = (string)($res['data']['error']['message'] ?? $res['data']['message'] ?? '');
        } elseif (isset($res['body']) && is_string($res['body'])) {
            $detail = mb_substr($res['body'], 0, 240);
        }
        return ['ok' => false, 'error' => $detail !== '' ? ($err . '：' . $detail) : $err, 'sparse' => $sparse];
    }

    $data = is_array($res['data'] ?? null) ? $res['data'] : [];
    $choice = is_array($data['choices'][0] ?? null) ? $data['choices'][0] : [];
    $msg = is_array($choice['message'] ?? null) ? $choice['message'] : [];
    $content = $msg['content'] ?? null;
    if (is_array($content)) {
        $parts = [];
        foreach ($content as $p) {
            if (is_string($p)) {
                $parts[] = $p;
            } elseif (is_array($p) && isset($p['text'])) {
                $parts[] = (string)$p['text'];
            }
        }
        $content = trim(implode('', $parts));
    }
    if (!is_string($content)) {
        $content = '';
    }
    $content = (string)llm_strip_thinking_text($content);

    $toolCalls = [];
    if (!empty($msg['tool_calls']) && is_array($msg['tool_calls'])) {
        foreach ($msg['tool_calls'] as $tc) {
            if (!is_array($tc)) {
                continue;
            }
            $fn = is_array($tc['function'] ?? null) ? $tc['function'] : [];
            $name = (string)($fn['name'] ?? '');
            $argsRaw = $fn['arguments'] ?? '{}';
            if (is_array($argsRaw)) {
                $args = $argsRaw;
            } else {
                $args = json_decode((string)$argsRaw, true);
                if (!is_array($args)) {
                    $args = [];
                }
            }
            $toolCalls[] = [
                'id' => (string)($tc['id'] ?? ('call_' . bin2hex(random_bytes(6)))),
                'type' => 'function',
                'function' => [
                    'name' => $name,
                    'arguments' => json_encode($args, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                ],
                'name' => $name,
                'arguments' => $args,
            ];
        }
    }

    return [
        'ok' => true,
        'message' => [
            'role' => 'assistant',
            'content' => $content,
            'tool_calls' => $toolCalls !== [] ? $toolCalls : null,
        ],
        'model' => (string)($res['model'] ?? $model),
        'provider' => (string)$conn['provider'],
        'entry_id' => (int)($conn['entry_id'] ?? 0),
        'usage' => $data['usage'] ?? null,
        'finish_reason' => $choice['finish_reason'] ?? null,
        'sparse' => $sparse,
    ];
}

/**
 * OpenAI tools schema
 *
 * @return list<array<string,mixed>>
 */
function ds_agent_tools(): array
{
    $vec3 = [
        'type' => 'array',
        'items' => ['type' => 'number'],
        'minItems' => 3,
        'maxItems' => 3,
        'description' => '[x, y, z] 米',
    ];
    $lookAt = [
        'description' => 'actor.id 字符串，或 [x,y,z]',
        'oneOf' => [
            ['type' => 'string'],
            $vec3,
        ],
    ];

    $defs = [
        [
            'name' => 'set_scene_size',
            'description' => '设置空间包围盒尺寸 [宽,高,深]（米），并同步地面范围；preset 固定 open',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'size' => $vec3,
                ],
                'required' => ['size'],
            ],
        ],
        [
            'name' => 'set_env',
            'description' => '整表替换环境几何。kind=ground|box|cyl|cone|wall。一般只要地面+少量墙/道具，不要天花板。wall 的 size=[宽,高,厚]，pos 为底边中心。',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'env' => [
                        'type' => 'array',
                        'maxItems' => 40,
                        'items' => [
                            'type' => 'object',
                            'properties' => [
                                'id' => ['type' => 'string'],
                                'kind' => ['type' => 'string', 'enum' => DS_ENV_KINDS],
                                'pos' => $vec3,
                                'size' => $vec3,
                                'color' => ['type' => 'string', 'description' => '#RRGGBB'],
                                'rot' => $vec3,
                            ],
                            'required' => ['id', 'kind', 'pos', 'size'],
                        ],
                    ],
                ],
                'required' => ['env'],
            ],
        ],
        [
            'name' => 'set_aspect',
            'description' => '设置画面比例',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'aspect' => ['type' => 'string', 'enum' => DS_ASPECT_RATIOS],
                ],
                'required' => ['aspect'],
            ],
        ],
        [
            'name' => 'set_duration',
            'description' => '设置总时长（秒，1-30）',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'duration' => ['type' => 'number', 'minimum' => 1, 'maximum' => 30],
                ],
                'required' => ['duration'],
            ],
        ],
        [
            'name' => 'set_fps',
            'description' => '设置帧率',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'fps' => ['type' => 'integer', 'enum' => DS_FPS_VALUES],
                ],
                'required' => ['fps'],
            ],
        ],
        [
            'name' => 'add_actor',
            'description' => '添加角色/物体',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'id' => ['type' => 'string', 'description' => '唯一 id，如 A / hero'],
                    'label' => ['type' => 'string'],
                    'color' => ['type' => 'string', 'description' => '#RRGGBB'],
                    'start' => $vec3,
                    'facing' => $vec3,
                    'pose' => ['type' => 'string', 'enum' => DS_ACTOR_POSES],
                ],
                'required' => ['id', 'label', 'color', 'start', 'pose'],
            ],
        ],
        [
            'name' => 'update_actor',
            'description' => '更新角色属性（位置/朝向/姿势/颜色/标签）',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'id' => ['type' => 'string'],
                    'label' => ['type' => 'string'],
                    'color' => ['type' => 'string'],
                    'start' => $vec3,
                    'facing' => $vec3,
                    'pose' => ['type' => 'string', 'enum' => DS_ACTOR_POSES],
                ],
                'required' => ['id'],
            ],
        ],
        [
            'name' => 'set_actor_moves',
            'description' => '设置角色时间段移动路径（覆盖原 moves）',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'id' => ['type' => 'string'],
                    'moves' => [
                        'type' => 'array',
                        'items' => [
                            'type' => 'object',
                            'properties' => [
                                'to' => $vec3,
                                't0' => ['type' => 'number'],
                                't1' => ['type' => 'number'],
                                'pose' => ['type' => 'string', 'enum' => DS_ACTOR_POSES],
                            ],
                            'required' => ['to', 't0', 't1', 'pose'],
                        ],
                    ],
                ],
                'required' => ['id', 'moves'],
            ],
        ],
        [
            'name' => 'remove_actor',
            'description' => '删除角色',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'id' => ['type' => 'string'],
                ],
                'required' => ['id'],
            ],
        ],
        [
            'name' => 'select_actor',
            'description' => '在界面选中角色（方便用户看到高亮）',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'id' => ['type' => 'string'],
                ],
                'required' => ['id'],
            ],
        ],
        [
            'name' => 'set_camera_fov',
            'description' => '设置相机 FOV（度）',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'fov' => ['type' => 'number', 'minimum' => 10, 'maximum' => 120],
                ],
                'required' => ['fov'],
            ],
        ],
        [
            'name' => 'add_camera_keyframe',
            'description' => '新增相机关键帧',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    't' => ['type' => 'number'],
                    'pos' => $vec3,
                    'lookAt' => $lookAt,
                    'ease' => ['type' => 'string', 'enum' => DS_EASE_TYPES],
                ],
                'required' => ['t', 'pos', 'lookAt'],
            ],
        ],
        [
            'name' => 'update_camera_keyframe',
            'description' => '按索引更新相机关键帧（0-based）',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'index' => ['type' => 'integer', 'minimum' => 0],
                    't' => ['type' => 'number'],
                    'pos' => $vec3,
                    'lookAt' => $lookAt,
                    'ease' => ['type' => 'string', 'enum' => DS_EASE_TYPES],
                ],
                'required' => ['index'],
            ],
        ],
        [
            'name' => 'remove_camera_keyframe',
            'description' => '删除相机关键帧（至少保留 2 个）',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'index' => ['type' => 'integer', 'minimum' => 0],
                ],
                'required' => ['index'],
            ],
        ],
        [
            'name' => 'apply_camera_preset',
            'description' => '一键套用运镜模板（推/拉/环绕/升/横移/固定）',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'preset' => [
                        'type' => 'string',
                        'enum' => ['push_in', 'pull_out', 'orbit', 'crane_up', 'tracking', 'static'],
                    ],
                    'distance' => ['type' => 'number'],
                    'duration' => ['type' => 'number'],
                    'target' => $vec3,
                ],
                'required' => ['preset'],
            ],
        ],
        [
            'name' => 'set_preview_t',
            'description' => '把时间轴游标跳到指定秒',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    't' => ['type' => 'number', 'minimum' => 0],
                ],
                'required' => ['t'],
            ],
        ],
        [
            'name' => 'replace_scene',
            'description' => '用完整 SceneJSON 替换当前场景（大改时用）',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'scene' => ['type' => 'object', 'description' => '完整 v0.1 SceneJSON'],
                ],
                'required' => ['scene'],
            ],
        ],
    ];

    $tools = [];
    foreach ($defs as $d) {
        $tools[] = [
            'type' => 'function',
            'function' => [
                'name' => $d['name'],
                'description' => $d['description'],
                'parameters' => $d['parameters'],
            ],
        ];
    }
    return $tools;
}

/**
 * @param list<array{role:string,content?:mixed,tool_calls?:mixed,tool_call_id?:string,name?:string}> $messages
 * @param array<string,mixed> $scene
 * @return array{ok:bool,error?:string,message?:array,model?:string,usage?:mixed}
 */
function ds_agent_chat(int $uid, array $messages, array $scene, string $provider = '', string $modelId = ''): array
{
    $conn = ds_agent_resolve_connection($uid, $provider, $modelId);
    if (empty($conn['ok'])) {
        return ['ok' => false, 'error' => (string)($conn['error'] ?? '无可用模型')];
    }

    $apiKey = (string)$conn['api_key'];
    $baseUrl = (string)$conn['base_url'];
    $model = (string)$conn['model_id'];
    if ($model === '') {
        return ['ok' => false, 'error' => '模型 ID 为空'];
    }

    $sceneJson = json_encode($scene, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (!is_string($sceneJson) || strlen($sceneJson) > 80000) {
        return ['ok' => false, 'error' => '场景过大，无法送入助手'];
    }

    $sys = ds_agent_system_prompt() . "\n\n## 当前 SceneJSON\n" . $sceneJson;

    $chatMessages = [
        ['role' => 'system', 'content' => $sys],
    ];
    foreach ($messages as $m) {
        if (!is_array($m)) {
            continue;
        }
        $role = (string)($m['role'] ?? '');
        if (!in_array($role, ['user', 'assistant', 'tool', 'system'], true)) {
            continue;
        }
        // skip client-side system welcome; we inject our own
        if ($role === 'system') {
            continue;
        }
        $row = ['role' => $role];
        if (array_key_exists('content', $m)) {
            $row['content'] = $m['content'];
        }
        if ($role === 'assistant' && !empty($m['tool_calls']) && is_array($m['tool_calls'])) {
            $row['tool_calls'] = $m['tool_calls'];
            if (!array_key_exists('content', $row)) {
                $row['content'] = null;
            }
        }
        if ($role === 'tool') {
            $row['tool_call_id'] = (string)($m['tool_call_id'] ?? '');
            if ($row['tool_call_id'] === '') {
                continue;
            }
            if (isset($m['name'])) {
                $row['name'] = (string)$m['name'];
            }
        }
        $chatMessages[] = $row;
    }

    $extra = [
        'temperature' => 0.3,
        'tools' => ds_agent_tools(),
        'tool_choice' => 'auto',
    ];

    $res = llm_chat($apiKey, $baseUrl, $model, $chatMessages, $extra);
    if (empty($res['ok'])) {
        $err = (string)($res['error'] ?? 'LLM 调用失败');
        $detail = '';
        if (isset($res['data']) && is_array($res['data'])) {
            $detail = (string)($res['data']['error']['message'] ?? $res['data']['message'] ?? '');
        } elseif (isset($res['body']) && is_string($res['body'])) {
            $detail = mb_substr($res['body'], 0, 240);
        }
        return ['ok' => false, 'error' => $detail !== '' ? ($err . '：' . $detail) : $err, 'raw' => $res];
    }

    $data = is_array($res['data'] ?? null) ? $res['data'] : [];
    $choice = is_array($data['choices'][0] ?? null) ? $data['choices'][0] : [];
    $msg = is_array($choice['message'] ?? null) ? $choice['message'] : [];
    $content = $msg['content'] ?? null;
    if (is_array($content)) {
        // multipart → flatten text
        $parts = [];
        foreach ($content as $p) {
            if (is_string($p)) {
                $parts[] = $p;
            } elseif (is_array($p) && isset($p['text'])) {
                $parts[] = (string)$p['text'];
            }
        }
        $content = trim(implode('', $parts));
    }
    if (!is_string($content)) {
        $content = '';
    }
    $content = (string)llm_strip_thinking_text($content);

    $toolCalls = [];
    if (!empty($msg['tool_calls']) && is_array($msg['tool_calls'])) {
        foreach ($msg['tool_calls'] as $tc) {
            if (!is_array($tc)) {
                continue;
            }
            $fn = is_array($tc['function'] ?? null) ? $tc['function'] : [];
            $name = (string)($fn['name'] ?? '');
            $argsRaw = $fn['arguments'] ?? '{}';
            if (is_array($argsRaw)) {
                $args = $argsRaw;
            } else {
                $args = json_decode((string)$argsRaw, true);
                if (!is_array($args)) {
                    $args = [];
                }
            }
            $toolCalls[] = [
                'id' => (string)($tc['id'] ?? ('call_' . bin2hex(random_bytes(6)))),
                'type' => 'function',
                'function' => [
                    'name' => $name,
                    'arguments' => json_encode($args, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                ],
                // convenience for frontend
                'name' => $name,
                'arguments' => $args,
            ];
        }
    }

    return [
        'ok' => true,
        'message' => [
            'role' => 'assistant',
            'content' => $content,
            'tool_calls' => $toolCalls !== [] ? $toolCalls : null,
        ],
        'model' => (string)($res['model'] ?? $model),
        'provider' => (string)$conn['provider'],
        'entry_id' => (int)($conn['entry_id'] ?? 0),
        'usage' => $data['usage'] ?? null,
        'finish_reason' => $choice['finish_reason'] ?? null,
    ];
}

/**
 * 兼容旧「整段生成 SceneJSON」入口
 *
 * @return array{ok:bool,scene?:array,error?:string,raw?:string}
 */
function ds_scene_agent_generate(int $uid, string $userPrompt, string $provider = 'cloudflare'): array
{
    if (trim($userPrompt) === '') {
        return ['ok' => false, 'error' => 'userPrompt 不能为空'];
    }
    $empty = [
        'version' => DS_SCHEMA_VERSION,
        'scene' => ['preset' => 'open', 'size' => [24, 3, 24], 'env' => [
            ['id' => 'ground', 'kind' => 'ground', 'pos' => [0, 0, 0], 'size' => [24, 0.08, 24], 'color' => '#6a7360'],
        ]],
        'actors' => [],
        'camera' => [
            'fov' => 35,
            'keyframes' => [
                ['t' => 0, 'pos' => [0, 1.6, 6], 'lookAt' => [0, 1.5, 0]],
                ['t' => 5, 'pos' => [0, 1.5, 3], 'lookAt' => [0, 1.5, 0], 'ease' => 'easeInOut'],
            ],
        ],
        'duration' => 5,
        'fps' => 24,
        'aspect' => '2.39:1',
    ];
    $r = ds_agent_chat($uid, [
        ['role' => 'user', 'content' => "请根据描述重建场景（可用 replace_scene）：\n" . $userPrompt],
    ], $empty, $provider, '');
    if (empty($r['ok'])) {
        return ['ok' => false, 'error' => (string)($r['error'] ?? '生成失败')];
    }
    $msg = $r['message'] ?? [];
    $calls = is_array($msg['tool_calls'] ?? null) ? $msg['tool_calls'] : [];
    foreach ($calls as $tc) {
        $name = (string)($tc['name'] ?? ($tc['function']['name'] ?? ''));
        $args = is_array($tc['arguments'] ?? null) ? $tc['arguments'] : [];
        if ($name === 'replace_scene' && isset($args['scene']) && is_array($args['scene'])) {
            $validated = ds_validate_scene($args['scene']);
            if ($validated['ok']) {
                return ['ok' => true, 'scene' => $validated['data']];
            }
            return ['ok' => false, 'error' => '生成的场景不符合 schema', 'errors' => $validated['errors']];
        }
    }
    return [
        'ok' => false,
        'error' => '模型未返回 replace_scene；请用助手对话工具逐步搭建',
        'raw' => (string)($msg['content'] ?? ''),
    ];
}
