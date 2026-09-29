# 3D 导演台 · Director Stage · v0.6

> 给**不会 3D 的内容创作者**用的"AI 生成 3D 空间 → 导演调整 → 导出参考视频 → 喂给视频模型 API"工具。

---

## 一句话定位

> 当前看到的视图 = 摄像机拍什么 · 拖动 playhead + 调整视角 = 完成运镜 · 一键导出粗略 WebM → 喂可灵 / Runway / Luma / Sora 出最终视频。

**核心约束**：导演台产出的**不是最终视频**，是给视频模型的**参考素材**（颜色形状区分即可）。颜色形状对了，模型自己出细节。

---

## 是什么

**3D 导演台 (Director Stage)** 是一个 Web 端的轻量 3D 空间 + 运镜编辑器。

- 目标用户：**不会 3D 软件的内容创作者**（导演 / 编剧 / 内容运营）
- 设计原则：**所见即所得** —— Timeline playhead 永远决定摄像机时间游标，**不暴露 lookAt/ease/fov 这类 3D 软件思维**
- 后端：**ai_video 共享站点的子目录扩展** —— 共享 session / 鉴权 / LLM dispatcher / model_entries 表，不是隔离系统
- 产出：**粗略 WebM 参考视频**（约 10s）→ 喂给商业视频模型 API 出最终成片

---

## 核心特性

| # | 特性 | 说明 |
|---|---|---|
| 1 | **所见即所得运镜** | Timeline playhead = 摄像机时间游标，所见即所得 |
| 2 | **6 个一键运镜模板** | `push_in` / `pull_out` / `orbit` / `crane_up` / `tracking` / `static` |
| 3 | **保存当前视角按钮** | 拖动 → 自动录制 → 关键帧立刻出现，零学习成本 |
| 4 | **Agent 助手** | 通过 ai_video 现有 LLM dispatcher，LLM 读写同一份 SceneJSON（v0.1） |
| 5 | **i18n 全 UI 化** | zh 静态 + en dynamic import，localStorage 持久化 |
| 6 | **粗略 WebM 导出** | `canvas.captureStream` + `MediaRecorder`，给视频模型做参考 |
| 7 | **右侧 tabs 常驻面板** | 🛠 控制台（属性面板） + 🤖 助手（LLM 对话） |
| 8 | **时长 1-30s 硬约束** | 商业 API 单次生成上限，硬约束不做超 30s 拼接 |
| 9 | **8 个画面比例** | 含 Ultra Panavision 70 / Scope / IMAX / Flat / HDTV / Academy / 竖屏 / 方形 |

---

## 仓库结构

```
3D导演台/  ← git: fcqxliudong/3dDirector  (npm workspaces monorepo)
├── packages/
│   ├── scene-schema/    # @director-stage/scene-schema · v0.1
│   │                    # Zod schema + emptyScene factory（单一数据源 SSOT）
│   │                    # 所有模块（前端/Agent/视频模型）都读写这份 JSON
│   └── web/             # @director-stage/web · v0.1
│                        # React + R3F + Zustand 前端
│                        # Vite 编译产物部署到 ai_video/director_stage/static/
├── server-php/          # PHP 后端 · v0.5
│                        # 6 个 API endpoint + 6 个 lib 模块
│                        # 部署到 /home/wwwroot/ai_video/director_stage/
├── docs/
│   └── INTEGRATION.md   # 11 章 ai_video 接入文档（参数传入/共享模型/缓存/部署）
├── 策划001.txt            # 产品思路（v1 草案）
├── 策划002.txt            # 产品详细方案（v2）
├── 蓝图.html              # HTML 版产品蓝图
├── package.json         # workspaces = [scene-schema, web]
├── package-lock.json
└── .gitignore           # node_modules + dist + 密钥 + 编译*.txt
```

---

## 快速开始

### 本地开发

```bash
# 在仓库根目录
cd D:\000AI出片\3D导演台
npm install              # 装所有 workspaces
npm run dev              # 起 web Vite dev server（http://localhost:5173/）
```

### 构建前端 + 部署到 ai_video

```bash
npm run build:web        # 产物在 packages/web/dist/

# 一键部署（PowerShell，PPK 已配置 ASCII 路径）
cd server-php
.\deploy-remote.ps1
```

部署后访问 `https://your-domain/ai_video/director_stage/`，看到默认小房间 + 两个 camera 关键帧即部署成功。

