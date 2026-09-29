import { useState, useRef, useMemo, useEffect } from 'react';
import { useSceneStore } from '../store/scene';
import { exportPixelSize, exportSceneVideo } from '../scene/exporter';
import { readEmbed, uploadEmbedReference } from '../embed';

/**
 * 导出对话框
 *
 * 流程：
 * 1. 用户点 "开始录制"
 * 2. 用 canvas.captureStream + MediaRecorder 录 WebM
 * 3. 提示下载 · 文件名带场景 hash
 *
 * 注意：浏览器原生 MediaRecorder 输出的 WebM · 不是 mp4
 *       用户可以手动 rename 或 ffmpeg 转 · MVP 阶段接受
 */

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const scene = useSceneStore((s) => s.scene);
  const hash = useSceneStore((s) => s.hash);
  const embed = readEmbed().embed && readEmbed().nodeId > 0;
  const [phase, setPhase] = useState<'idle' | 'recording' | 'uploading' | 'done'>('idle');
  const [progress, setProgress] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  // blob → objectURL · 缓存避免每次 render 都创建新 URL
  const videoUrl = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  // 卸载时 revoke 释放
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  const aspectLabel = scene.aspect;
  const px = exportPixelSize(scene.aspect);
  const sizeLabel = `${px.width}×${px.height}`;

  const handleStart = async () => {
    setPhase('recording');
    setProgress(0);
    setError(null);
    setBlob(null);
    cancelRef.current = false;

    try {
      const result = await exportSceneVideo(scene, {
        fps: scene.fps,
        size: sizeLabel,
        onProgress: (p) => setProgress(p),
        shouldCancel: () => cancelRef.current,
      });
      if (cancelRef.current) {
        setPhase('idle');
        return;
      }
      setBlob(result.blob);
      if (embed) {
        setPhase('uploading');
        const up = await uploadEmbedReference(result.blob);
        if (!up.ok) {
          setError(up.error || '写入参考视频失败');
          setPhase('done');
          return;
        }
      }
      setPhase('done');
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'cancelled' || cancelRef.current) {
        setPhase('idle');
        return;
      }
      setError(msg);
      setPhase('idle');
    }
  };

  const handleCancel = () => {
    cancelRef.current = true;
    setPhase('idle');
  };

  const handleDownload = () => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `director-stage-${aspectLabel.replace(':', 'x')}-${hash().slice(0, 6)}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>导出粗略参考视频</h2>
          <button onClick={onClose}>×</button>
        </header>

        <div className="modal-body">
          <Info label="画面比例" value={aspectLabel} />
          <Info label="分辨率" value={sizeLabel} />
          <Info label="帧率" value={`${scene.fps} fps`} />
          <Info label="时长" value={`${scene.duration} 秒 · 硬约束 1-30s`} />
          <Info label="编码" value={embed ? '录制 WebM → 服务器转 MP4' : 'WebM (浏览器原生)'} />

          <div className="warning">
              <strong>注意：</strong>导出的是<strong>粗略参考视频</strong>（颜色形状区分），用于喂给视频模型。
              <br />
              {embed
                ? '录完后会转成 mp4，放进当前节点的视频资产库，并设为加入参考。不会替换正在播放的成片。场景会保存，可再进来改。'
                : '浏览器原生 MediaRecorder 输出 WebM。可下载后自行用 ffmpeg 转成 mp4。'}
            </div>

          {(phase === 'recording' || phase === 'uploading') && (
            <div className="progress">
              <div className="bar" style={{ width: phase === 'uploading' ? '100%' : `${(progress * 100).toFixed(1)}%` }} />
              <span className="mono">{phase === 'uploading' ? '正在转成 mp4 并写入资产库…' : `${(progress * 100).toFixed(1)}%`}</span>
            </div>
          )}

          {error && <div className="error">⚠ {error}</div>}

          {phase === 'done' && blob && videoUrl && (
            <div className="result">
              <video src={videoUrl} controls style={{ width: '100%', borderRadius: 6 }} />
              <div className="meta">
                {(blob.size / 1024).toFixed(1)} KB ·{' '}
                <span className="mono">{blob.type}</span>
              </div>
            </div>
          )}
        </div>

        <footer className="modal-foot">
          {phase === 'idle' && (
            <button className="primary" onClick={handleStart}>
              🎬 开始录制（{scene.duration}s）
            </button>
          )}
          {phase === 'recording' && (
            <button onClick={handleCancel}>取消</button>
          )}
          {phase === 'done' && blob && (
            <>
              <button onClick={() => { setPhase('idle'); setBlob(null); setError(null); }}>重录</button>
              {embed && !error && <span className="mono">已写入节点参考</span>}
              {!embed && <button className="primary" onClick={handleDownload}>下载</button>}
              {embed && error && <button className="primary" onClick={handleDownload}>改以下载 WebM</button>}
            </>
          )}
        </footer>

        <style>{`
          .modal-backdrop {
            position: fixed; inset: 0;
            background: rgba(20, 23, 42, 0.5);
            display: flex; align-items: center; justify-content: center;
            z-index: 1000;
          }
          .modal {
            background: var(--paper);
            border-radius: 12px;
            width: 560px; max-width: 92vw;
            max-height: 90vh; overflow: auto;
            box-shadow: 0 16px 48px rgba(0,0,0,0.2);
          }
          .modal-head {
            display: flex; align-items: center; justify-content: space-between;
            padding: 16px 20px; border-bottom: 1px solid var(--line);
          }
          .modal-head h2 { font-size: 20px; }
          .modal-body { padding: 20px; display: flex; flex-direction: column; gap: 10px; }
          .modal-foot {
            display: flex; gap: 8px; justify-content: flex-end;
            padding: 12px 20px; border-top: 1px solid var(--line);
          }
          .warning {
            background: #fff8e8; border: 1px solid #f0d99a;
            color: #6b5a1f; padding: 10px 12px;
            border-radius: 6px; font-size: 12px; line-height: 1.6;
          }
          .progress {
            display: flex; align-items: center; gap: 8px;
            background: var(--bg); border-radius: 6px; overflow: hidden;
            position: relative; height: 28px;
          }
          .progress .bar { background: var(--primary); height: 100%; transition: width .15s; }
          .progress .mono { position: absolute; right: 10px; font-size: 11px; }
          .result .meta { color: var(--muted); font-size: 11px; margin-top: 4px; }
          .error { color: var(--warn); background: #f3e1de; padding: 8px; border-radius: 6px; }
        `}</style>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8, fontSize: 13 }}>
      <span style={{ color: 'var(--muted)', fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}