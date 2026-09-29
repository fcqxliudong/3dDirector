<?php
declare(strict_types=1);

/**
 * 3D 导演台 · 场景 CRUD
 *
 * 文件系统存储（每场景一个 JSON 文件） · MVP 用 · 不上 DB
 * 后期可加 director_stage_scene 表 · 透明切换存储介质
 *
 * 路径：data/director_stage/scenes/{owner_id}/{scene_id}.json
 */

require_once __DIR__ . '/director_stage_schema.php';

function ds_scenes_dir(int $ownerId): string
{
    $dir = __DIR__ . '/../data/director_stage/scenes/' . $ownerId;
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return $dir;
}

function ds_scene_index_path(int $ownerId): string
{
    return ds_scenes_dir($ownerId) . '/_index.json';
}

/**
 * 读 index（按 updated_at DESC）
 */
function ds_scene_index_load(int $ownerId): array
{
    $path = ds_scene_index_path($ownerId);
    if (!is_file($path)) {
        return [];
    }
    $raw = @file_get_contents($path);
    if ($raw === false || $raw === '') {
        return [];
    }
    $arr = json_decode($raw, true);
    return is_array($arr) ? $arr : [];
}

function ds_scene_index_save(int $ownerId, array $index): bool
{
    $path = ds_scene_index_path($ownerId);
    return (bool)@file_put_contents(
        $path,
        json_encode($index, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),
        LOCK_EX,
    );
}

/**
 * 列出某用户的场景摘要（不含 scene_json 全文）
 */
function ds_scene_list(int $ownerId, int $limit = 50): array
{
    $index = ds_scene_index_load($ownerId);
    usort($index, fn ($a, $b) => strcmp((string)($b['updated_at'] ?? ''), (string)($a['updated_at'] ?? '')));
    return array_slice($index, 0, $limit);
}

/**
 * 加载完整场景（含 scene_json 字段）
 */
function ds_scene_load(int $ownerId, int $sceneId): ?array
{
    $path = ds_scenes_dir($ownerId) . '/' . $sceneId . '.json';
    if (!is_file($path)) {
        return null;
    }
    $raw = @file_get_contents($path);
    if ($raw === false) {
        return null;
    }
    $scene = json_decode($raw, true);
    if (!is_array($scene)) {
        return null;
    }
    $scene['id'] = $sceneId;
    $scene['owner_id'] = $ownerId;
    return $scene;
}

/**
 * 保存场景
 *
 * @return array{ok: bool, id?: int, errors?: array}
 */
function ds_scene_save(int $ownerId, array $scene, ?string $title = null): array
{
    $validated = ds_validate_scene($scene);
    if (!$validated['ok']) {
        return ['ok' => false, 'errors' => $validated['errors']];
    }
    $cleanScene = $validated['data'];

    $now = gmdate('Y-m-d\TH:i:s\Z');
    $sceneId = (int)($cleanScene['id'] ?? 0);
    $isNew = $sceneId === 0;

    if ($isNew) {
        // 生成新 ID：用时间戳 + 随机 4 位（避免碰撞）
        $sceneId = (int)(microtime(true) * 1000) & 0xFFFFFF;
    }

    $cleanScene['id'] = $sceneId;
    $cleanScene['owner_id'] = $ownerId;
    $cleanScene['updated_at'] = $now;

    // 落盘
    $path = ds_scenes_dir($ownerId) . '/' . $sceneId . '.json';
    $ok = (bool)@file_put_contents(
        $path,
        json_encode($cleanScene, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),
        LOCK_EX,
    );
    if (!$ok) {
        return ['ok' => false, 'errors' => [['path' => '$', 'message' => '落盘失败']]];
    }

    // 更新 index
    $index = ds_scene_index_load($ownerId);
    $summary = [
        'id'            => $sceneId,
        'owner_id'      => $ownerId,
        'title'         => (string)($title ?? $cleanScene['title'] ?? ('Scene ' . $sceneId)),
        'preset'        => $cleanScene['scene']['preset'] ?? 'room_small',
        'aspect'        => $cleanScene['aspect'] ?? '2.39:1',
        'duration'      => $cleanScene['duration'] ?? 5,
        'actor_count'   => count($cleanScene['actors'] ?? []),
        'updated_at'    => $now,
        'created_at'    => $now,
    ];

    if ($isNew) {
        $index[] = $summary;
    } else {
        $found = false;
        foreach ($index as $i => $row) {
            if ((int)($row['id'] ?? 0) === $sceneId) {
                $summary['created_at'] = $row['created_at'] ?? $now;
                $index[$i] = $summary;
                $found = true;
                break;
            }
        }
        if (!$found) {
            $index[] = $summary;
        }
    }

    ds_scene_index_save($ownerId, $index);

    return ['ok' => true, 'id' => $sceneId, 'data' => $cleanScene, 'summary' => $summary];
}

/**
 * 删除场景
 */
function ds_scene_delete(int $ownerId, int $sceneId): bool
{
    $path = ds_scenes_dir($ownerId) . '/' . $sceneId . '.json';
    if (is_file($path)) {
        @unlink($path);
    }
    $index = ds_scene_index_load($ownerId);
    $new = array_values(array_filter($index, fn ($r) => (int)($r['id'] ?? 0) !== $sceneId));
    ds_scene_index_save($ownerId, $new);
    return true;
}