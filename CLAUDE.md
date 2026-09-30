# CLAUDE.md · 3D 导演台 · 项目级 AI 协作说明

> 防止后续 AI 助手在修改 / 部署这个仓库时踩同样的坑。

---

## 1. 仓库结构 vs 部署结构(容易搞错)

**仓库根**(git):`D:\000AI出片\3D导演台\`

```
3D导演台/
├── packages/
│   ├── scene-schema/   ← Zod schema + 类型(单一 SSOT)
│   └── web/            ← React + R3F + Zustand 前端
├── server-php/         ← PHP 后端(lib + api + index.php)
├── docs/                ← INTEGRATION.md 等
├── 策划001.txt / 002.txt / 蓝图.html   ← 产品蓝图
├── package.json         ← monorepo workspaces
├── README.md
├── .gitignore
└── CLAUDE.md            ← 本文件(AI 协作说明)
```

**部署结构**(VPS `/home/wwwroot/ai_video/director_stage/`):

```
/home/wwwroot/ai_video/
├── lib/                              ← ai_video 共享库(auth.php / db.php / llm_api.php / model_entries.php)
├── api/                              ← ai_video 自己的 API(不动)
│   ├── director_stage_*.php          ← ⚠ 历史遗留 proxy 文件,见 §3
│   └── ...
├── director_stage/                   ← 3D 导演台部署根
│   ├── index.php                     ← 页面入口(注入 __DIRECTOR_STAGE__ 配置)
│   ├── api/                          ← 6 个端点
│   ├── lib/                          ← 6 个 lib 实现
│   └── static/director_stage/        ← Vite dist 输出
│       ├── index.html
│       └── assets/                   ← JS/CSS chunks
```

---

## 2. 部署流程(`server-php/deploy-remote.ps1`)

1. 上传 `index.php` → `~/director_stage/index.php`
2. 上传 `api/*.php` → `~/director_stage/api/`
3. **.5** 上传 `lib/*.php` → `~/director_stage/lib/`(易漏!)
4. 上传 `dist/*` → `~/director_stage/static/director_stage/`
5. 远端 `chown -R www:www` + chmod 755

部署后必须**强刷浏览器** `Ctrl+Shift+R`(12h Nginx cache + 3 天 Cloudflare CDN cache)。

---

## 3. ⚠️ 易踩坑点(踩过的坑都写在这里)

### 3.1 `deploy-remote.ps1` 漏部署 `lib/*.php`

- **症状**:所有 API endpoint 返回 HTTP 500,error log 显示
  `Failed to open stream: No such file or directory ... /home/wwwroot/ai_video/director_stage/lib/auth.php`
- **根因**:旧版 `deploy-remote.ps1` 只部署 `api/` + `dist/`,没部署 `lib/`
- **修法**:`deploy-remote.ps1` 已加 `[2.5/4] uploading lib/` 步骤
- **检查**:部署后远端必须看到 `lib/` 目录有 6 个 .php

### 3.2 PHP 文件 UTF-8 BOM 头

- **症状**:`PHP Fatal error: strict_types declaration must be the very first statement in the script ... on line 2`
- **根因**:PowerShell 5.1 的 `Set-Content -Encoding UTF8` 默认会写 BOM(UTF8Encoding($true)),BOM 把 `<?php` 推到 line 1,`declare(strict_types=1)` 落到 line 2 → PHP 拒绝
- **修法**:写文件**永远**用 `[System.Text.UTF8Encoding]::new($false)`:
  ```powershell
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
  ```
- **检查**:每个 PHP 文件首 3 字节应该是 `3C 3F 70`(`<?p`),不是 `EF BB BF`
- **清理已有 BOM**:`sed -i '1s/^\xef\xbb\xbf//' file.php`

### 3.3 PHP-FPM opcache 不刷新

- **症状**:部署后 PHP 代码不生效,error log 还是老错
- **根因**:`opcache.revalidate_freq=60` 不会立刻检测文件变化
- **修法**:`killall -USR2 php-fpm` 或 `pkill -USR2 -f 'php-fpm: master'`(USR2 信号让 master 优雅重启)
- **注意**:`pkill -f 'php-fpm: master'` 中**空格会让 pkill 当成多个 pattern**,要用 `killall -USR2 php-fpm` 或单引号转义

### 3.4 `api/*.php` 的 require 路径要分清

```php
// api/*.php 在 director_stage/api/,require 路径要分两类:
// - ai_video 共享库(auth.php / db.php / llm_api.php / model_entries.php): 2 级 ../../
require_once __DIR__ . '/../../lib/auth.php';
// - director_stage/lib/ 实现: 1 级 ../
require_once __DIR__ . '/../lib/director_stage_schema.php';
```

`lib/*.php`(director_stage/lib/)里:
```php
// 都在 director_stage/lib/,ai_video 共享库是 2 级 ../../
require_once __DIR__ . '/../../lib/auth.php';
// 同目录 lib 文件不存在,不要用 '/../lib/...'(会循环 require 自身)
require_once __DIR__ . '/director_stage_schema.php';
```

### 3.5 drei `<Environment preset="..." />` 从外部 CDN 加载 HDR

- **症状**:Canvas 渲染失败,`Could not load potsdamer_platz_1k.hdr: NetworkError`,trigger CanvasErrorBoundary fallback
- **根因**:drei 从 `https://rawcdn.githack.com/pmndrs/drei-assets/...` 加载 HDR,某些网络环境访问不到
- **修法**:删 `<Environment preset="..." />`,改用 `<hemisphereLight args={['#bcd9ff', '#6a6048', 0.55]} />`(零外部依赖,反射感略弱但稳定)
- **bundle 收益**:r3f chunk 从 233KB → 176KB(-56KB)

### 3.6 `<TransformControls>` 不能有 props.onPointerDown 等 React Hooks violation

- **症状**:React warning:`Warning: Cannot update a component (X) while rendering a different component (Y)`
- **根因**:条件性调用 hooks / 在 transform-controls 内嵌子组件调用 setState
- **修法**:`onObjectChange` 里读 store 用 `useSceneStore.getState()`,不要 hook 订阅

### 3.7 React Hooks 必须在组件顶层调用

- **症状**:页面白屏 / 变白屏
- **根因**:`if (selectedId === 'xxx') { useStore(...) }` 条件性 hook 调用
- **修法**:hooks 必须无条件在顶层调用,后续判断只用 const 派生变量

### 3.8 `git clean -fdX` 在 Windows 上 = 真删 + 不走回收站(2026-09-30 教训)

- **症状**:跑 `git clean -fdX -e 'server-php/deploy-remote.ps1'` 想保留 deploy 脚本,但结果:`-e` 白名单**没生效**,所有 .gitignored 都真删了,包括 `deploy-remote.ps1`(用户工作流核心)、`packages/web/dist/`(部署时需要的 build 输出)、`node_modules/`(开发依赖)
- **根因**:
  1. Windows PowerShell 跑 `git clean` 不走回收站,直接物理删除
  2. `git clean -e <pattern>` 白名单**位置/语法**敏感:在 `--` 前必须把 `-e` 紧跟 `-fdX`,且 pattern 是相对 `/workspace` 根,不是 `(root)` 仓库根
  3. 即便 `-e` 写对了,某些情况下 Git 仍会把白名单当额外操作,**实际行为不可靠**
- **修法**:先 `git clean -nfX` 看 dry-run 列表,**确认无误** + 再 `git clean -fdX`。永远不要在没看到列表时直接执行。
- **预防**:`deploy-remote.ps1`、`dist/`、`node_modules/` 这种关键 .gitignored 文件,**绝不要靠 git clean -e 保留**,必须单独 cp -r 到备份目录
- **踩坑后的恢复路径**:`git fsck --lost-found`(只对已 track 文件有效,对未 track 的 .gitignored 文件无效 → 只能重写 + 重新构建)

---

## 4. 不要碰的东西

- ❌ `/home/wwwroot/ai_video/lib/` — ai_video 共享库(只读)
- ❌ `/home/wwwroot/ai_video/api/` 里**除 director_stage proxy 外的其他文件** — ai_video 自己的 API
- ❌ `/home/wwwroot/ai_video/static/` — ai_video 自己的前端
- ❌ `phone_auth/` 模块(ai_video 视频项目端,只读约束,memory 明确)
- ✅ `/home/wwwroot/ai_video/director_stage/` 整个目录 — 这是导演台自己的,可以动
- ✅ ai_video/api/ 下的 director_stage_*.php proxy — **2026-09-30 已清理**(备份到 `ai_video/api/backup-director-stage-proxy-20260930-105632/`)

---

## 5. 端到端验证清单(部署后必跑)

```bash
# 1. PHP 文件无 BOM
od -An -tx1 -N3 /home/wwwroot/ai_video/director_stage/api/director_stage_scene_agent.php
# 应输出: 3c 3f 70

# 2. PHP-FPM master 已重启
ps -ef | grep 'php-fpm: master'

# 3. lib/ 已部署
ls /home/wwwroot/ai_video/director_stage/lib/

# 4. 浏览器强刷 + 点"从节点重建"→ 不再 500
# URL: https://ai-video.eastseer.com/director_stage/  (注意:不再走 /ai_video/ 前缀)
# API:  https://ai-video.eastseer.com/director_stage/api/...
```

---

## 6. GitHub 同步约定

- **GitHub 仓库**:https://github.com/fcqxliudong/3dDirector
- **Git config (--local)**: `user.name=Eastseer Dev` `user.email=dev@eastseer.com`
- **GCM 凭据**:cmdkey 里 `LegacyGeneric:git:https://github` `User:fcqxliudong`,push 时自动用
- **网络断连**:第一次 push 失败常见,**重试一次就好**,第三次基本 100% 成功
- **commit message**:feat:/fix:/chore: 前缀 + 中文 + 前两行简短 + bullet 列出细节
- **commit 粒度**:整块一个 commit(不是按文件拆)

---

## 7. 联系方式 / 工作流偏好(记忆摘要)

- 用户用 Windows PowerShell 5.1 + PuTTY(pscp/plink)部署
- PPK 私钥 ASCII 路径:`D:\154.36.175.ppk`(中文路径会乱码)
- PowerShell 中文文件名可能显示乱码(Git 显示 UTF-8 escape),但 git 内部按字节处理正常
- 用户偏好"先看现状再动手",沟通直白不啰嗦
- 大量改动 commit/push 前要确认范围(跨任务范围时主动 ask)