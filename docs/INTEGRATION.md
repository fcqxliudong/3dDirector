# 3D 导演台 · 接入 ai_video 文档

> 给集成者 / 二次开发者看的：3D 导演台如何作为 ai_video 的子模块工作。

**当前版本**：v0.1 (Web 前端) / v0.5 (PHP 后端)  
**目标用户**：ai_video 平台上的内容创作者（非 3D 专业用户）  
**部署位置**：`/home/wwwroot/ai_video/director_stage/`  
**接入策略**：**直接 require ai_video 公共 lib**（不是隔离子应用）

---

## 一、架构定位

3D 导演台是 ai_video 的一个**功能扩展**，不是独立系统。所有底层能力（认证、数据库、LLM、用户权限）都直接复用 ai_video 的实现。

```
┌─────────────────────────────────────────────────────────────────┐
│                     ai_video (主系统)                            │
│ /home/wwwroot/ai_video/                                         │
│                                                                  │
│   index.php              ← ai_video 入口                         │
│   lib/                   ← 公共模块（直接复用）                  │
│     ├─ auth.php          ← auth_boot() / csrf_token()            │
│     ├─ db.php            ← PDO 单例                              │
│     ├─ llm_api.php       ← LLM 调用层                             │
│     ├─ model_entries.php ← provider 凭据管理                     │
│     ├─ users_mirror.php  ← 用户公开 payload                       │
│     ├─ site_config.php   ← 站点配置                                │
│     └─ membership.php    ← 用户会员资格                            │
│                                                                  │
│   api/                   ← ai_video 自身 API（不调用）           │
│   static/                ← ai_video 前端 assets（不修改）         │
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │  director_stage/   ← 3D 导演台子模块                   │   │
│   │                                                          │   │
│   │    index.php        ← 页面入口（含 auth_boot + 注入）    │   │
│   │    api/             ← 6 个 endpoint（独立路径）         │   │
│   │    lib/             ← 6 个业务模块（require ai_video lib）│   │
│   │    static/director_stage/                                │   │
│   │      index.html     ← Vite build 入口                     │   │
│   │      assets/        ← JS / CSS chunks                     │   │
│   │    schema-director_stage.sql                              │   │
│   │    nginx.conf.snippet  ← 可选 Nginx 规则                    │   │
│   └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、接入清单（集成者需要知道的事实）

### 2.1 路由接入

| 路径 | 文件 | 行为 |
|---|---|---|
| `/ai_video/director_stage/` | `director_stage/index.php` | 页面入口，未登录跳转 `/login.php` |
| `/api/director_stage_*.php` | `director_stage/api/*.php` | 6 个 API endpoint |
| `/ai_video/director_stage/static/...` | Vite build 产物 | 由 ai_video Nginx 静态服务 |

**Nginx 接入**：3D 导演台**不需要**专门的 Nginx 配置块。ai_video 现有的 `location ~ \.php$` 已经处理 `director_stage/api/*.php` 和 `director_stage/index.php`。

可选优化：参考 `server-php/nginx.conf.snippet`，给 `director_stage/api/` 加 `client_max_body_size 50M`（上传模型用）。

### 2.2 认证接入

**完全复用 ai_video 的 session 机制**。

```php
// director_stage/index.php 第 19-23 行
require_once __DIR__ . '/../lib/auth.php';
auth_boot();
$u = current_user();
if (!$u) {
    // 未登录 → 跳 ai_video 登录页
    header('Location: /login.php?redirect=' . urlencode('/ai_video/director_stage/'));
    exit;
}
```

API endpoint 同样调用 `auth_boot()` + `current_user()`：
```php
// director_stage/api/director_stage_schema.php
require_once __DIR__ . '/../../lib/auth.php';
auth_boot();
$u = current_user();
if (!$u) {
    json_out(['error' => 'unauthorized'], 401);
    exit;
}
```

**前端拿用户信息**：
```html
<!-- 由 index.php 注入到 HTML head -->
<script>
  window.__DIRECTOR_STAGE__ = {
    user: { id, username, is_admin, csrf },
    endpoints: { schema, assets, scenes, render, agent, selfcheck },
    schemaVersion: '0.1'
  };
</script>
```

### 2.3 CSRF 接入

ai_video 用 `csrf_token()` / `csrf_check()` 双 token 机制。3D 导演台 API：
- POST 请求必须带 `X-CSRF-Token` header（值 = `csrf_token()`）
- 前端从 `window.__DIRECTOR_STAGE__.user.csrf` 拿 token

### 2.4 数据库接入

**复用 ai_video 库**（同一 PDO 单例，同一 schema）。

3D 导演台新增 3 张表，全部以 `director_stage_` 前缀（避免与 ai_video 现有表冲突）：

| 表名 | 用途 |
|---|---|
| `director_stage_scene` | 保存用户编辑的场景 JSON（一个用户多个场景）|
| `director_stage_render_job` | 异步渲染任务队列（视频模型 dispatch）|
| `director_stage_selfcheck` | 多模态自校验结果（生成视频与 scene 是否一致）|

**建表 SQL**：`server-php/schema-director_stage.sql`（3.7 KB，幂等 CREATE TABLE IF NOT EXISTS）。

**数据库迁移**：
```bash
# 方式 A：phpMyAdmin → 选 ai_video 库 → SQL 标签 → 粘贴 schema-director_stage.sql
# 方式 B：CLI
mysql -u root -p ai_video < server-php/schema-director_stage.sql
```

### 2.5 LLM 接入（未来）

**直接复用 ai_video 的 LLM 调用层**：

```php
// director_stage/api/director_stage_scene_agent.php
require_once __DIR__ . '/../../lib/llm_api.php';
require_once __DIR__ . '/../../lib/model_entries.php';

// 拿用户配的凭据（用户 model_entries 表里自己填的 base_url + api_key）
$conn = llm_connection_for($provider, $user['id']);
// 或从 model_entries 读（按 category='agent' 匹配）
$creds = model_entry_runtime_credentials('agent', $provider, $modelId, $user['id']);
```

**当前状态**：endpoint 已写好（`scene_agent.php`），但前端 `AgentPanel.handleSend` 还没接 LLM（先 echo user message 显示"开发中"）。

---

## 三、HTTP API 速查表

所有 endpoint 返回 JSON。POST 必须带 `X-CSRF-Token` header。

| 路径 | 方法 | 用途 |
|---|---|---|
| `/api/director_stage_schema.php` | GET | 拿 Scene JSON Schema 文档（Zod-style）|
| `/api/director_stage_assets.php` | GET/POST | 资产 CRUD（未来上传 GLB 用）|
| `/api/director_stage_scene.php` | GET/POST/DELETE | 场景 CRUD（保存/加载用户编辑）|
| `/api/director_stage_render.php` | POST | 提交渲染任务（用 ai_video 视频模型 dispatcher）|
| `/api/director_stage_scene_agent.php` | POST | Agent LLM 调用（场景对话控制）|
| `/api/director_stage_selfcheck.php` | POST | 多模态校验：生成视频 vs Scene JSON |

**响应结构**（统一）：
```json
{ "ok": true,  "data": {...} }
{ "ok": false, "error": "human-readable msg", "code": "INVALID_INPUT" }
```

---

## 四、Scene JSON Schema v0.1

完整 schema 在 `packages/scene-schema/src/schema.ts`。关键约束：

| 字段 | 类型 | 约束 |
|---|---|---|
| `version` | string | "0.1" |
| `duration` | number | 整数, **1 ≤ d ≤ 30**（硬约束）|
| `fps` | enum | 24 / 30 / 60 |
| `aspect` | enum | "2.76:1" / "2.39:1" / "2.00:1" / "1.85:1" / "16:9" / "4:3" / "9:16" / "1:1" |
| `scene.preset` | enum | "room_small" / "corridor" / "street" / "forest" / "space" |
| `actors[].id` | string | 唯一 |
| `camera.keyframes` | array | **至少 2 个**, t ∈ [0, duration] |
| `camera.keyframes[].lookAt` | string \| Vec3 | string = actor.id 引用 |
| `actor.moves` | array | t0 < t1, 时间段不重叠 |

完整 schema 通过 `/api/director_stage_schema.php` 拉取（Zod → JSON Schema 转换）。

---

## 五、参数传入与获取（集成者关心）

3D 导演台接受 5 类外部参数，按优先级从高到低：

```
URL query string > localStorage > AI 智能体修改 > 用户手动 UI
```

### 5.1 语言 (lang)

**当前实现**：i18n 双语（zh / en），默认 zh。

**传入方式**：

| 优先级 | 来源 | 代码 | 说明 |
|---|---|---|---|
| 1 | URL query | `?lang=en` | 页面加载时 localStorage 会被覆盖 |
| 2 | localStorage | `ds.lang = 'en'` | 持久化用户偏好 |
| 3 | UI 操作 | Topbar `<select class="lang-select">` | 切换后写 localStorage + 通知所有 `useT()` hook |

**集成代码**：
```typescript
// src/i18n.ts (已实现)
const STORAGE_KEY = 'ds.lang';
function loadInitial(): Lang {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'zh' || stored === 'en') return stored;
  return 'zh';
}
```

**集成示例（URL 跳转）**：
```javascript
// 从其他模块跳转到 director_stage 时预设语言
window.location.href = '/ai_video/director_stage/?lang=en';
```

**未来扩展**：增加更多语言 → 修改 `src/locales/{lang}.json` + `src/i18n.ts` 的 `Lang` type + setLang 逻辑。

### 5.2 智能体模型 (agent model)

**当前实现**：endpoint 已写好（`scene_agent.php`），前端 AgentPanel 是 shell（暂未接 LLM）。

**模型来源**：`ai_video` 的 `model_entries` 表，按 `category='agent'` 过滤：

```sql
SELECT provider, model_id, label, base_url, api_key_enc, is_default
FROM model_entries
WHERE category = 'agent'
  AND status = 'active'
ORDER BY is_default DESC, sort_order ASC, id ASC;
```

**集成代码（PHP 后端）**：
```php
// director_stage/lib/director_stage_scene_agent.php

require_once __DIR__ . '/../../lib/model_entries.php';
require_once __DIR__ . '/../../lib/llm_api.php';

// 1. 拿用户配的凭据（用户自己在 ai_video settings 里填的 base_url + api_key）
$userId = (int)$u['id'];
$creds = model_entry_runtime_credentials('agent', $provider, $modelId, $userId);
// 返回 ['api_key' => '...', 'base_url' => '...', 'entry_id' => N, 'has_key' => true]

// 2. 或者用系统默认 model（用户在 model_entries 标记 is_default=1）
$defaultAgent = model_entries_default_for('agent');

// 3. 调用 LLM
$response = llm_call_openai_compatible(
  $creds['base_url'],
  $creds['api_key'],
  $modelId,
  $messages,
  ['tools' => $agentTools]  // function calling
);
```

**集成代码（前端控制）**：
```typescript
// 用户选模型的 UI（未来在 AgentPanel 加 dropdown）
const models = await fetch('/api/director_stage_scene_agent.php?action=list', {
  headers: { 'X-CSRF-Token': window.__DIRECTOR_STAGE__.user.csrf }
});
// 后端从 model_entries 表 SELECT
// 返回: [{ provider: 'minimax', modelId: 'MiniMax-M3', label: '...', isDefault: true }]
```

**优先级**：
1. 用户在 director_stage UI 选的具体 model
2. 用户在 ai_video settings 配的私有 model_entries
3. 系统的 is_default model_entries
4. fallback：平台级 preset（`llm_connection_for`）

### 5.3 分辨率 (resolution)

**当前实现**：viewport 渲染尺寸 = scene-viewer 实际尺寸（按 aspect fit letterbox）。导出视频时 = canvas captureStream 的 native size。

**传入方式**（导出时）：

```php
// director_stage/api/director_stage_render.php
$body = json_decode(file_get_contents('php://input'), true);
$width = (int)($body['width'] ?? 1920);    // 默认 1920
$height = (int)($body['height'] ?? 1080);  // 默认 1080

// 或者按 aspect 自动算
$aspect = $scene['aspect']; // "16:9"
[$aw, $ah] = explode(':', $aspect);
$ratio = (float)$aw / (float)$ah;
$width = 1920;
$height = (int)round($width / $ratio);
```

**前端 viewport 尺寸**（用户屏幕决定）：
- 不传 URL 参数 → 浏览器视口大小（CSS 自动 fit）
- URL 参数 `?w=1920&h=1080`（导出预览用）→ 前端读取并设置 viewport

**集成代码（前端）**：
```typescript
// src/scene/SceneViewer.tsx（已实现）
const urlParams = new URLSearchParams(location.search);
const exportW = parseInt(urlParams.get('w') ?? '0');
const exportH = parseInt(urlParams.get('h') ?? '0');
// 如果有 exportW/H，letterbox 容器就用固定尺寸（导出预览模式）
```

**视频模型 dispatch**（最终输出视频尺寸）：
```typescript
// export 任务时传给视频模型
{
  prompt: scene.description,
  width: 1920,
  height: 1080,
  duration: 15,        // ← 与 scene.duration 联动
  reference_video: '/director_stage/render/{job_id}.webm'  // ← 3D 导演台的预览
}
```

### 5.4 画面比例 (aspect ratio)

**当前实现**：8 个枚举，默认 16:9。

**传入方式**：

| 优先级 | 来源 | 代码 |
|---|---|---|
| 1 | URL query | `?aspect=9:16` |
| 2 | Sidebar `<select>` | `store.setAspect(aspect)` |
| 3 | AI 智能体 | `setAspect('9:16')` via store action |

**集成代码（schema enum）**：
```typescript
// packages/scene-schema/src/constants.ts
export const ASPECT_RATIO_INFO: Record<AspectRatio, { ratio: number; use: string }> = {
  '2.76:1': { ratio: 2.76, use: 'Ultra Panavision 70' },
  '2.39:1': { ratio: 2.39, use: 'Scope / Anamorphic' },
  '2.00:1': { ratio: 2.00, use: 'IMAX 增强' },
  '1.85:1': { ratio: 1.85, use: 'Flat' },
  '16:9':   { ratio: 16/9, use: 'HDTV' },
  '4:3':    { ratio: 4/3,  use: 'Academy' },
  '9:16':   { ratio: 9/16, use: '竖屏' },
  '1:1':    { ratio: 1,    use: '方形' },
};
```

**前端所见即所得**：SceneViewer 用 inline JS 算 aspect-fit 尺寸（letterbox 留白），保证 camera 渲染 = 导出视频比例。

**集成示例**：
```javascript
// Agent LLM tool call
{
  name: 'setAspect',
  params: { aspect: '9:16' }
}
// 前端执行: useSceneStore.getState().setAspect('9:16')
```

### 5.5 时间线时长 (duration)

**当前实现**：默认 10s，硬约束 1-30s。

**传入方式**：

| 优先级 | 来源 | 代码 |
|---|---|---|
| 1 | URL query | `?duration=15` |
| 2 | `emptyScene(preset, duration)` 调用参数 | 第二参数 |
| 3 | UI input + − / + 按钮 | `store.setDuration(d)` |
| 4 | AI 智能体 | `setDuration(20)` via store |

**集成代码（schema 接受空 duration）**：
```typescript
// packages/scene-schema/src/defaults.ts（已实现）
export function emptyScene(
  preset: keyof typeof SCENE_PRESET_INFO = 'room_small',
  durationOpt?: number,  // ← 外部传入
): SceneJSON {
  const duration = durationOpt ?? 10;
  return {
    duration,
    camera: {
      keyframes: [
        { t: 0, ... },
        { t: duration, ... },  // ← 尾帧 t = duration
      ],
    },
  };
}
```

**集成代码（自动 clip 关键帧）**：
```typescript
// packages/web/src/store/scene.ts（已实现）
setDuration: (d) => {
  set((st) => {
    const newDuration = Math.max(1, Math.min(30, d));
    // 超出新 duration 的关键帧 t 截到边界
    const clippedKfs = st.scene.camera.keyframes.map((kf) =>
      kf.t > newDuration ? { ...kf, t: newDuration } : kf
    );
    return { scene: { duration: newDuration, camera: { keyframes: clippedKfs } } };
  });
}
```

**集成示例（URL 一次性传入）**：
```javascript
// 在 director_stage/index.php 里解析 URL duration
$duration = isset($_GET['duration']) ? max(1, min(30, (int)$_GET['duration'])) : 10;

// 注入到前端（window.__DIRECTOR_STAGE__ 或 scene 初始 JSON）
$sceneJson = json_encode(emptyScene('stand_over', $duration));  // 客户端用这个初始化
```

### 5.6 集成模式总结

```
┌────────────────────────────────────────────────────────────────┐
│ URL 传入（一次性场景配置）                                       │
│  /ai_video/director_stage/?lang=en&aspect=9:16&duration=15     │
│  → 页面打开时解析 → 注入 scene 初始 JSON + i18n 初始 lang       │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│ localStorage 持久化                                              │
│  ds.lang = 'en'                                                  │
│  → 跨会话保留用户偏好                                             │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│ AI 智能体修改（自然语言控制）                                    │
│  AgentPanel → POST /api/director_stage_scene_agent.php           │
│  → LLM tool calls → store.setAspect / setDuration / addActor    │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│ UI 操作（手动）                                                   │
│  Sidebar / Timeline / Topbar 直接 store action 调用              │
└────────────────────────────────────────────────────────────────┘
```

### 5.7 集成检查清单

集成 3D 导演台到新模块 / 新场景时，确认：

- [ ] URL 参数：`lang` `aspect` `duration` 解析逻辑接入
- [ ] localStorage：`ds.lang` 持久化 UI 行为
- [ ] LLM agent 凭据：model_entries 表配 agent category 的 provider + base_url + api_key
- [ ] 导出视频：width × height 按 aspect 自动算
- [ ] 输出视频模型 dispatch：reference_video + duration + aspect + prompt 一起发

---

## 六、前端集成

### 6.1 Web 前端 = Vite + React + R3F

源码：`packages/web/`  
打包：`packages/web/dist/`  
入口：`packages/web/src/main.tsx`

**部署产物路径**（与后端对应）：
```
本地：packages/web/dist/          →  远端：/home/wwwroot/ai_video/director_stage/static/director_stage/
├── index.html                    →  static/director_stage/index.html
└── assets/                       →  static/director_stage/assets/
    ├── index-XXX.js (entry)      ├── index-XXX.js
    ├── react-XXX.js              ├── react-XXX.js
    ├── gsap-XXX.js               ├── gsap-XXX.js
    ├── zustand-XXX.js            ├── zustand-XXX.js
    ├── r3f-XXX.js                ├── r3f-XXX.js
    ├── three-XXX.js              ├── three-XXX.js
    └── en-XXX.js (lazy load)     └── en-XXX.js
```

### 6.2 注入到 ai_video

`director_stage/index.php` 在 HTML head 注入运行时配置：

```php
$inject = <<<HTML
<meta name="csrf-token" content="{$csrf}" />
<script>
window.__DIRECTOR_STAGE__ = {
  user: { id, username, is_admin, csrf },
  endpoints: { schema, assets, scenes, render, agent, selfcheck },
  schemaVersion: '0.1',
};
</script>
HTML;
$html = str_replace('</head>', $inject . '</head>', $html);
```

**前端用 `window.__DIRECTOR_STAGE__.endpoints` 拼 endpoint URL**，而不是 hardcode `/api/...`。

### 6.3 资源路径修正

Vite 默认 base 是 `./`（输出 `./assets/index-XXX.js`），但实际资源在 `static/director_stage/assets/`。`index.php` 在输出前做字符串替换：

```php
$html = str_replace('"./assets/', '"./static/director_stage/assets/', $html);
$html = str_replace("'./assets/", "'./static/director_stage/assets/", $html);
```

### 6.4 一键部署脚本

`server-php/deploy-remote.ps1`（PowerShell + PuTTY pscp+plink）：
1. 上传 `index.php` + `api/*.php`
2. 上传 `dist/*` 到 `static/director_stage/`
3. 远端 chown www + chmod 755
4. 验证远端文件结构

需要：**PuTTY 安装在 C:\Program Files\PuTTY** + **PPK 私钥在 D:\154.36.175.ppk**（ASCII 路径，避免中文乱码）。

---

## 七、依赖关系（集成者必读）

3D 导演台**强依赖**以下 ai_video 公共 lib：

| 依赖 | 用途 | 缺失时后果 |
|---|---|---|
| `lib/auth.php` | auth_boot / current_user / csrf_token | **致命** — 无法登录 |
| `lib/db.php` | PDO 实例 | **致命** — 数据查询失败 |
| `lib/users_mirror.php` | user_public_payload | 用户信息缺失 |
| `lib/site_config.php` | site_app_name 等 | 文案 fallback 异常 |
| `lib/membership.php` | membership_ensure_user | 会员状态不更新 |
| `lib/llm_api.php` | llm_connection_for | Agent endpoint 不可用（但页面可正常） |
| `lib/model_entries.php` | model_entry_runtime_credentials | 同上 |

**风险**：如果未来 ai_video 重构/重命名这些 lib 函数，3D 导演台需要同步更新。

**降级方案**：把 ai_video 公共 lib **拷贝一份到 `director_stage/lib/`**，但要维护两份。建议**直接 require**。

---

## 八、不做的事（避免污染 ai_video）

| ❌ 不做 | 原因 |
|---|---|
| 修改 ai_video Nginx 配置 | 现有 `location ~ \.php$` 已经处理 |
| 修改 ai_video `lib/` | 公共模块复用 |
| 修改 ai_video `static/` | 已有 ai_video 前端 assets |
| 修改 ai_video MySQL 表结构 | 只在 ai_video 库内新建 `director_stage_*` 表 |
| 修改 ai_video PHP session 配置 | 复用现有 session 机制 |

所有改动**严格局限**在 `/home/wwwroot/ai_video/director_stage/` 这一个目录。

---

## 九、调试 / 故障排查

### 9.1 部署后页面白屏

**症状**：浏览器加载页面但 3D Canvas 黑屏/不显示。

**排查步骤**：
1. 浏览器 DevTools → Console 看是否有 JS 报错
2. Network → JS 看是否有 404（远端 hash 文件缺失）
3. 如果是旧的 hash 404 → 浏览器 disk cache / CDN cache，**Ctrl+Shift+R 强刷**
4. Cloudflare CDN 缓存：`cache-control: max-age=259200`（3天）→ 新部署可能要等 CDN 边缘节点过期

### 9.2 登录后跳回登录页

**症状**：明明登录了但访问 director_stage 跳到 /login.php。

**原因**：`auth_boot()` 调用失败，session 没拿到。

**排查**：
```php
// 在 director_stage/index.php 顶部加 log
error_log('[DS] session_id=' . session_id());
error_log('[DS] cookie=' . json_encode($_COOKIE));
```

### 9.3 数据库表不存在

**症状**：API 返回 "Table 'ai_video.director_stage_scene' doesn't exist"。

**修复**：
```bash
mysql -u root -p ai_video < server-php/schema-director_stage.sql
```

### 9.4 远端 hash 文件残留

**症状**：新部署后 CDN/Cloudflare 还在 serve 旧 hash 404。

**临时解决**：
```bash
# 远端清理
ssh root@154.36.175.39 "cd /home/wwwroot/ai_video/director_stage/static/director_stage/assets/ ; \
  rm -f old-hash.js old-hash2.js ; \
  ls -la"
```

**长期解决**：部署前手动清空 `packages/web/dist/assets/`，只保留当前 build 产出的 4 个文件。

---

## 十、版本演进

| 版本 | 状态 | 关键能力 |
|---|---|---|
| v0.1 | ✅ 已上线 | Web 前端基础能力（Timeline / Scene / Camera / 8 个 aspect） |
| v0.5 | ✅ 已上线 | PHP 后端 6 个 endpoint + 3 张表 + 部署脚本 |
| v0.6 | 🟡 进行中 | i18n（zh/en）+ Agent LLM shell + GLB 上传 |
| v1.0 | ⏳ 待规划 | 真实视频模型 dispatch + 多模态自校验 + 历史版本对比 |

---

## 十一、相关文档

- `server-php/README.md` — 部署脚本 + API 完整说明
- `packages/scene-schema/src/schema.ts` — Scene JSON Schema 完整定义
- `D:\000AI出片\3D导演台\蓝图.html` — 产品蓝图（前端 UI 设计来源）
- `D:\000AI出片\ai_video\README.md`（如果有）— ai_video 主系统文档

---

## 附：部署后目录结构（参考）

```
/home/wwwroot/ai_video/
├── index.php                ← ai_video 主入口
├── lib/                     ← 公共模块
├── api/                     ← ai_video API
└── director_stage/          ← 3D 导演台
    ├── index.php            (5 KB)
    ├── schema-director_stage.sql (3.7 KB)
    ├── nginx.conf.snippet   (4.7 KB)
    ├── api/
    │   ├── director_stage_schema.php
    │   ├── director_stage_assets.php
    │   ├── director_stage_scene.php
    │   ├── director_stage_render.php
    │   ├── director_stage_scene_agent.php
    │   └── director_stage_selfcheck.php
    ├── lib/
    │   ├── director_stage_schema.php
    │   ├── director_stage_assets.php
    │   ├── director_stage_scene.php
    │   ├── director_stage_render.php
    │   ├── director_stage_scene_agent.php
    │   └── director_stage_selfcheck.php
    └── static/director_stage/
        ├── index.html       (Vite 入口)
        └── assets/
            ├── index-XXX.js       (entry, ~120 KB)
            ├── react-XXX.js       (~146 KB vendor)
            ├── gsap-XXX.js        (~70 KB vendor)
            ├── zustand-XXX.js     (~0.65 KB vendor)
            ├── r3f-XXX.js         (~352 KB vendor)
            ├── three-XXX.js       (~683 KB vendor)
            └── en-XXX.js          (~4 KB, lazy load)
```