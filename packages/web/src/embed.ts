/**
 * 从工作流节点打开导演台：载入该节点的场景、编辑时自动保存、
 * 导出后把参考视频交给父页面写入资产库；空场景可按节点上下文自动搭建。
 */

import type { AspectRatio, SceneJSON } from '@director-stage/scene-schema';
import { useSceneStore } from './store/scene';
import { setLang, type Lang } from './i18n';
import { isEmptyBlockingScene, runBuildFromNode, type NodeContextPack } from './agent/buildFromNode';
import {
  briefFromPromptBlock,
  buildDirectorStagePromptBlock,
} from './lib/promptBlock';

const ASPECTS: AspectRatio[] = ['2.76:1', '2.39:1', '2.00:1', '1.85:1', '16:9', '4:3', '9:16', '1:1'];

export interface DsEmbedState {
  embed: boolean;
  nodeId: number;
  projectId: number;
  sceneId: number;
  aspect: string;
  duration: number;
  nodeTitle?: string;
  building?: boolean;
  lastPack?: NodeContextPack | null;
}

interface DsBoot {
  user?: { csrf?: string };
  endpoints?: { scenes?: string; export?: string; agent?: string };
}

type DsWindow = Window & {
  __DIRECTOR_STAGE__?: DsBoot;
  __DS_EMBED__?: DsEmbedState;
  __DS_EXPORTING__?: boolean;
};

function dsWindow(): DsWindow {
  return window as DsWindow;
}

export function readEmbed(): DsEmbedState {
  const existing = dsWindow().__DS_EMBED__;
  if (existing) return existing;
  const q = new URLSearchParams(location.search);
  return {
    embed: q.get('embed') === '1',
    nodeId: posInt(q.get('node_id')),
    projectId: posInt(q.get('project_id')),
    sceneId: posInt(q.get('scene_id')),
    aspect: q.get('aspect') || '',
    duration: clampDur(q.get('duration')),
  };
}

export function patchEmbed(partial: Partial<DsEmbedState>): DsEmbedState {
  const cur = { ...readEmbed(), ...partial };
  dsWindow().__DS_EMBED__ = cur;
  window.dispatchEvent(new CustomEvent('ds-embed-changed'));
  return cur;
}

function isAspect(v: string): v is AspectRatio {
  return (ASPECTS as string[]).includes(v);
}

function posInt(raw: string | null | number | undefined): number {
  const n = Number(raw || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function clampDur(raw: string | null): number {
  const n = Number(raw || 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(30, Math.round(n)));
}

function csrf(): string {
  return dsWindow().__DIRECTOR_STAGE__?.user?.csrf || '';
}

function scenesUrl(): string {
  return dsWindow().__DIRECTOR_STAGE__?.endpoints?.scenes || '';
}

function exportUrl(): string {
  return dsWindow().__DIRECTOR_STAGE__?.endpoints?.export || '';
}

export function notifyParent(type: string, extra: Record<string, unknown> = {}) {
  if (!window.parent || window.parent === window) return;
  window.parent.postMessage({ source: 'director-stage', type, ...extra }, location.origin);
}

async function fetchNodeScene(nodeId: number): Promise<{ sceneId: number; scene: SceneJSON } | null> {
  const base = scenesUrl();
  if (!base) return null;
  const url = base + (base.includes('?') ? '&' : '?') + 'action=load_node&node_id=' + encodeURIComponent(String(nodeId));
  const res = await fetch(url, { credentials: 'same-origin' });
  const data = await res.json().catch(() => null);
  if (!data || !data.ok || !data.scene) return null;
  const sceneId = Number(data.scene_id || data.scene.id || 0);
  return { sceneId, scene: data.scene as SceneJSON };
}

let saveChain: Promise<void> = Promise.resolve();

export function saveEmbedScene(): Promise<{ ok: boolean; sceneId: number; error?: string; node?: unknown }> {
  const job = saveChain.then(() => saveEmbedSceneNow());
  saveChain = job.then(() => undefined, () => undefined);
  return job;
}

async function saveEmbedSceneNow(): Promise<{ ok: boolean; sceneId: number; error?: string; node?: unknown }> {
  const emb = readEmbed();
  if (!emb.embed || !(emb.nodeId > 0)) {
    return { ok: false, sceneId: 0, error: 'not embed' };
  }
  const url = scenesUrl();
  if (!url) return { ok: false, sceneId: 0, error: '缺少场景接口' };
  const scene = useSceneStore.getState().scene;
  const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'action=save', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf(),
    },
    body: JSON.stringify({
      scene,
      scene_id: emb.sceneId || 0,
      node_id: emb.nodeId,
      project_id: emb.projectId || 0,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!data || !data.ok) {
    const msg = (data && (data.error || (Array.isArray(data.errors) && data.errors[0] && data.errors[0].message))) || '场景保存失败';
    return { ok: false, sceneId: emb.sceneId, error: String(msg) };
  }
  const sceneId = Number(data.scene_id || data.id || 0);
  if (sceneId > 0) patchEmbed({ sceneId });
  return { ok: true, sceneId: sceneId || emb.sceneId, node: data.node };
}

let autosaveArmed = false;

function armAutosave() {
  if (autosaveArmed) return;
  autosaveArmed = true;
  let last = useSceneStore.getState().toJson();
  let timer = 0;
  useSceneStore.subscribe((st) => {
    if (dsWindow().__DS_EXPORTING__) return;
    if (!(readEmbed().nodeId > 0)) return;
    const json = st.toJson();
    if (json === last) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      last = useSceneStore.getState().toJson();
      void saveEmbedScene();
    }, 800);
  });
}

