<?php
declare(strict_types=1);

/**
 * 3D 导演台 · API: 场景 CRUD
 *
 * 路由：POST /api/director_stage_scene.php?action=...
 *   action=save      body: { scene, title }         → { ok, id }
 *   action=load&id=N                                  → { ok, scene }
 *   action=list                                        → { ok, scenes: [...] }
 *   action=delete&id=N                                 → { ok }
 *
 * 注意：所有操作按 owner_id 过滤 · 越权直接 403
 */

require_once __DIR__ . '/../../lib/auth.php';
auth_boot();
$u = require_login_api();
session_write_close();
$uid = (int)$u['id'];

require_once __DIR__ . '/../lib/director_stage_schema.php';
require_once __DIR__ . '/../lib/director_stage_scene.php';

$action = $_GET['action'] ?? $_POST['action'] ?? '';

switch ($action) {
    case 'save': {
        $raw = file_get_contents('php://input');
        $body = json_decode($raw, true);
        if (!is_array($body) || !isset($body['scene'])) {
            json_response(['ok' => false, 'error' => 'body 必须包含 scene 字段'], 400);
            break;
        }
        $title = isset($body['title']) && is_string($body['title']) ? substr($body['title'], 0, 191) : null;
        $r = ds_scene_save($uid, $body['scene'], $title);
        json_response($r, $r['ok'] ? 200 : 400);
        break;
    }

    case 'load': {
        $id = (int)($_GET['id'] ?? 0);
        if ($id <= 0) {
            json_response(['ok' => false, 'error' => 'id 必须 > 0'], 400);
            break;
        }
        $scene = ds_scene_load($uid, $id);
        if ($scene === null) {
            json_response(['ok' => false, 'error' => "scene #$id 不存在或不属于当前用户"], 404);
            break;
        }
        json_response(['ok' => true, 'scene' => $scene]);
        break;
    }

    case 'list': {
        $limit = max(1, min(100, (int)($_GET['limit'] ?? 50)));
        json_response([
            'ok'     => true,
            'scenes' => ds_scene_list($uid, $limit),
        ]);
        break;
    }

    case 'delete': {
        $id = (int)($_GET['id'] ?? 0);
        if ($id <= 0) {
            json_response(['ok' => false, 'error' => 'id 必须 > 0'], 400);
            break;
        }
        $ok = ds_scene_delete($uid, $id);
        json_response(['ok' => $ok]);
        break;
    }

    default:
        json_response([
            'ok'      => false,
            'error'   => 'unknown action',
            'actions' => ['save', 'load', 'list', 'delete'],
        ], 400);
}