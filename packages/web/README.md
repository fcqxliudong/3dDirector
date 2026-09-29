# @director-stage/web · v0.1

3D 导演台 · Web 前端 · **Vite + React + R3F + Zustand**

---

## 架构

```
┌──────────────────────────────────────────────────┐
│                  Web 浏览器 · 用户接触面          │
├──────────────────────────────────────────────────┤
│ Topbar（JSON / 错误提示 / 导出按钮）               │
├──────────┬───────────────────────┬───────────────┤
│ Sidebar  │  SceneViewer（R3F）   │ Properties     │
│ 场景/比例 │  · Actor 胶囊          │ · 选中物体属性 │
│ 角色列表 │  · Env 几何体          │ · Vec3 编辑器  │
│          │  · CameraRig 运镜      │                │
│          │  · OrbitControls 浏览   │                │
│          ├───────────────────────┤                │
│          │ Timeline（时间轴 + 播放）│                │
└──────────┴───────────────────────┴───────────────┘
```

## 一键开发

```bash
# 在 monorepo 根目录
cd D:\000AI出片\3D导演台
npm install              # 装所有 workspaces
npm run dev              # 起 web Vite dev server
# 打开 http://localhost:5173/
```

## 构建 + 部署到 ai_video

```bash
npm run build:web
# 产物在 packages/web/dist/

# 复制到 ai_video/static/director_stage/
scp -r packages/web/dist/* www@server:/home/wwwroot/ai_video/static/director_stage/
```

## 关键技术决策

| 维度 | 决策 | 理由 |
|---|---|---|
| **构建工具** | Vite 5 | 快 · esbuild 预编译 · HMR 秒级 |
| **UI 框架** | React 18 | R3F 官方绑定最成熟 |
| **3D** | R3F + Three.js | 状态管理天然对接 Zustand |
| **状态** | Zustand | 整个 store 就一个 scene 对象 · JSON SSOT |
| **样式** | 原生 CSS（无 Tailwind） | 简单 · 不引入额外依赖 |
| **导出** | canvas.captureStream + MediaRecorder → WebM | 浏览器原生 · 零依赖 |
| **路由** | 无（单页应用） | director_stage 没有多路由需求 |

## 已知限制（v0.1）

- ❌ 没有角色动画（pose 只调身高，不放 Mixamo 动画）
- ❌ 没有角色拖拽（只能改属性面板坐标）
- ❌ 没有变换 Gizmo 给角色（只给关键帧相机）
- ❌ 浏览器 MediaRecorder 输出 WebM 不是 MP4（手动 rename 或 ffmpeg 转）
- ❌ 录制期间帧率不稳（MediaRecorder 软编码 · 后续换 WebCodecs）

## 文件结构

```
packages/web/
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── index.html                       Vite 入口
├── src/
│   ├── main.tsx                     React mount
│   ├── App.tsx                      顶层布局
│   ├── styles.css                   全局样式
│   ├── store/
│   │   └── scene.ts                 Zustand · JSON SSOT
│   ├── scene/
│   │   ├── SceneViewer.tsx          R3F Canvas 容器
│   │   ├── ActorMesh.tsx            单个角色（胶囊）
│   │   ├── EnvMesh.tsx              环境几何体（5 预设）
│   │   ├── CameraRig.tsx            相机运镜（CatmullRom + 关键帧球）
│   │   └── exporter.ts              WebM 录制器
│   ├── panels/
│   │   ├── Topbar.tsx               JSON / 错误 / 导出按钮
│   │   ├── Sidebar.tsx              场景/比例/角色
│   │   ├── PropertiesPanel.tsx      选中物体属性
│   │   ├── Timeline.tsx             时间轴 + 播放
│   │   └── ExportDialog.tsx         导出弹窗
│   └── ...
└── README.md
```

## 完整工作流（用户视角）

1. 打开 `/ai_video/director_stage/` → 看到默认小房间 + 两个 camera
3. 左侧 Sidebar → 选预设 / 改比例 / 拖时长滑杆 / 加角色
4. 3D 视口 → 拖动 / 缩放 / 旋转视角（OrbitControls）
5. 点角色 → 右侧 Properties 编辑属性
6. 点关键帧小球 → 右侧 Properties 编辑相机参数
7. 底部 Timeline → ▶ 播放 / 添加关键帧 / 拖时间头
8. 顶部"导出参考视频" → 录 5-10s 粗略 mp4（WebM）
9. 后期手动喂给可灵 / 海螺 → 出最终视频

## 版本

2026-09-29 · v0.1 · 与 packages/scene-schema v0.1 同步 · 与 server-php v0.5 同步。