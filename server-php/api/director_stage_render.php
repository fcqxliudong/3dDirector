<?php
declare(strict_types=1);

/**
 * 3D 导演台 · API: 视频模型渲染任务
 *
 * 路由：POST /api/director_stage_render.php?action=...
 *   action=submit    body: { scene_id, provider, model_id }   → { ok, job_id, prompt }
 *   action=get&id=N                                         → { ok, job }
 *   action=list                                            → { ok, jobs: [...] }
 *
 * Worker 调用内部函数 ds_render_job_claim_next / complete / fail
 * （不在 HTTP 暴露，由 cron / 后台进程调用）
 */

require_once __DIR__ . '/../lib/auth.php';
auth_boot();
$u = require_login_api();
session_write_close();
$uid = (int)$u['id'];

require_once __DIR__ . '/../lib/director_stage_render.php';

$action = $_GET['action'] ?? $_POST['action'] ?? '';

switch ($action) {
    case 'submit': {
        $raw = file_get_contents('php://input');
        $body = json_decode($raw, true);
        if (!is_array($body)) {
            json_response(['ok' => false, 'error' => 'body 必须是 JSON'], 400);
            break;
        }
        $sceneId   = (int)($body['scene_id'] ?? 0);
        $provider  = (string)($body['provider'] ?? '');
        $modelId   = (string)($body['model_id'] ?? '');
        if ($sceneId <= 0 || $provider === '' || $modelId === '') {
            json_response([
                'ok'    => false,
                'error' => 'scene_id / provider / model_id 必填',
            ], 400);
            break;
        }
        $r = ds_render_submit($uid, $sceneId, $provider, $modelId);
        json_response($r, $r['ok'] ? 200 : 400);
        break;
    }

    case 'get': {
        $id = (int)($_GET['id'] ?? 0);
        if ($id <= 0) {
            json_response(['ok' => false, 'error' => 'id 必须 > 0'], 400);
            break;
        }
        $job = ds_render_job_get($uid, $id);
        if ($job === null) {
            json_response(['ok' => false, 'error' => "job #$id 不存在或不属于当前用户"], 404);
            break;
        }
        json_response(['ok' => true, 'job' => $job]);
        break;
    }

    case 'list': {
        $limit = max(1, min(50, (int)($_GET['limit'] ?? 20)));
        json_response([
            'ok'   => true,
            'jobs' => ds_render_job_list($uid, $limit),
        ]);
        break;
    }

    default:
        json_response([
            'ok'      => false,
            'error'   => 'unknown action',
            'actions' => ['submit', 'get', 'list'],
        ], 400);
}