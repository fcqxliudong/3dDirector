# @director-stage/scene-schema · v0.1

3D 导演台的 **单一数据源（SSOT）** · 所有模块都读写这个 JSON。

---

## 是什么

把策划 001 草案 + v2/v3 蓝图里的产品决策落地为可校验的 JSON Schema。冻结 v0.1 后：

- LLM 只输出这个 schema 约束的 JSON
- 3D 视口只读这个 JSON
- 导演微调只改这个 JSON
- 视频模型只通过这个 JSON 派生 prompt
- 版本控制（diff-match-patch）以这个 JSON 为单位

## 关键设计

### 1. 时长 1-30s · **硬约束**
```ts
DURATION_MIN = 1
DURATION_MAX = 30  // 硬约束 · 不做超 30s 拼接
```
商业 API 单次生成上限 30s，超出直接报错。

### 2. 8 个画面比例
| 比例 | 标签 | 用途 |
|---|---|---|
| `2.76:1` | Ultra Panavision 70 | 早期 70mm（《阿拉伯的劳伦斯》） |
| `2.39:1` | Scope / Anamorphic | 现代电影主流（**默认**） |
| `2.00:1` | IMAX 增强 | IMAX 数字 / Netflix 顶级 |
| `1.85:1` | Flat | 北美院线标准 |
| `16:9` | HDTV | 流媒体主流 |
| `4:3` | Academy | 早期学院 / Wes Anderson |
| `9:16` | 竖屏 | 短视频 / 移动 |
| `1:1` | 方形 | 社交方形 |

### 3. LookAt 支持 actor.id 引用
```json
"camera": {
  "keyframes": [
    { "t": 0, "pos": [0, 1.6, 6], "lookAt": "A" },   // ← 引用 A
    { "t": 4, "pos": [0, 1.5, 3], "lookAt": [0, 1.5, 0] }  // ← 原始坐标
  ]
}
```
Zod 校验会自动检查 `lookAt` 引用的 actor.id 必须存在。

### 4. 6 个 Actor Pose
`stand` / `walk` / `run` / `sit` / `crouch` / `idle` —— 配合 Mixamo 通用动画。

### 5. 6 个运镜模板
`push_in` / `pull_out` / `orbit` / `crane_up` / `tracking` / `static`

### 6. 5 个场景预设
`room_small` / `corridor` / `street` / `forest` / `space`

---

## 用法

### 安装
```bash
cd packages/scene-schema
npm install
npm run build      # 编译到 dist/
```

### 在 Web 端用
```ts
import {
  SceneJSONSchema,
  emptyScene,
  safeParseScene,
  stableStringify,
  ASPECT_RATIO_INFO,
  type SceneJSON,
} from '@director-stage/scene-schema';

// 1. 创建空场景
const scene = emptyScene('corridor');

// 2. 校验外部 JSON（来自 LLM / 上传）
const result = safeParseScene(llmOutput);
if (!result.ok) {
  console.error(result.error.issues);  // ZodError 详细报错
  return;
}

// 3. 哈希 / diff（用 stableStringify）
const hash = sha256(stableStringify(scene));
```

### 在 Agent 里用
```ts
import { zodToJsonSchema } from 'some-lib';
import { SceneJSONSchema } from '@director-stage/scene-schema';

// 把 Zod schema 转成 JSON Schema，喂给 GPT-4o 的 function calling
const jsonSchema = zodToJsonSchema(SceneJSONSchema);
```

---

## 文件结构

```
packages/scene-schema/
├── package.json
├── tsconfig.json
├── src/
│   ├── constants.ts    # 枚举常量（8 比例 / 6 pose / 6 运镜 / 5 场景）
│   ├── types.ts        # TypeScript 类型
│   ├── schema.ts       # Zod 校验（核心）
│   ├── defaults.ts     # emptyScene() / makeActor() 工厂
│   ├── utils.ts        # parseScene / safeParseScene / stableStringify
│   └── index.ts        # 统一导出
├── examples/
│   ├── room-small.json # 示例 1（双角色）
│   └── corridor.json   # 示例 2（推镜头无角色）
└── README.md
```

---

## 校验硬约束清单

Zod schema 自动校验的项：

- [x] `version` 必须是 `"0.1"`
- [x] `duration` 在 `[1, 30]`（**硬约束**）
- [x] `fps` ∈ `{24, 30, 60}`
- [x] `aspect` ∈ 8 个合法值
- [x] `actor.id` 全局唯一
- [x] `actor.color` 是合法 HEX `#RRGGBB`
- [x] `actor.moves` 内 `t0 < t1`
- [x] `actor.moves` 不时间重叠
- [x] `camera.fov` 在 `[10, 120]`
- [x] `camera.keyframes` 至少 2 个、单调非递减
- [x] `camera.lookAt` 引用的 actor.id 必须存在
- [x] `camera.keyframes[].t` 不能超过 `duration`
- [x] `scene.size` 三维都 > 0
- [x] `actors` 数量 ≤ 10

## v0.2 候选变更

- 加 `camera_moves` 模板引用（不再只有 keyframes，加 template + params）
- 加 `lighting` 字段（环境光 / 主光 / 阴影）
- 加 `effects` 字段（bloom / vignette / color grading）
- 加 `audio` 字段（背景音乐 / 音效时间轴）
- 关注点分离：`actors` 拆成 `characters` + `props`（人 vs 物）

变更 v0.2 时必须：
- 在 `constants.ts` 升 `SCHEMA_VERSION`
- 在 `defaults.ts` 加 `migrate_0_1_to_0_2()` 函数
- 在 `examples/` 保留 v0.1 旧格式示例
- 更新 README 顶部"关键设计"清单

---

## 锁定版本

2026-09-29 · v0.1 · 冻结。