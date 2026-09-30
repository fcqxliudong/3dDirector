# 3D 导演台 · 部署说明(放在 director_stage/ 根目录给运维看)

> 防止后续运维 / AI 助手在维护这个目录时踩同样的坑。

## 目录布局

```
/home/wwwroot/ai_video/director_stage/
├── index.php               ← 页面入口(注入 __DIRECTOR_STAGE__ 配置)
├── api/                    ← 6 个 API endpoint(director_stage_scene_agent 等)
├── lib/                    ← 6 个 lib 实现(ds_scene_agent_generate 等)
├── static/director_stage/  ← Vite dist 输出
│   ├── index.html
│   └── assets/             ← JS/CSS chunks
└── README.md               ← 本文件
```

## 与 ai_video 系统的边界

**只读**:
- `/home/wwwroot/ai_video/lib/` (ai_video 共享库)
- `/home/wwwroot/ai_video/api/` 里**除 director_stage_*.php 外的文件**
- `/home/wwwroot/ai_video/static/`

**导演台可写**:
- `/home/wwwroot/ai_video/director_stage/` 整个目录

**待清理**(不破坏 ai_video):
- `/home/wwwroot/ai_video/api/director_stage_*.php` 7 个 proxy 文件(101 字节,只是 `require '/../director_stage/api/...'`)
- 现在还在用(页面 URL 相对路径 fetch 命中 proxy)
- 前端已切绝对路径后(`/ai_video/director_stage/api/...`)可删,删除前先验证前端不依赖

## 部署

跑 `server-php/deploy-remote.ps1`(用 PuTTY 工具集 + D:\154.36.175.ppk)
上传顺序:`index.php` → `api/` → `lib/` → `dist/` → chown

部署后必须**强刷浏览器** `Ctrl+Shift+R`(12h Nginx cache + 3 天 CDN cache)。

## 易踩坑点

1. **PHP 文件 UTF-8 BOM** — `Set-Content -Encoding UTF8` 会写 BOM,把 `<?php` 推到 line 1,`declare(strict_types=1)` 失败 → 500。写文件用 `new UTF8Encoding($false)`。
2. **deploy 漏传 `lib/`** — 旧版 deploy-remote.ps1 只传 api/,缺 lib/ 会导致所有 endpoint 500(error log 找不到 director_stage/lib/auth.php)。
3. **PHP-FPM opcache** — 部署后 `killall -USR2 php-fpm` 让 master 重启,worker 才用新字节码。
4. **drei `<Environment preset>` 加载外部 HDR** — 在某些网络环境失败,触发 CanvasErrorBoundary → 改用 `<hemisphereLight>` 零外部依赖。
5. **Nginx 默认 root 是 `/home/wwwroot/ai_video`** — director_stage 访问 URL 是 `/ai_video/director_stage/`(不是 `/director_stage/`)。后者会 404。

## 端到端验证

```bash
# 1. PHP 文件无 BOM
od -An -tx1 -N3 /home/wwwroot/ai_video/director_stage/api/director_stage_scene_agent.php
# 应输出: 3c 3f 70

# 2. PHP-FPM 已重启
ps -ef | grep 'php-fpm: master'

# 3. lib/ 已部署
ls /home/wwwroot/ai_video/director_stage/lib/

# 4. 浏览器强刷 → 点"从节点重建" → 不再 500
```

## GitHub 仓库

https://github.com/fcqxliudong/3dDirector