/** 绑定到指定节点并保存当前场景 */
export async function bindAndSaveToNode(opts: {
  nodeId: number;
  projectId?: number;
  sceneId?: number;
  title?: string;
}): Promise<{ ok: boolean; error?: string; sceneId?: number }> {
  const nodeId = posInt(opts.nodeId);
  if (!(nodeId > 0)) return { ok: false, error: '无效节点' };
  patchEmbed({
    embed: true,
    nodeId,
    projectId: posInt(opts.projectId) || readEmbed().projectId,
    sceneId: posInt(opts.sceneId) || 0,
    nodeTitle: opts.title || '',
  });
  armAutosave();
  const saved = await saveEmbedScene();
  if (!saved.ok) {
    return { ok: false, error: saved.error || '保存失败', sceneId: saved.sceneId };
  }
  notifyParent('bound', {
    nodeId,
    projectId: readEmbed().projectId,
    sceneId: saved.sceneId,
    node: saved.node,
  });
  return { ok: true, sceneId: saved.sceneId };
}

export function requestPickSaveNode() {
  notifyParent('pick-save-node');
}

export function requestNodeContext() {
  notifyParent('request-node-context', {
    nodeId: readEmbed().nodeId,
    projectId: readEmbed().projectId,
  });
}

let buildAbort: AbortController | null = null;

export async function applyNodeContextPack(pack: NodeContextPack, opts?: { force?: boolean }): Promise<void> {
  const emb = readEmbed();
  if (!emb.embed || !(emb.nodeId > 0)) return;
  patchEmbed({ lastPack: pack });
  const scene = useSceneStore.getState().scene;
  const empty = isEmptyBlockingScene(scene);
  if (!opts?.force && !empty) return;
  if (emb.building) return;

  buildAbort?.abort();
  buildAbort = new AbortController();
  patchEmbed({ building: true });
  window.dispatchEvent(new CustomEvent('ds-build-status', { detail: { phase: 'start', force: !!opts?.force } }));
  try {
    const r = await runBuildFromNode(pack, { signal: buildAbort.signal });
    if (r.ok) {
      await saveEmbedScene();
    }
    window.dispatchEvent(new CustomEvent('ds-build-status', {
      detail: { phase: 'done', ok: r.ok, reply: r.reply, error: r.error, sparse: r.sparse },
    }));
  } catch (e) {
    const msg = (e as Error).name === 'AbortError' ? '已取消' : ((e as Error).message || '搭建失败');
    window.dispatchEvent(new CustomEvent('ds-build-status', {
      detail: { phase: 'done', ok: false, error: msg },
    }));
  } finally {
    patchEmbed({ building: false });
  }
}

export function cancelBuildFromNode() {
  buildAbort?.abort();
  patchEmbed({ building: false });
}

export function rebuildFromNode() {
  const pack = readEmbed().lastPack;
  if (pack) {
    void applyNodeContextPack(pack, { force: true });
    return;
  }
  requestNodeContext();
  // force flag via one-shot
  (window as unknown as { __DS_FORCE_BUILD__?: boolean }).__DS_FORCE_BUILD__ = true;
}

function bindParentMessages() {
  window.addEventListener('message', (ev) => {
    if (ev.origin !== location.origin) return;
    const data = ev.data;
    if (!data || data.source !== 'ai-video') return;
    if (data.type === 'save-to-node') {
      void bindAndSaveToNode({
        nodeId: Number(data.nodeId) || 0,
        projectId: Number(data.projectId) || 0,
        sceneId: Number(data.sceneId) || 0,
        title: String(data.title || ''),
      });
      return;
    }
    if (data.type === 'save-to-node-cancel') {
      window.dispatchEvent(new CustomEvent('ds-save-pick-cancel'));
      return;
    }
    if (data.type === 'node-context' && data.pack && typeof data.pack === 'object') {
      const force = !!(window as unknown as { __DS_FORCE_BUILD__?: boolean }).__DS_FORCE_BUILD__;
      (window as unknown as { __DS_FORCE_BUILD__?: boolean }).__DS_FORCE_BUILD__ = false;
      void applyNodeContextPack(data.pack as NodeContextPack, { force });
    }
  });
}

