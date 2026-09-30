/**
 * 粗略视频导出器
 *
 * 流程：
 * 1. 找 R3F canvas（通过 window.__ds_canvas_wrap__ 引用）
 * 2. 按导出像素锁定 gl 缓冲 + camera.aspect（避免 9:16 等竖屏被 CSS 横屏宽高比拉变形）
 * 3. canvas.captureStream(fps) 拿 MediaStream
 * 4. MediaRecorder 录 WebM
 * 5. 期间通过时间轴推进相机（模拟运镜）
 * 6. 时长到 → stop() → blob 给用户下载
 */

import type { SceneJSON } from '@director-stage/scene-schema';
import type { PerspectiveCamera } from 'three';
import { useSceneStore } from '../store/scene';

interface ExportOptions {
  fps: number;
  size: string; // "1280x720"
  onProgress?: (ratio: number) => void; // 0~1
  shouldCancel?: () => boolean;
}

interface ExportResult {
  blob: Blob;
  duration: number;
  type: string;
}

/** 导出像素尺寸。短边约 720，宽高都取偶数，方便 ffmpeg / H.264。 */
export function exportPixelSize(aspect: string): { width: number; height: number } {
  const table: Record<string, [number, number]> = {
    '9:16': [720, 1280],
    '1:1': [720, 720],
    '4:3': [960, 720],
    '16:9': [1280, 720],
    '1.85:1': [1280, 692],
    '2.00:1': [1280, 640],
    '2.39:1': [1280, 536],
    '2.76:1': [1280, 464],
  };
  const pair = table[aspect] || [1280, 720];
  return { width: pair[0], height: pair[1] };
}

type ExportGl = {
  getPixelRatio: () => number;
  setPixelRatio: (n: number) => void;
  setSize: (w: number, h: number, updateStyle?: boolean) => void;
  domElement: HTMLCanvasElement;
};

type ExportWindow = {
  __ds_gl__?: ExportGl;
  __ds_camera__?: PerspectiveCamera;
  __DS_EXPORTING__?: boolean;
  __DS_EXPORT_PX__?: { width: number; height: number };
};

/**
 * 主入口
 *
 * 录制期间会自动：
 * - 临时把 OrbitControls 禁用（避免相机抖动）
 * - 推进时间 t 让相机沿 keyframes 移动
 * - 录完后恢复 OrbitControls
 */
export async function exportSceneVideo(
  scene: SceneJSON,
  opts: ExportOptions,
): Promise<ExportResult> {
  const canvasWrap = (window as unknown as { __ds_canvas_wrap__: HTMLDivElement | null }).__ds_canvas_wrap__;
  if (!canvasWrap) {
    throw new Error('找不到 R3F canvas · 请确认 SceneViewer 已挂载');
  }
  const canvas = canvasWrap.querySelector('canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error('canvas DOM 未找到');
  }

  const px = exportPixelSize(scene.aspect);
  const w = window as unknown as ExportWindow;
  const gl = w.__ds_gl__;
  const camera = w.__ds_camera__;
  const prevRatio = gl ? gl.getPixelRatio() : 1;
  const cssW = canvas.clientWidth || px.width;
  const cssH = canvas.clientHeight || px.height;
  const prevAspect = camera?.aspect;
  const prevCssW = canvas.style.width;
  const prevCssH = canvas.style.height;

  // 锁定导出宽高比：缓冲像素 + CSS 显示尺寸 + 相机 projection 三者一致
  w.__DS_EXPORTING__ = true;
  w.__DS_EXPORT_PX__ = { width: px.width, height: px.height };

  if (gl) {
    gl.setPixelRatio(1);
    // updateStyle=true：让 canvas CSS 也变成导出分辨率，避免 R3F resize 用旧横屏 client 尺寸覆盖 aspect
    gl.setSize(px.width, px.height, true);
  }
  if (camera) {
    camera.aspect = px.width / px.height;
    camera.updateProjectionMatrix();
  }
  await sleep(80);

  try {
    const fps = opts.fps;
    const stream = canvas.captureStream(fps);

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 4_000_000,
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    recorder.start(100);

    const store = useSceneStore.getState();
    const wasPlaying = store.playing;
    store.setPlaying(true);
    store.setPreviewT(0);

    const duration = scene.duration;
    const frameMs = 1000 / fps;
    const startTime = performance.now();

    try {
      while (true) {
        if (opts.shouldCancel?.()) {
          throw new Error('cancelled');
        }
        // 每帧再锁一次 aspect，防止 R3F resize 中途改回
        if (camera) {
          const next = px.width / px.height;
          if (Math.abs(camera.aspect - next) > 0.0001) {
            camera.aspect = next;
            camera.updateProjectionMatrix();
          }
        }
        const elapsed = (performance.now() - startTime) / 1000;
        const progress = Math.min(elapsed / duration, 1);
        opts.onProgress?.(progress);
        if (elapsed >= duration) break;
        await sleep(frameMs);
      }
    } finally {
      if (recorder.state !== 'inactive') recorder.stop();
      stream.getTracks().forEach((t) => t.stop());
      store.setPlaying(wasPlaying);
    }

    await stopped;

    const blob = new Blob(chunks, { type: mimeType });
    return {
      blob,
      duration,
      type: mimeType,
    };
  } finally {
    w.__DS_EXPORTING__ = false;
    w.__DS_EXPORT_PX__ = undefined;
    if (camera && prevAspect != null) {
      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();
    }
    canvas.style.width = prevCssW;
    canvas.style.height = prevCssH;
    restoreExportSize(gl, prevRatio, cssW, cssH);
    // 让 letterbox / R3F 按当前视口重算
    window.dispatchEvent(new Event('resize'));
  }
}

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'video/webm';
}

function restoreExportSize(gl: ExportGl | undefined, ratio: number, cssW: number, cssH: number) {
  if (!gl) return;
  gl.setPixelRatio(ratio || 1);
  gl.setSize(Math.max(1, cssW), Math.max(1, cssH), true);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
