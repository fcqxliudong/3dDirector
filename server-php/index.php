<?php
declare(strict_types=1);
/**
 * 3D 导演台 · 页面入口
 *
 * 部署位置：/home/wwwroot/ai_video/director_stage/index.php
 *
 * 路由策略：
 * 1. 未登录 → 跳 ai_video 登录页
 * 2. Vite 编译产物存在（static/director_stage/index.html）→ 输出它 + 注入配置 + 改资源路径
 * 3. 否则 → 显示占位页（"前端 R3F 应用尚未构建"）
 *
 * 资源路径修复：
 * Vite base 默认 './' ，输出 ./assets/index-xxx.js
 * 但实际资源在 static/director_stage/assets/index-xxx.js
 * 所以 PHP 注入时把 './assets/' 改成 './static/director_stage/assets/'
 */

require_once __DIR__ . '/../lib/auth.php';
auth_boot();
$u = current_user();
$csrf = csrf_token();
session_write_close();

// 未登录则重定向到 ai_video 登录页
if (!$u) {
    $loginUrl = '/login.php?redirect=' . urlencode('/director_stage/');
    header('Location: ' . $loginUrl);
    exit;
}

$userPayload = json_encode([
    'id'        => (int)$u['id'],
    'username'  => (string)($u['username'] ?? ''),
    'is_admin'  => (bool)user_is_admin($u),
    'csrf'      => $csrf,
], JSON_UNESCAPED_UNICODE);

// ─── 注入绝对路径 endpoint（不依赖 ai_video/api/ 下的 proxy）────────
// Nginx root 是 /home/wwwroot/ai_video，访问 /director_stage/... 会映射到
// /home/wwwroot/ai_video/director_stage/...（director_stage 是 ai_video 的子目录）
// ⚠️ 不要在路径前加 /ai_video/，否则 Nginx 会拼成 /home/wwwroot/ai_video/ai_video/director_stage/...
// 历史上注入过相对路径 '/api/director_stage_*.php'（走 ai_video/api/ 下的 proxy 文件），
// 现改为绝对路径：前端直接命中 /director_stage/api/director_stage_*.php
// proxy 文件可以安全删除（保留兼容也可以，下次清理时确认）
$endpointsPayload = json_encode([
    'schema'    => '/director_stage/api/director_stage_schema.php',
    'assets'    => '/director_stage/api/director_stage_assets.php',
    'scenes'    => '/director_stage/api/director_stage_scene.php',
    'render'    => '/director_stage/api/director_stage_render.php',
    'agent'     => '/director_stage/api/director_stage_scene_agent.php',
    'selfcheck' => '/director_stage/api/director_stage_selfcheck.php',
], JSON_UNESCAPED_UNICODE);

// ─── 优先输出 Vite 编译产物 ────────────────────────────────────
$viteIndex = __DIR__ . '/static/director_stage/index.html';
if (is_file($viteIndex) && filesize($viteIndex) > 100) {
    $html = file_get_contents($viteIndex);

    // ★ 关键修复：Vite base 是 './' 但实际资源在 static/director_stage/ 子目录
    // 把 './assets/' 改成 './static/director_stage/assets/'
    $html = str_replace('"./assets/', '"./static/director_stage/assets/', $html);
    $html = str_replace("'./assets/", "'./static/director_stage/assets/", $html);

    // 注入 CSRF token + 运行时配置 + 隐藏 loading spinner
    $inject = <<<HTML
<meta name="csrf-token" content="{$csrf}" />
<script>
window.__DIRECTOR_STAGE__ = {
  user: {$userPayload},
  endpoints: {$endpointsPayload},
  schemaVersion: '0.1',
};
// 立即隐藏 loading spinner · Vite 应用接管 #root
requestAnimationFrame(() => {
  const l = document.getElementById('app-loader');
  if (l) l.classList.add('hidden');
});
</script>
HTML;

    // 把 inject 块插到 </head> 之前
    $html = str_replace('</head>', $inject . '</head>', $html);

    header('Content-Type: text/html; charset=utf-8');
    echo $html;
    exit;
}

// ─── Vite 产物不存在 → 显示占位页 ────────────────────────────────
?><!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>3D 导演台 · Director Stage</title>
<meta name="csrf-token" content="<?= htmlspecialchars($csrf, ENT_QUOTES) ?>" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎬</text></svg>" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #f7f5f0; font-family: 'Outfit', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
  #root { height: 100vh; display: flex; align-items: center; justify-content: center; color: #7c7a72; font-size: 14px; }
  .loader { display: flex; flex-direction: column; align-items: center; gap: 14px; max-width: 560px; padding: 24px; line-height: 1.6; text-align: center; }
  .spinner { width: 32px; height: 32px; border: 3px solid #e9e3d6; border-top-color: #c97b3f; border-radius: 50%; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .placeholder h1 { font-family: 'DM Serif Display', serif; font-weight: 400; color: #14171e; font-size: 24px; margin: 0 0 8px; }
  .placeholder code { font-family: 'JetBrains Mono', monospace; background: #f0ead9; padding: 1px 6px; border-radius: 3px; font-size: 12.5px; color: #c97b3f; }
</style>
</head>
<body>
<div id="root">
  <div class="loader">
    <div class="spinner"></div>
    <div class="placeholder">
      <h1>3D 导演台 · Director Stage</h1>
      <p>前端 R3F 应用尚未构建。在本地 <code>packages/web</code> 用 Vite 编译后，把 <code>dist/*</code> 复制到 <code>static/director_stage/</code>，刷新本页即可接管。</p>
      <p>PHP 后端已就绪：JSON Schema v0.1 校验、Scene CRUD、Agent 生成、视频模型 Dispatcher 复用、多模态自校验均已实现。</p>
      <p>当前用户：<code><?= htmlspecialchars((string)($u['username'] ?? ''), ENT_QUOTES) ?></code></p>
    </div>
  </div>
</div>
<script>
window.__DIRECTOR_STAGE__ = {
  user: <?= $userPayload ?>,
  endpoints: <?= $endpointsPayload ?>,
  schemaVersion: '0.1',
};
</script>
</body>
</html>