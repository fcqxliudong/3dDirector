/**
 * Sanity check · 端到端验证所有硬约束
 *
 * 跑法：npx tsx src/sanity-check.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  emptyScene,
  safeParseScene,
  ASPECT_RATIOS,
  DURATION_MIN,
  DURATION_MAX,
} from './index.js';

let pass = 0;
let fail = 0;

function ok(name: string) {
  console.log(`  ✅ ${name}`);
  pass++;
}
function bad(name: string, info: unknown) {
  console.log(`  ❌ ${name}`);
  if (info) console.log(`     ${JSON.stringify(info).slice(0, 200)}`);
  fail++;
}

function expectSuccess(name: string, json: unknown) {
  const r = safeParseScene(json);
  if (r.ok) ok(name);
  else bad(name, r.error.issues.slice(0, 2));
}

function expectFailure(name: string, json: unknown) {
  const r = safeParseScene(json);
  if (!r.ok) ok(name);
  else bad(name, '意外通过了校验');
}

// ─── 1. 真实示例文件 ──────────────────────────────────
console.log('\n[1] 加载 examples/*.json');

const room = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'examples', 'room-small.json'), 'utf8'),
);
expectSuccess('examples/room-small.json 合法', room);

const corridor = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'examples', 'corridor.json'), 'utf8'),
);
expectSuccess('examples/corridor.json 合法', corridor);

// ─── 2. 工厂函数 ──────────────────────────────────────
console.log('\n[2] emptyScene() 工厂函数');

for (const preset of ['open', 'room_small', 'corridor', 'street', 'forest', 'space'] as const) {
  const s = emptyScene(preset);
  expectSuccess(`emptyScene("${preset}") 合法`, s);
}

// 公共 base：默认 emptyScene()（duration=10, keyframes t ∈ [0, 10]）
const base = emptyScene();

// ─── 3. 硬约束：duration 1-30s ─────────────────────────
console.log('\n[3] duration 硬约束 1-30s');

// helper：构造一个 keyframes 都在 [0, d] 内的合法场景
function withDuration(d: number): unknown {
  const s = emptyScene();
  s.duration = d;
  s.camera.keyframes = s.camera.keyframes.map((kf) => ({
    ...kf,
    t: Math.min(kf.t, d),
  }));
  return s;
}

expectSuccess('duration=1 (下限)', withDuration(DURATION_MIN));
expectSuccess('duration=30 (上限)', withDuration(DURATION_MAX));
expectFailure('duration=0 (低于下限)', withDuration(0));
expectFailure('duration=31 (高于上限)', withDuration(31));
expectFailure('duration=0.5 (非整数)', withDuration(0.5));

// ─── 4. 硬约束：8 个合法 aspect ────────────────────────
console.log('\n[4] aspect 8 个枚举');

for (const a of ASPECT_RATIOS) {
  expectSuccess(`aspect="${a}" 合法`, { ...base, aspect: a });
}
expectFailure('aspect="21:9" (不在枚举)', { ...base, aspect: '21:9' });
expectFailure('aspect="2.4:1" (近似但不精确)', { ...base, aspect: '2.4:1' });
expectFailure('aspect="2.39" (缺冒号)', { ...base, aspect: '2.39' });

// ─── 5. fps 必须是 24/30/60 ────────────────────────────
console.log('\n[5] fps 枚举');
expectFailure('fps=25', { ...base, fps: 25 });
expectFailure('fps="24"', { ...base, fps: '24' });

// ─── 6. actor.id 唯一性 ────────────────────────────────
console.log('\n[6] actor.id 唯一性');

expectFailure(
  '重复 actor.id',
  {
    ...base,
    actors: [
      { id: 'A', label: 'x', color: '#000000', start: [0, 0, 0], pose: 'stand' },
      { id: 'A', label: 'y', color: '#ffffff', start: [1, 0, 0], pose: 'stand' },
    ],
  },
);

// ─── 7. camera.lookAt 必须引用存在的 actor ─────────────
console.log('\n[7] camera.lookAt 引用校验');

expectFailure(
  'lookAt 引用不存在的 actor',
  {
    ...base,
    camera: {
      fov: 35,
      keyframes: [
        { t: 0, pos: [0, 1, 0], lookAt: 'Z' },
        { t: 1, pos: [0, 1, 1], lookAt: [0, 1, 0] },
      ],
    },
  },
);

// ─── 8. actor.moves 时间不重叠 ─────────────────────────
console.log('\n[8] actor.moves 时间约束');

expectFailure(
  'moves 时间重叠',
  {
    ...base,
    actors: [
      {
        id: 'A',
        label: 'x',
        color: '#000000',
        start: [0, 0, 0],
        pose: 'stand',
        moves: [
          { to: [1, 0, 0], t0: 0, t1: 3, pose: 'walk' },
          { to: [2, 0, 0], t0: 2, t1: 5, pose: 'walk' }, // 重叠
        ],
      },
    ],
  },
);

expectFailure(
  'moves.t0 >= t1',
  {
    ...base,
    actors: [
      {
        id: 'A',
        label: 'x',
        color: '#000000',
        start: [0, 0, 0],
        pose: 'stand',
        moves: [{ to: [1, 0, 0], t0: 3, t1: 3, pose: 'walk' }],
      },
    ],
  },
);

// ─── 9. color 必须是合法 HEX ──────────────────────────
console.log('\n[9] color HEX 校验');

expectFailure(
  'color 不是 HEX',
  {
    ...base,
    actors: [
      { id: 'A', label: 'x', color: 'red', start: [0, 0, 0], pose: 'stand' },
    ],
  },
);

expectFailure(
  'color 是 #fff (3 位简写)',
  {
    ...base,
    actors: [
      { id: 'A', label: 'x', color: '#fff', start: [0, 0, 0], pose: 'stand' },
    ],
  },
);

// ─── 10. camera.keyframes 至少 2 个 ────────────────────
console.log('\n[10] camera.keyframes 至少 2 个');

expectFailure(
  '只有 1 个关键帧',
  {
    ...base,
    camera: {
      fov: 35,
      keyframes: [{ t: 0, pos: [0, 1, 0], lookAt: [0, 1, 0] }],
    },
  },
);

// ─── 11. camera.keyframes 时间不能超过 duration ────────
console.log('\n[11] camera.keyframes 时间约束');

expectFailure(
  'keyframe.t > duration',
  {
    ...base,
    duration: 10,
    camera: {
      fov: 35,
      keyframes: [
        { t: 0, pos: [0, 1, 0], lookAt: [0, 1, 0] },
        { t: 11, pos: [0, 1, 1], lookAt: [0, 1, 0] }, // 超过 duration=10
      ],
    },
  },
);

// ─── 总结 ─────────────────────────────────────────────
console.log('\n' + '─'.repeat(40));
console.log(`✅ 通过: ${pass}    ❌ 失败: ${fail}`);

if (fail > 0) {
  process.exit(1);
}