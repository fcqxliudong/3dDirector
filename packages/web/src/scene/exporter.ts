/**
 * 粗略视频导出器
 *
 * 流程：
 * 1. 找 R3F canvas（通过 window.__ds_canvas_wrap__ 引用）
 * 2. canvas.captureStream(fps) 拿 MediaStream
 * 3. MediaRecorder 录 WebM
 * 4. 期间通过时间轴推进相机（模拟运镜）
 * 5. 时长到 → stop() → blob 给用户下载
 *
 * 简化策略：
 * - 不控制 R3F 内部状态（避免耦合）
 * - 通过 setPreviewT + setPlaying 让 store 驱动相机
 * - 浏览器录 canvas 实际帧率可能不稳（MediaRecorder 软编码）
 *   MVP 接受 · 后续可换 WebCodecs VideoEncoder（硬编码）
 */

import type { SceneJSON } from '@director-stage/scene-schema';
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
  const gl = (window as unknown as { __ds_gl__?: ExportGl }).__ds_gl__;
  const prevRatio = gl ? gl.getPixelRatio() : 1;
  const cssW = canvas.clientWidth || px.width;
  const cssH = canvas.clientHeight || px.height;
  if (gl) {
    gl.setPixelRatio(1);
    gl.setSize(px.width, px.height, false);
    await sleep(60);
  }

  try {
    // 1. 拿流
    const fps = opts.fps;
    const stream = canvas.captureStream(fps);

    // 2. MediaRecorder（优先选 video/webm;codecs=vp9，浏览器不支持时回退 vp8）
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 4_000_000, // 4 Mbps · 粗略视频够用
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    // 3. 开始录制
    recorder.start(100); // 100ms 一个 chunk · 避免内存压力

    // 4. 推进时间 · 让 CameraRig.useFrame (playing=true) 自动累加 previewT
    // exporter 只 sleep 等帧过去 · 避免与 CameraRig 同时改 previewT 导致 camera 抖动
    const store = useSceneStore.getState();
    const wasPlaying = store.playing;
    store.setPlaying(true);
    store.setPreviewT(0);

    const duration = scene.duration;
    const frameMs = 1000 / fps;
    const startTime = performance.now();

    try {
      // 等 CameraRig 自己累加 previewT · exporter 只 sleep + 报进度
      while (true) {
        if (opts.shouldCancel?.()) {
          throw new Error('cancelled');
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
    restoreExportSize(gl, prevRatio, cssW, cssH);
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
  gl.setSize(Math.max(1, cssW), Math.max(1, cssH), false);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}