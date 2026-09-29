# 3D 导演台 · PHP 后端部署包 · v0.5 · 子目录部署版

部署为 ai_video 的**子目录**（不是隔离）：`/home/wwwroot/ai_video/director_stage/`，跟 ai_video 共享域名、共享 session、共享 db，**ai_video 可直接 require 调用**。

**远程系统版本**：Nginx 1.30.4 / PHP 8.4.21 / MySQL 8.0.45 / Redis 8.0.5

---

## 核心设计原则

> **不是隔离，是子目录；不是独立系统，是 ai_video 的能力扩展。**

```
/home/wwwroot/ai_video/
├── index.php                ← ai_video 入口
├── lib/                     ← ai_video 共享 lib（不动）
│   ├── auth.php
│   ├── db.php
│   ├── llm_api.php
│   └── model_entries.php
├── api/                     ← ai_video API（不动）
└── director_stage/          ← 3D 导演台（**是 ai_video 子目录**）
    ├── index.php            ← /ai_video/director_stage/
    ├── lib/                ← 业务模块 · ai_video 可直接 require
    ├── api/                ← API 路由（后续按需启用）
    ├── static/             ← 前端 R3F 编译产物
    └── data/               ← 文件系统存场景

# 共享功能：
#   ✓ session（自动共享 · 不需要任何配置）
#   ✓ 数据库连接（同一个 PDO · 同一个 ai_video 库）
#   ✓ llm_api / model_entries（直接 require 复用）
#   ✓ 用户鉴权（auth_boot / current_user / require_login_api 直接可用）
```

---

## 一、部署步骤（5 步）

### 1. 上传 server-php/ 到服务器临时目录

```bash
# 本地打包
Compress-Archive -Path server-php/* -DestinationPath server-php.zip
scp server-php.zip www@your-server:/tmp/

# 服务器解压
ssh www@your-server
cd /tmp && unzip server-php.zip -d server-php-tmp
```

### 2. 跑数据库迁移（建 3 张表 · 复用 ai_video 库）

**两种方式任选**：

#### 方式 A：phpMyAdmin（推荐 · 图形化）

1. 左侧导航 → 点 `ai_video` 库
2. 顶部 **SQL** 标签
3. 把 `schema-director_stage.sql` 全文粘贴
4. 取消顶部"默认"复选框（避免加 LIMIT）
5. 点 **执行**

**如果报错**："near AUTO_INCREMENT" / "near 512" / "near NOT NULL" —— 这是 phpMyAdmin 多语句 + JSON 类型的解析冲突。
**解决**：用 v0.3+ 的 SQL（已修，JSON → LONGTEXT）。

#### 方式 B：命令行

```bash
mysql -u ai_video -p ai_video < /tmp/server-php-tmp/schema-director_stage.sql
```

会创建：
- `director_stage_scene` — 场景元数据
- `director_stage_render_job` — 渲染任务队列
- `director_stage_selfcheck` — 多模态审片历史
- `schema_meta.version['director_stage'] = 1`

### 3. 一键部署到 `/home/wwwroot/ai_video/director_stage/`

```bash
cd /tmp/server-php-tmp
chmod +x deploy.sh
./deploy.sh   # 默认就是 /home/wwwroot/ai_video/director_stage
```

deploy.sh 自动：
- rsync 业务文件到目标目录（不带 schema.sql / deploy.sh / .htaccess）
- chown www:www
- chmod 755
- 建 data/director_stage/scenes/ 子目录
- 验证 ai_video/lib/ 依赖文件存在

### 4. **Nginx 配置**（最小补丁 · 不是新 location 块）

Nginx 1.30.4 不读 .htaccess，但因为导演台是 ai_video **子目录**（同域名），ai_video 现有的 `location ~ \.php$ { fastcgi_pass ... }` 块**自动会处理** director_stage 的 PHP 文件。

**只需要在 ai_video 现有 server 块里加 3 个参数**：

| # | 参数 | 必要性 |
|---|---|---|
| 1 | `client_max_body_size 50M;` | **必须** · 默认 1M 会拒绝 mp4 上传 |
| 2 | `deny all` on `/lib/` `/data/` | 建议 · 防源码与场景数据外泄 |
| 3 | Vite 产物 immutable 缓存 | 建议 · 性能优化 |

