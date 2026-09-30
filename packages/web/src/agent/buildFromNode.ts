/**
 * 从节点上下文搭建场景：调用 build_from_node，执行 tool_calls。
 */

import { applyAgentToolCalls, sceneSnapshot, type AgentToolCall } from './applyTools';
import { useSceneStore } from '../store/scene';
import type { SceneJSON } from '@director-stage/scene-schema';

export interface NodeContextPack {
  node_id: number;
  project_id: number;
  title?: string;
  type?: string;
  body?: string;
  gen_prompt_video?: string;
  aspect?: string;
  duration?: number;
  refs?: Array<{ id?: number; kind?: string; title?: string; url?: string }>;
  character_titles?: string[];
}

type DsBoot = {
  user?: { csrf?: string };
  endpoints?: { agent?: string };
};

function csrf(): string {
  return (window as unknown as { __DIRECTOR_STAGE__?: DsBoot }).__DIRECTOR_STAGE__?.user?.csrf || '';
}

function agentUrl(): string {
  return (window as unknown as { __DIRECTOR_STAGE__?: DsBoot }).__DIRECTOR_STAGE__?.endpoints?.agent
    || '/api/director_stage_scene_agent.php';
}

/** 空场景：无演员，且可视为默认模板（用于自动搭建判定） */
export function isEmptyBlockingScene(scene: SceneJSON): boolean {
  if (!scene || !Array.isArray(scene.actors) || scene.actors.length > 0) return false;
  const kfs = scene.camera?.keyframes;
  if (!Array.isArray(kfs) || kfs.length < 2) return true;
  // 有自定义关键帧数很多时不算「空」
  if (kfs.length > 2) return false;
  return true;
}

export interface BuildFromNodeResult {
  ok: boolean;
  error?: string;
  sparse?: boolean;
  summaries?: string[];
  reply?: string;
}

/**
 * 调用后端 build_from_node 并应用返回的 tool_calls（最多再跟一轮 chat 补全）
 */
export async function runBuildFromNode(
  pack: NodeContextPack,
  opts?: { provider?: string; model_id?: string; signal?: AbortSignal },
): Promise<BuildFromNodeResult> {
  const res = await fetch(agentUrl(), {
    method: 'POST',
    credentials: 'same-origin',
    signal: opts?.signal,
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf(),
    },
    body: JSON.stringify({
      action: 'build_from_node',
      pack,
      scene: sceneSnapshot(),
      provider: opts?.provider || '',
      model_id: opts?.model_id || '',
      csrf: csrf(),
    }),
  });
  const data = await res.json().catch(() => null);
  if (!data?.ok) {
    return {
      ok: false,
      error: String(data?.error || `HTTP ${res.status}`),
      sparse: !!data?.sparse,
    };
  }

  const msg = data.message || {};
  const toolCalls = Array.isArray(msg.tool_calls) ? (msg.tool_calls as AgentToolCall[]).filter(Boolean) : [];
  const summaries: string[] = [];
  if (toolCalls.length) {
    const results = applyAgentToolCalls(toolCalls);
    results.forEach((r) => {
      if (r.ok && r.summary) summaries.push('✓ ' + r.summary);
      else if (r.error) summaries.push('✗ ' + (r.name || '?') + ': ' + r.error);
    });
  }

  // 若模型只回了文字没工具，尝试再 chat 一轮催 replace_scene
  if (!toolCalls.length) {
    const follow = await fetch(agentUrl(), {
      method: 'POST',
      credentials: 'same-origin',
      signal: opts?.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf(),
      },
      body: JSON.stringify({
        action: 'chat',
        messages: [
          {
            role: 'user',
            content: '请立即用 replace_scene 输出完整场景，不要只文字描述。',
          },
        ],
        scene: sceneSnapshot(),
        provider: opts?.provider || data.provider || '',
        model_id: opts?.model_id || data.model || '',
        csrf: csrf(),
      }),
    });
    const followData = await follow.json().catch(() => null);
    const fMsg = followData?.message || {};
    const fCalls = Array.isArray(fMsg.tool_calls) ? (fMsg.tool_calls as AgentToolCall[]) : [];
    if (fCalls.length) {
      applyAgentToolCalls(fCalls).forEach((r) => {
        if (r.ok && r.summary) summaries.push('✓ ' + r.summary);
        else if (r.error) summaries.push('✗ ' + (r.name || '?') + ': ' + r.error);
      });
    }
  }

  const actors = useSceneStore.getState().scene.actors?.length || 0;
  const reply = [
    String(msg.content || '').trim(),
    summaries.length ? summaries.join('\n') : '',
    data.sparse ? '（素材偏少，建议补视频提示词后再点「从节点重建」）' : '',
    actors === 0 ? '（尚未生成角色，可手动点「从节点重建」重试）' : `已布置 ${actors} 个角色`,
  ].filter(Boolean).join('\n\n');

  return {
    ok: true,
    sparse: !!data.sparse,
    summaries,
    reply,
  };
}