### 部署后端到 ai_video

详见 [`server-php/README.md`](./server-php/README.md)（5 步部署：上传 → DB 迁移 → rsync → Nginx 补丁 → 验证）。

---

## 接入 ai_video

> **不是隔离系统，是 ai_video 的能力扩展**。

3D 导演台作为 ai_video 的**子目录**部署（`/home/wwwroot/ai_video/director_stage/`），共享：

- ✅ session（自动共享 · 不需要任何配置）
- ✅ 数据库连接（同一个 PDO · 同一个 ai_video 库）
- ✅ `llm_api` / `model_entries`（直接 `require_once` 复用）
- ✅ 用户鉴权（`auth_boot` / `current_user` / `require_login_api` 直接可用）

ai_video 任意 PHP 代码可直接 `require` 导演台 lib 函数，详见 [`docs/INTEGRATION.md`](./docs/INTEGRATION.md)（11 章，含参数传入、共享模型、缓存策略、Nginx 部署）。

**lib 函数速查**：

| 函数 | 用途 |
|---|---|
| `ds_validate_scene($input)` | 校验 SceneJSON v0.1 |
| `ds_empty_scene($preset)` | 工厂函数 · 创建空场景 |
| `ds_scene_save/load/list/delete($uid, ...)` | 场景 CRUD |
| `ds_scene_agent_generate($uid, $prompt)` | LLM 生成场景 |
| `ds_render_submit($uid, $sceneId, $provider, $modelId)` | 提交渲染任务 |
| `ds_selfcheck($uid, $sceneId, $imageUrl)` | 多模态审片 |

---

## 产品蓝图

- 📝 [`策划001.txt`](./策划001.txt) — v1 草案（"这个思路可行，关键是让一份结构化的场景描述 JSON 同时被智能体和人操作"）
- 📝 [`策划002.txt`](./策划002.txt) — v2 详细方案（含多通道渲染引导、完整产品架构图）
- 🌐 [`蓝图.html`](./蓝图.html) — HTML 版产品蓝图（可视化产品定位）

---

## 版本对齐

| 模块 | 版本 | 同步源 |
|---|---|---|
| `packages/scene-schema/` | v0.1 | — （单一数据源 · 冻结） |
| `packages/web/` | v0.1 | 与 scene-schema v0.1 同步 |
| `server-php/` | v0.5 | schema 与 scene-schema v0.1 1:1 对齐 |
| 前端打包 (entry) | 122 KB | vendor chunks 拆分（react/gsap/zustand/r3f/three） |
| 前端 gzip | 33 KB | 同上 |

远端部署目录：`/home/wwwroot/ai_video/director_stage/` · VPS `154.36.175.39`

---

## 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 数据源 | Zod + stable JSON | LLM/前端/视频模型同一份 JSON |
| 前端构建 | Vite 5 | 快 · esbuild · HMR 秒级 |
| UI | React 18 | R3F 官方绑定最成熟 |
| 3D | R3F + Three.js | 状态管理天然对接 Zustand |
| 状态 | Zustand | 整个 store 就一个 scene 对象 · JSON SSOT |
| 运镜 | GSAP | CatmullRom + 时间游标 |
| i18n | 自研 dict + dynamic import | zh 静态 + en lazy load（vendor chunks 拆分） |
| 后端 | PHP 8.4 + MySQL 8.0 + Redis 8 | 复用 ai_video 现有栈 |
| 视频模型 | 商业 API 远程调用 | 可灵 / Runway / Luma / Sora |

---

## 已知限制（v0.6）

- ❌ 没有角色动画（pose 只调身高，不放 Mixamo 动画）
- ❌ 没有角色拖拽（只能改属性面板坐标）
- ❌ 没有变换 Gizmo 给角色（只给关键帧相机）
- ❌ 浏览器 MediaRecorder 输出 WebM 不是 MP4（手动 rename 或 ffmpeg 转）
- ❌ 录制期间帧率不稳（MediaRecorder 软编码 · 后续换 WebCodecs）
- 🔜 Agent 助手当前仅 console.info + "开发中"提示（UI shell 就绪，LLM 联调待 v0.7）

---

## 版本

2026-09-30 · v0.6 · 全 UI i18n + vendor chunks 拆分 + 集成文档完成 · 与 ai_video 共享栈子目录部署验证通过。