具体怎么写，参考 `nginx.conf.snippet`（注释里给了 3 段代码，直接复制粘贴到对应位置）。

应用配置：

```bash
sudo nginx -t                  # 检查语法
sudo systemctl reload nginx    # 平滑重载
```

**不需要做的事**：
- ❌ 新增独立 `location ^~ /ai_video/director_stage/` 块（ai_video 现有的 .php 块自动接管）
- ❌ 新增 `fastcgi_pass`（复用 ai_video 已有的 PHP-FPM）
- ❌ `try_files` fallback（director_stage 没有 SPA 多路由需求）

### 5. 验证

```bash
# 命令行验证
curl -I https://your-domain/ai_video/director_stage/

# 浏览器验证
# ✅ 已登录 → 看到 director stage 占位页（PHP 渲染）
# ❌ 未登录 → 跳 ai_video 登录页
# ✅ HTTP 200，无 500 错误
```

如果 500，tail PHP-FPM 日志：

```bash
sudo tail -f /var/log/php-fpm/error.log
```

---

## 二、URL 路由

部署后路径：`https://your-domain/ai_video/director_stage/...`

| URL | Method | 行为 | 状态 |
|---|---|---|---|
| `/ai_video/director_stage/` | GET | 渲染 SPA 入口 | ✅ |
| `/ai_video/director_stage/static/*` | GET | 静态资源（Vite 编译产物）| ✅ |
| `/ai_video/director_stage/api/director_stage_schema.php` | GET | 暴露 v0.1 JSON Schema | ✅ |
| `/ai_video/director_stage/api/director_stage_assets.php` | GET | 启动包 | ✅ |
| `/ai_video/director_stage/api/director_stage_scene.php` | POST | action=save / load / list / delete | ✅ |
| `/ai_video/director_stage/api/director_stage_render.php` | POST | action=submit / get / list | ✅ |
| `/ai_video/director_stage/api/director_stage_scene_agent.php` | POST | LLM 生成场景 | ✅ |
| `/ai_video/director_stage/api/director_stage_selfcheck.php` | POST | 多模态审片 | ✅ |

---

## 三、ai_video 调用导演台（核心价值）

**为什么是子目录部署**：ai_video 任何 PHP 代码都能直接 require 导演台的 lib，无需任何 API 层。

### 调用示例 1：Agent 生成场景（ai_video 里集成）

```php
<?php
// 在 ai_video 的某个 api/*.php 或 lib/*.php 里
require_once __DIR__ . '/director_stage/lib/director_stage_scene_agent.php';

// auth_boot 已在外层调过 · $u 已拿到 · $uid = $u['id']
$result = ds_scene_agent_generate($uid, "一个废弃太空站走廊，失重状态…");
if ($result['ok']) {
    $scene = $result['scene'];   // 合法 SceneJSON v0.1
    // 接下来可以保存 / 渲染 / 推到前端
}
```

### 调用示例 2：保存场景

```php
require_once __DIR__ . '/director_stage/lib/director_stage_scene.php';
$saved = ds_scene_save($uid, $scene, 'My first scene');
// $saved['id'] 拿到新场景 ID
```

### 调用示例 3：提交渲染任务

```php
require_once __DIR__ . '/director_stage/lib/director_stage_render.php';
$job = ds_render_submit($uid, $sceneId, 'kling', 'kling-v1-5');
// $job['job_id'] 拿去轮询 / 异步处理
```

### 调用示例 4：校验 SceneJSON

```php
require_once __DIR__ . '/director_stage/lib/director_stage_schema.php';
$r = ds_validate_scene($inputJson);
if (!$r['ok']) {
    json_response(['errors' => $r['errors']], 400);
}
$cleanScene = $r['data'];
```

### 完整列表（导演台 lib 暴露的函数）

| 函数 | 用途 |
|---|---|
| `ds_validate_scene($input)` | 校验 SceneJSON v0.1 |
| `ds_empty_scene($preset)` | 工厂函数 · 创建空场景 |
| `ds_scene_save/load/list/delete($uid, ...)` | 场景 CRUD |
| `ds_scene_agent_generate($uid, $prompt)` | LLM 生成场景 |
| `ds_render_submit($uid, $sceneId, $provider, $modelId)` | 提交渲染任务 |
| `ds_render_job_get/list/claim_next/complete/fail(...)` | 任务队列管理 |
| `ds_selfcheck($uid, $sceneId, $imageUrl)` | 多模态审片 |
| `ds_assets_bootstrap()` | 给前端的启动包 |
| `ds_stable_stringify($value)` | 稳定 JSON 序列化（diff 用）|