export async function bootDirectorStage(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const lang = q.get('lang');
  if (lang === 'zh' || lang === 'en') {
    await setLang(lang as Lang);
  }
  const state: DsEmbedState = {
    embed: q.get('embed') === '1',
    nodeId: posInt(q.get('node_id')),
    projectId: posInt(q.get('project_id')),
    sceneId: posInt(q.get('scene_id')),
    aspect: q.get('aspect') || '',
    duration: clampDur(q.get('duration')),
  };
  dsWindow().__DS_EMBED__ = state;
  bindParentMessages();

  const store = useSceneStore.getState();
  let loaded = false;
  if (state.embed && state.nodeId > 0) {
    try {
      const hit = await fetchNodeScene(state.nodeId);
      if (hit) {
        state.sceneId = hit.sceneId;
        store.setScene(hit.scene);
        store.setPreviewT(0);
        store.setPlaying(false);
        loaded = true;
      }
    } catch (e) {
      console.warn('[director-stage] load scene', e);
    }
  }
  if (!loaded) {
    store.init('room_small');
    store.setDuration(state.duration);
    if (isAspect(state.aspect)) store.setAspect(state.aspect);
  }
  if (state.embed && state.nodeId > 0) armAutosave();

  const empty = isEmptyBlockingScene(useSceneStore.getState().scene);
  notifyParent('ready', {
    nodeId: state.nodeId,
    projectId: state.projectId,
    empty,
    sceneId: state.sceneId,
  });
  // 空场景：向父页要上下文并自动搭建
  if (state.embed && state.nodeId > 0 && empty) {
    requestNodeContext();
  }
}

export interface EmbedExportResult {
  ok: boolean;
  error?: string;
  sceneId?: number;
  item?: { id?: number; url?: string; title?: string };
  node?: unknown;
  replaced_urls?: string[];
  replaced_ids?: number[];
  brief?: string;
  scene?: SceneJSON;
}

export async function uploadEmbedReference(blob: Blob): Promise<EmbedExportResult> {
  const emb = readEmbed();
  const url = exportUrl();
  if (!emb.embed || !(emb.nodeId > 0) || !url) {
    return { ok: false, error: '当前不是从节点进入，改为下载' };
  }
  dsWindow().__DS_EXPORTING__ = true;
  try {
    const saved = await saveEmbedScene();
    if (!saved.ok && saved.error && saved.error !== 'not embed') {
      return { ok: false, error: saved.error, sceneId: saved.sceneId };
    }
    const scene = useSceneStore.getState().scene;
    // refs 由父页回写时再拼绑定表；此处先出无 refs 的 brief 兜底
    const block = buildDirectorStagePromptBlock(scene, []);
    const brief = briefFromPromptBlock(block);

    const fd = new FormData();
    fd.append('file', blob, 'director-stage-ref.webm');
    fd.append('node_id', String(emb.nodeId));
    fd.append('project_id', String(emb.projectId || 0));
    fd.append('scene_id', String(emb.sceneId || saved.sceneId || 0));
    fd.append('scene', useSceneStore.getState().toJson());
    fd.append('brief', brief);
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': csrf() },
      body: fd,
    });
    const data = await res.json().catch(() => null);
    if (!data || !data.ok) {
      return {
        ok: false,
        error: (data && data.error) || '写入参考视频失败',
        sceneId: Number((data && data.scene_id) || emb.sceneId || 0),
      };
    }
    if (Number(data.scene_id) > 0) patchEmbed({ sceneId: Number(data.scene_id) });
    const payload: EmbedExportResult = {
      ok: true,
      sceneId: emb.sceneId,
      item: data.item,
      node: data.node,
      replaced_urls: data.replaced_urls || [],
      replaced_ids: data.replaced_ids || [],
      brief: String(data.brief || brief),
      scene,
    };
    notifyParent('export', {
      nodeId: emb.nodeId,
      projectId: emb.projectId,
      sceneId: emb.sceneId,
      item: data.item,
      node: data.node,
      url: data.url,
      replaced_urls: data.replaced_urls || [],
      replaced_ids: data.replaced_ids || [],
      brief: payload.brief,
      scene,
    });
    return payload;
  } finally {
    dsWindow().__DS_EXPORTING__ = false;
  }
}
