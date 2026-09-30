/**
 * 由 SceneJSON + 参考列表生成可嵌入视频提示词的围栏块
 */

import type { SceneJSON } from '@director-stage/scene-schema';

export const DS_PROMPT_BLOCK_START = '<<<DIRECTOR_STAGE_BLOCK>>>';
export const DS_PROMPT_BLOCK_END = '<<<END_DIRECTOR_STAGE_BLOCK>>>';

export interface PromptRef {
  id?: number;
  kind?: string;
  title?: string;
  url?: string;
}

function colorName(hex: string): string {
  const h = String(hex || '').toLowerCase();
  if (h.startsWith('#') && h.length >= 7) return h.slice(0, 7);
  return h || '?';
}

function matchRefToLabel(label: string, refs: PromptRef[]): PromptRef | null {
  const L = label.trim().toLowerCase();
  if (!L) return null;
  let best: PromptRef | null = null;
  let bestScore = 0;
  for (const r of refs) {
    const t = String(r.title || '').trim().toLowerCase();
    if (!t) continue;
    if (t === L) return r;
    if (t.includes(L) || L.includes(t)) {
      const score = Math.min(t.length, L.length);
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
  }
  return best;
}

/** 确定性拼阻塞摘要（不调 LLM） */
export function buildDirectorStagePromptBlock(scene: SceneJSON, refs: PromptRef[] = []): string {
  const size = Array.isArray(scene.scene?.size) ? scene.scene.size : [];
  const envN = Array.isArray(scene.scene?.env) ? scene.scene.env.length : 0;
  const duration = scene.duration || 0;
  const actors = Array.isArray(scene.actors) ? scene.actors : [];
  const kfs = Array.isArray(scene.camera?.keyframes) ? scene.camera.keyframes : [];

  const actorLines = actors.map((a) => {
    const moves = Array.isArray(a.moves) ? a.moves : [];
    let moveHint = '站定';
    if (moves.length) {
      const m = moves[0];
      const to = Array.isArray(m.to) ? m.to : null;
      moveHint = to
        ? `t${m.t0}→t${m.t1} 移至(${to.map((n) => Math.round(Number(n) * 10) / 10).join(',')})`
        : `t${m.t0}→t${m.t1} 走位`;
    }
    return `${a.id}=${a.label}(${colorName(a.color)}) ${moveHint}`;
  });

  const used = new Set<string>();
  const bindLines: string[] = [];
  for (const a of actors) {
    const hit = matchRefToLabel(String(a.label || ''), refs);
    if (hit) {
      const key = String(hit.id || hit.url || hit.title);
      used.add(key);
      const kind = hit.kind === 'image' || hit.kind === 'ref_image' ? '参考图' : (hit.kind === 'video' || hit.kind === 'ref_video' ? '参考视频' : '参考');
      const idPart = hit.id ? ` #${hit.id}` : '';
      bindLines.push(`- ${a.id} ← ${kind}「${hit.title || '未命名'}」${idPart}`);
    }
  }
  for (const r of refs) {
    const key = String(r.id || r.url || r.title);
    if (used.has(key)) continue;
    const kind = r.kind === 'image' || r.kind === 'ref_image' ? '参考图' : (r.kind === 'video' || r.kind === 'ref_video' ? '参考视频' : '参考');
    const idPart = r.id ? ` #${r.id}` : '';
    bindLines.push(`- 场景参考 ← ${kind}「${r.title || '未命名'}」${idPart}`);
  }

  const camBits = kfs.slice(0, 6).map((k) => {
    const look = typeof k.lookAt === 'string' ? `看${k.lookAt}` : '看点';
    return `t${k.t}${look}`;
  });

  const lines = [
    DS_PROMPT_BLOCK_START,
    `【3D阻塞】空间=${size.length ? size.map((n) => Math.round(Number(n) * 10) / 10).join('×') : '?'}；env=${envN}；时长=${duration}s；比例=${scene.aspect || ''}`,
    `【角色】${actorLines.length ? actorLines.join('；') : '(无)'}`,
    '【绑定】',
    ...(bindLines.length ? bindLines : ['- (无参考绑定)']),
    `【相机】${camBits.length ? camBits.join('；') : '(默认)'}`,
    DS_PROMPT_BLOCK_END,
  ];
  let block = lines.join('\n');
  if (block.length > 800) {
    block = block.slice(0, 780) + '\n' + DS_PROMPT_BLOCK_END;
  }
  return block;
}

/** 合并/替换围栏块到原提示词 */
export function mergeDirectorStagePrompt(existing: string, block: string): string {
  const raw = String(existing || '');
  const start = raw.indexOf(DS_PROMPT_BLOCK_START);
  const end = raw.indexOf(DS_PROMPT_BLOCK_END);
  if (start >= 0 && end > start) {
    const before = raw.slice(0, start).replace(/\s+$/, '');
    const after = raw.slice(end + DS_PROMPT_BLOCK_END.length).replace(/^\s+/, '');
    return [before, block, after].filter(Boolean).join('\n\n').trim() + '\n';
  }
  if (!raw.trim()) return block + '\n';
  return raw.replace(/\s+$/, '') + '\n\n' + block + '\n';
}

/** 短 brief 存 meta（去掉围栏标记） */
export function briefFromPromptBlock(block: string): string {
  return String(block || '')
    .replace(DS_PROMPT_BLOCK_START, '')
    .replace(DS_PROMPT_BLOCK_END, '')
    .trim()
    .slice(0, 1800);
}