---

## 四、跨目录 require 设计

`director_stage/lib/*.php` 里的 require 路径：

```php
// 部署到 /home/wwwroot/ai_video/director_stage/lib/ 后
// __DIR__ = /home/wwwroot/ai_video/director_stage/lib
// ../lib/auth.php → /home/wwwroot/ai_video/lib/auth.php ✓

require_once __DIR__ . '/../lib/auth.php';           // ai_video 用户鉴权
require_once __DIR__ . '/../lib/db.php';            // ai_video PDO 单例
require_once __DIR__ . '/../lib/llm_api.php';       // ai_video LLM Dispatcher
require_once __DIR__ . '/../lib/model_entries.php'; // ai_video model_entries 表
require_once __DIR__ . '/director_stage_schema.php'; // 同目录 · 不跨
```

**绝对不写绝对路径**——部署到任何 `/ai_video/director_stage/` 形式都能跑。

---

## 五、安全

- 所有 API endpoint 强制 `require_login_api()`
- 所有 lib 函数只接受 `$uid`（不接 username · 防越权）
- 用户只能 load/save/delete 自己的 scene
- Nginx `deny all` 禁止直接访问 `lib/` `data/` `schema/` 源码与场景数据
- 安全 headers（X-Frame-Options / X-Content-Type-Options）
- 上传大小限制 50M

**LLM 输入防注入**：
- Agent prompt 严格 system + user 二段式
- 不暴露内部变量到 LLM
- 解析失败走兜底（剥离 ```json``` 围栏）

---

## 六、Worker 进程（生产）

`ds_render_submit()` 只入队不真调视频模型。生产环境需要 worker：

```bash
*/1 * * * * cd /home/wwwroot/ai_video && php -r '
require_once "lib/director_stage_render.php";
while (($job = ds_render_job_claim_next()) !== null) {
    $ok = call_video_model($job);
    if ($ok) {
        ds_render_job_complete($job["id"], $ok["url"], $ok["meta"]);
    } else {
        ds_render_job_fail($job["id"], $ok["error"] ?? "unknown");
    }
}
'
```

`call_video_model()` 实现细节不在本包（属于 dispatcher 内部）· 参考 ai_video 现有 `media_generate.php`。

---

## 七、版本对齐

| 文件 | 同步源 | 状态 |
|---|---|---|
| `director_stage/lib/director_stage_schema.php` | `packages/scene-schema/src/constants.ts` | ✅ 1:1 对齐 |
| `director_stage/lib/director_stage_assets.php` | `packages/scene-schema/src/constants.ts` | ✅ |
| `schema-director_stage.sql` | （新版 · 不依赖 TS） | ✅ 3 表 |
| 前端 R3F 应用 | `packages/web/`（未建） | 🔜 待 Vite 编译 |

---

## 八、依赖关系

```
director_stage/lib/director_stage_schema.php         (无依赖 · 纯函数)
director_stage/lib/director_stage_assets.php         ──> director_stage_schema.php
director_stage/lib/director_stage_scene.php          ──> director_stage_schema.php
director_stage/lib/director_stage_scene_agent.php    ──> director_stage_schema.php + ../lib/{auth,llm_api,model_entries}
director_stage/lib/director_stage_render.php         ──> director_stage_schema.php + ../lib/{auth,db,llm_api,model_entries}
director_stage/lib/director_stage_selfcheck.php      ──> director_stage_schema.php + ../lib/{auth,db,llm_api,model_entries}
```

**复用 ai_video**（**绝对不动**）：
- `lib/auth.php` / `lib/db.php` / `lib/llm_api.php` / `lib/model_entries.php`
- `phone_auth/` 模块（跨项目只读约束，memory 明确）

---

## 九、版本

2026-09-29 · v0.6 · 6 个 API endpoint 就绪 · 前端可 fetch · 完整闭环跑通。