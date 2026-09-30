import { useCallback, useEffect, useRef, useState } from 'react';
import { useSceneStore } from '../store/scene';
import { useT } from '../i18n';

/**
 * 底部时间轴 + 关键帧编辑器
 *
 * 交互：
 * - 点击 track 任意位置 → 跳到那个时间点（所见即所得）
 * - 鼠标按住 playhead 或 track 拖动 → 持续更新时间点
 * - 鼠标 hover 在 track 上 → 显示 ghost 指针提示
 * - 播放 → playhead 实时移动
 * - 滚轮（垂直）→ 横向 pan（zoom > 1 时）
 * - Ctrl/Cmd + 滚轮 → 缩放
 * - 上方 + / − 按钮 → 缩放
 *
 * 设计原则（给非 3D 用户）：
 * - playhead 始终可见（不播放也显示当前位置指针）
 * - 拖动行为跟视频编辑器进度条一致
 * - 时间数字大字号、易读
 */

/** 1 秒在 track 上占多少像素（zoom=1 时） */
const BASE_PX_PER_SECOND = 50;
/** 默认 zoom 让 30s 场景填满 ~1500px（容器 ~600px → 默认需要 pan） */
const DEFAULT_ZOOM = 1;
/** 每个 Actor 关键帧轨道的垂直高度（camera 轨道固定 40px，actor 轨道 24px 一行） */
const ACTOR_TRACK_HEIGHT = 24;
/** Camera 关键帧轨道的垂直高度 */
const CAMERA_TRACK_HEIGHT = 40;

/**
 * 视角操作按钮组（📐 调整视角 / 📷 保存当前视角 + ✕）
 *
 * 之前是浮动在 Canvas 右下角（参见 CaptureViewOverlay · 已废弃）·
 * 挪到 Timeline 顶栏右侧空白处，跟 [▶播放 / ⏮重置 / 时间编辑 / 缩放] 形成完整的"关键帧工作流"。
 *
 * freeViewMode = false（默认 · 所见即所得）：
 *   显示 "📐 调整视角" 按钮 · 点击进入自由模式
 * freeViewMode = true（自由模式）：
 *   显示 "📷 保存当前视角" 按钮 · 点击存视角 + 自动退出自由模式 + "✕" 取消
 *
 * 调用 SceneViewer 通过 window.__ds_capture_view__() 触发 capture 函数
 * （capture 函数会用 querySelector('.view-capture .capture-btn') 给按钮加 flashed 动画）
 */
function ViewCaptureButtons() {
  const previewT = useSceneStore((s) => s.previewT);
  const freeViewMode = useSceneStore((s) => s.freeViewMode);
  const setFreeViewMode = useSceneStore((s) => s.setFreeViewMode);
  const t = useT();
  return (
    <div className={`view-capture${freeViewMode ? ' free' : ''}`}>
      {freeViewMode ? (
        <>
          <button
            className="capture-btn save"
            onClick={() => {
              const fn = (window as unknown as { __ds_capture_view__?: () => boolean }).__ds_capture_view__;
              if (fn) fn();
              // setFreeViewMode(false) 已在 capture 函数里调了
            }}
            title={t('scene.saveViewTitle')}
          >
            {t('scene.saveView')}
          </button>
          <button
            className="cancel-btn"
            onClick={() => setFreeViewMode(false)}
            title={t('scene.cancelTitle')}
          >
            {t('scene.cancel')}
          </button>
        </>
      ) : (
        <button
          className="capture-btn"
          onClick={() => setFreeViewMode(true)}
          title={t('scene.adjustViewTitle')}
        >
          {t('scene.adjustView')}
        </button>
      )}
      <span className="capture-meta">{t('scene.t', { t: previewT.toFixed(2) })}</span>
    </div>
  );
}

export function Timeline() {
  const scene = useSceneStore((s) => s.scene);
  const previewT = useSceneStore((s) => s.previewT);
  const playing = useSceneStore((s) => s.playing);
  const setPreviewT = useSceneStore((s) => s.setPreviewT);
  const setPlaying = useSceneStore((s) => s.setPlaying);
  const setDuration = useSceneStore((s) => s.setDuration);
  const removeKeyframe = useSceneStore((s) => s.removeKeyframe);
  const updateKeyframe = useSceneStore((s) => s.updateKeyframe);
  const selectedId = useSceneStore((s) => s.selectedId);
  const select = useSceneStore((s) => s.select);
  const removeActorKeyframe = useSceneStore((s) => s.removeActorKeyframe);
  const t = useT();

  // 拖动状态
  const trackRef = useRef<HTMLDivElement | null>(null);
  const trackWrapRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverT, setHoverT] = useState<number | null>(null);

  // 缩放状态（1 = 默认 · 0.5 ~ 10 = 范围）
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  /**
   * 用户是否手动调过 zoom
   * - false（默认）：auto-fit · 让 track-rail 刚好填满 wrap · 所有关键帧可见
   * - true：用户手动 zoom · 不再 auto-fit
   * 点 ⤢ 还原按钮会重置为 false
   */
  const [userZoomed, setUserZoomed] = useState(false);

  // 关键帧拖动状态（独立于 track-rail 拖动）
  const dragKfRef = useRef<{
    idx: number;
    pointerId: number;
    startX: number;
    startT: number;
    moved: boolean;
  } | null>(null);
  /** 拖动结束后下一个 click 应当被吞掉（避免误触发选中/跳转）*/
  const suppressClickRef = useRef(false);

  /** 把鼠标 clientX 转成 previewT（按 track-rail 实际宽度） */
  const clientXToT = useCallback(
    (clientX: number): number => {
      const rail = trackRef.current;
      if (!rail) return previewT;
      const rect = rail.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * scene.duration;
    },
    [previewT, scene.duration],
  );

  /** 鼠标按下：开始拖动 · 同时跳到该点 */
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 关键帧圆点有自己的 onClick handler · 不冒泡到 track
    // 这里只处理 track-rail 空白区
    if ((e.target as HTMLElement).closest('.kf-dot')) return;
    e.preventDefault();
    setDragging(true);
    setPreviewT(clientXToT(e.clientX));
    trackRef.current?.setPointerCapture(e.pointerId);
  };

  /** 拖动中：持续更新 previewT */
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging) {
      setPreviewT(clientXToT(e.clientX));
    } else {
      // 仅显示 ghost · 不写 store
      setHoverT(clientXToT(e.clientX));
    }
  };

  /** 鼠标松开：结束拖动 */
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging) {
      setDragging(false);
      trackRef.current?.releasePointerCapture(e.pointerId);
    }
  };

  /** 鼠标离开：清掉 ghost */
  const handlePointerLeave = () => {
    setHoverT(null);
  };

  /**
   * 滚轮 pan + Ctrl/Cmd + 滚轮缩放
   * 注意：滚轮缩放 = 用户主动行为 → 设 userZoomed=true（不再被 auto-fit 覆盖）
   */
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setUserZoomed(true);
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      setZoom((z) => Math.max(0.5, Math.min(10, z * factor)));
    } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      const wrap = trackWrapRef.current;
      if (wrap) wrap.scrollLeft += e.deltaY;
    }
  };

  /**
   * 计算让 track-rail 填满 wrap 的 zoom 值
   *
   * 公式：fitZoom = (wrap.clientWidth - KF_DOT_BUFFER * 2) / (duration * BASE_PX_PER_SECOND)
   *
   * 为什么扣 KF_DOT_BUFFER * 2 (左右各 14px)：
   * - 圆点宽 22px · 半径 11
   * - wrap 已经 padding-left/right 14px · 但 rail 占满 content-box
   * - 末尾圆点 center 在 rail width 处 · 圆点右边缘 = wrap 右 - 3px
   * - 还要再扣 14*2 = 28 让末尾圆点完全在 wrap 内（再缩 25px · 圆点右边缘到 wrap 右 = 28px）
   */
  const computeFitZoom = useCallback((): number => {
    const wrap = trackWrapRef.current;
    if (!wrap) return DEFAULT_ZOOM;
    const KF_DOT_BUFFER = 14;
    const fit = (wrap.clientWidth - KF_DOT_BUFFER * 2) / (scene.duration * BASE_PX_PER_SECOND);
    return Math.max(0.2, Math.min(10, fit));
  }, [scene.duration]);

  /** 缩放按钮 · 标记为用户主动 → 不再被 auto-fit 覆盖 */
  const zoomIn = () => {
    setUserZoomed(true);
    setZoom((z) => Math.max(0.5, Math.min(10, z * 1.5)));
  };
  const zoomOut = () => {
    setUserZoomed(true);
    setZoom((z) => Math.max(0.5, Math.min(10, z / 1.5)));
  };
  /** ⤢ 还原 = auto-fit · 重置 userZoomed=false · scrollLeft=0 */
  const zoomFit = () => {
    setUserZoomed(false);
    setZoom(computeFitZoom());
    if (trackWrapRef.current) trackWrapRef.current.scrollLeft = 0;
  };

  /**
   * auto-fit zoom · 让 track-rail 刚好填满 wrap 宽度
   *
   * 关键：用 ResizeObserver 监听 wrap 实际尺寸（不是依赖 RAF / window.resize）
   * - RAF 时 wrap.clientWidth 可能还是 0（layout 未完成）· fitZoom = 0 → clamp 到 0.5 → 错误结果
   * - window.resize 不覆盖 sidebar 收折 / canvas 拖拽等局部 resize
   * - ResizeObserver 在 wrap 真正有尺寸变化时触发 · 永远拿到最新 clientWidth
   *
   * 触发条件：userZoomed === false（用户没主动 zoom 过）
   * - scene.duration 变化 → computeFitZoom 引用变 → effect 重跑 → 重新 observe
   * - userZoomed 从 false → true → 取消 observe（用户接管）
   * - userZoomed 从 true → false（点 ⤢）→ 重新 observe
   */
  useEffect(() => {
    const wrap = trackWrapRef.current;
    if (!wrap) return;
    if (userZoomed) return;
    const fitNow = () => setZoom(computeFitZoom());
    fitNow(); // 立即跑一次（mount 时 wrap 已有 clientWidth）
    const ro = new ResizeObserver(fitNow);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [userZoomed, computeFitZoom]);

  // 注:已删除 viewRange state + handleScroll(view-range 标签去掉了,scroll listener 不再需要)
  //   playhead 自动居中的 useEffect 见下方

  /**
   * playhead 始终可见：
   * - zoom 变化时 · 自动滚到当前 previewT 时刻（让 playhead 落在视口中央）
   * - previewT 越界（拖 playhead 到边缘）→ 平滑滚过去让它留在视口里
   *
   * 这样不管 zoom 多少倍，导演永远不会"丢失" playhead
   */
  useEffect(() => {
    const wrap = trackWrapRef.current;
    const rail = trackRef.current;
    if (!wrap || !rail) return;
    const railWidth = rail.scrollWidth;
    const wrapWidth = wrap.clientWidth;
    if (railWidth <= wrapWidth) {
      // track 不超宽 · 直接重置滚动
      wrap.scrollLeft = 0;
      return;
    }
    // 让 previewT 时刻对应的 X 坐标落在视口中央
    const targetX = (previewT / scene.duration) * railWidth;
    const desiredScroll = Math.max(0, Math.min(railWidth - wrapWidth, targetX - wrapWidth / 2));
    wrap.scrollLeft = desiredScroll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, scene.duration, previewT]);

  return (
    <div className="timeline">
      <div className="timeline-controls">
        <button className={playing ? 'primary' : ''} onClick={() => setPlaying(!playing)}>
          {playing ? t('timeline.pause') : t('timeline.play')}
        </button>
        <button onClick={() => setPreviewT(0)}>{t('timeline.reset')}</button>
        <span className="time-display mono">
          <span className="time-big">{previewT.toFixed(2)}</span>
          <span className="time-unit">s</span>
          <span className="time-total"> / </span>
          <button
            className="dur-btn"
            onClick={() => setDuration(Math.max(1, scene.duration - 1))}
            title="Duration -1s"
          >−</button>
          <input
            className="dur-input"
            type="number"
            min={1}
            max={30}
            step={1}
            value={scene.duration}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v)) setDuration(v);
            }}
          />
          <button
            className="dur-btn"
            onClick={() => setDuration(Math.min(30, scene.duration + 1))}
            title="Duration +1s"
          >+</button>
          <span className="time-unit">s</span>
        </span>
        <div className="zoom-controls">
          <button onClick={zoomOut} title={t('timeline.zoomOut')}>−</button>
          <span className="zoom-display mono" title="Current zoom">{zoom.toFixed(1)}×</span>
          <button onClick={zoomIn} title={t('timeline.zoomIn')}>+</button>
          <button onClick={zoomFit} title={t('timeline.zoomFit')} className="zoom-fit">⤢</button>
        </div>
        {/* 视角操作按钮组 · 推到 .timeline-controls 最右侧 */}
        <ViewCaptureButtons />
      </div>

      <div className="timeline-track">
        {/* 外层 wrap · overflow-x: auto · 提供横向 pan 容器 */}
        <div
          ref={trackWrapRef}
          className="track-wrap"
          onWheel={handleWheel}
        >
          <div
            ref={trackRef}
            className={`track-rail${dragging ? ' dragging' : ''}`}
            style={{
              width: `${scene.duration * BASE_PX_PER_SECOND * zoom}px`,
              height: `${40 + scene.actors.length * ACTOR_TRACK_HEIGHT}px`,
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerLeave}
          >
          {/* 刻度线 */}
          {Array.from({ length: Math.ceil(scene.duration) + 1 }).map((_, i) => (
            <div key={i} className="tick" style={{ left: `${(i / scene.duration) * 100}%` }}>
              <span className="tick-label">{i}s</span>
            </div>
          ))}

          {/* 关键帧圆点 */}
          {scene.camera.keyframes.map((kf, i) => {
            const isLast = i === scene.camera.keyframes.length - 1;
            const isSelected = selectedId === `kf:${i}`;
            const isDragging = dragKfRef.current?.idx === i;
            return (
              <div
                key={i}
                className={`kf-dot ${isSelected ? 'selected' : ''} ${isLast ? 'last' : ''} ${isDragging ? 'dragging' : ''}`}
                style={{ left: `${(kf.t / scene.duration) * 100}%` }}
                title={t('timeline.kfDotTitle', { i, t: kf.t.toFixed(2) })}
                onPointerDown={(e) => {
                  // 关键帧拖动 · stopPropagation 避免触发 track-rail 的拖动
                  e.stopPropagation();
                  e.preventDefault();
                  dragKfRef.current = {
                    idx: i,
                    pointerId: e.pointerId,
                    startX: e.clientX,
                    startT: kf.t,
                    moved: false,
                  };
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const drag = dragKfRef.current;
                  if (!drag || drag.idx !== i) return;
                  if (Math.abs(e.clientX - drag.startX) > 3) {
                    drag.moved = true;
                    suppressClickRef.current = true;
                  }
                  const rail = trackRef.current;
                  if (!rail) return;
                  const rect = rail.getBoundingClientRect();
                  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  const newT = ratio * scene.duration;
                  updateKeyframe(i, { t: newT });
                  // 同步 playhead · 让用户看到拖到哪了
                  setPreviewT(newT);
                }}
                onPointerUp={(e) => {
                  const drag = dragKfRef.current;
                  if (!drag || drag.idx !== i) return;
                  try {
                    (e.target as HTMLElement).releasePointerCapture(drag.pointerId);
                  } catch { /* ignore */ }
                  dragKfRef.current = null;
                }}
                onPointerCancel={() => {
                  const drag = dragKfRef.current;
                  if (drag && drag.idx !== null) {
                    // 回滚到 startT · 避免拖到外面后留下异常值
                    updateKeyframe(drag.idx, { t: drag.startT });
                    dragKfRef.current = null;
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  // 拖动结束后吞掉紧随的 click
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                  }
                  // 点关键帧 = 跳到该关键帧的 t · 同时选中
                  // 用 useSceneStore.getState() 实时读最新 t（避免拖动后 closure 旧值）
                  const liveKf = useSceneStore.getState().scene.camera.keyframes[i];
                  if (!liveKf) return;
                  select(`kf:${i}`);
                  setPreviewT(liveKf.t);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (scene.camera.keyframes.length > 2) {
                    if (window.confirm(t('timeline.deleteConfirm', { i, t: kf.t.toFixed(2) }))) {
                      removeKeyframe(i);
                      select(null);
                    }
                  } else {
                    window.alert(t('timeline.minKfWarn'));
                  }
                }}
              >
                <span className="kf-dot-inner">{i}</span>
              </div>
            );
          })}

          {/* Actor 关键帧轨道 · 每个 actor 一行 · 高度 ACTOR_TRACK_HEIGHT */}
          {scene.actors.map((actor, actorIdx) => {
            const kfs = actor.keyframes ?? [];
            const trackTop = CAMERA_TRACK_HEIGHT + actorIdx * ACTOR_TRACK_HEIGHT;
            return (
              <div key={actor.id} className="actor-track">
                {/* 轨道分隔线 + 标签 */}
                <div className="actor-track-bg" style={{ top: `${trackTop}px`, height: `${ACTOR_TRACK_HEIGHT}px` }}>
                  <span className="actor-track-label" style={{ background: actor.color }}>
                    {actor.label}
                  </span>
                </div>
                {/* Actor 关键帧圆点 */}
                {kfs.map((kf, kfIdx) => {
                  const isSelected = selectedId === `akf:${actor.id}:${kfIdx}`;
                  return (
                    <div
                      key={`${actor.id}-${kfIdx}`}
                      className={`kf-dot akf-dot ${isSelected ? 'selected' : ''}`}
                      style={{
                        left: `${(kf.t / scene.duration) * 100}%`,
                        top: `${trackTop + (ACTOR_TRACK_HEIGHT - 22) / 2}px`,
                        background: actor.color,
                      }}
                      title={`${actor.label} · ${t('actor.kfDotTitle', { i: kfIdx + 1, t: kf.t.toFixed(2) })}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        // 跳到该关键帧 t + 选中 akf
                        const liveKf = useSceneStore.getState().scene.actors.find((a) => a.id === actor.id)?.keyframes?.[kfIdx];
                        if (!liveKf) return;
                        select(`akf:${actor.id}:${kfIdx}`);
                        setPreviewT(liveKf.t);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (kfs.length > 1) {
                          if (window.confirm(t('actor.kfDeleteConfirm', { i: kfIdx + 1, t: kf.t.toFixed(2) }))) {
                            removeActorKeyframe(actor.id, kfIdx);
                          }
                        } else {
                          window.alert(t('actor.kfMinWarn'));
                        }
                      }}
                    >
                      <span className="kf-dot-inner">{kfIdx + 1}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* ghost playhead · 鼠标 hover track 时显示 */}
          {hoverT !== null && !dragging && (
            <div
              className="playhead-ghost"
              style={{ left: `${(hoverT / scene.duration) * 100}%` }}
            >
              <span className="playhead-ghost-label">{hoverT.toFixed(2)}s</span>
            </div>
          )}

          {/* 当前 playhead · 始终可见 · 可拖动 */}
          <div
            className={`playhead ${dragging ? 'dragging' : ''} ${playing ? 'playing' : ''}`}
            style={{ left: `${(previewT / scene.duration) * 100}%` }}
            title={`Current time ${previewT.toFixed(2)}s · drag to scrub`}
          >
            <div className="playhead-knob" />
          </div>
          </div>
        </div>
      </div>

      <style>{`
        .timeline {
          background: var(--paper);
          border-top: 1px solid var(--line);
          padding: 8px 16px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          /* 关键: grid item 默认 min-width: auto = min-content,
             track-rail zoom 后会撑大整个 grid · 必须显式 min-width: 0 */
          min-width: 0;
          overflow: hidden;
          /* 自适应高度(Actor 多了自动撑高)+ 上限防止挤掉 Canvas */
          max-height: 60vh;
          overflow-y: auto;
        }
        .timeline-controls {
          display: flex; align-items: center; gap: 8px;
          min-width: 0;
          flex-shrink: 0;
        }
        .time-display {
          font-family: 'JetBrains Mono', monospace;
          display: inline-flex; align-items: center;
          gap: 3px;
          min-width: 180px;
          padding: 0 6px;
        }
        .time-big { font-size: 18px; font-weight: 700; color: var(--ink); line-height: 1; min-width: 48px; text-align: right; }
        .time-unit { font-size: 12px; color: var(--muted); }
        .time-total { font-size: 12px; color: var(--muted); }
        /* 时长加减按钮 + input */
        .dur-btn {
          width: 20px; height: 20px;
          padding: 0; line-height: 1;
          font-size: 13px; font-weight: 600;
          border: 1px solid var(--line);
          background: var(--bg); color: var(--ink-2);
          border-radius: 4px;
          cursor: pointer;
          transition: all .12s ease;
        }
        .dur-btn:hover {
          background: var(--primary-soft);
          border-color: var(--primary);
          color: var(--primary);
        }
        .dur-input {
          width: 42px; height: 22px;
          padding: 0 2px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px; font-weight: 600;
          text-align: center;
          border: 1px solid var(--line);
          background: var(--bg); color: var(--ink);
          border-radius: 4px;
          outline: none;
        }
        .dur-input:focus {
          border-color: var(--primary);
          box-shadow: 0 0 0 2px var(--primary-soft);
        }
        .timeline-track { padding: 0; min-width: 0; }
        .track-wrap {
          position: relative;
          width: 100%;
          min-width: 0;
          height: 52px;
          /* 左右各 14px buffer · 让最左/最右关键帧圆点不被 wrap 边缘裁一半 */
          padding-left: 14px;
          padding-right: 14px;
          padding-bottom: 12px; /* 让出横向滚动条空间 · 避免遮挡 tick 标签/playhead knob */
          overflow-x: auto;
          overflow-y: hidden;
          background: var(--bg);
          border-radius: 6px;
          scrollbar-width: thin;
        }
        .track-wrap::-webkit-scrollbar { height: 6px; }
        .track-wrap::-webkit-scrollbar-thumb { background: var(--line); border-radius: 3px; }
        .track-rail {
          position: relative;
          /* height 动态算: 40 + actors.length * 24 */
          min-width: 100%;
          cursor: pointer;
          user-select: none;
          touch-action: none;
        }
        /* Actor 关键帧轨道 */
        .actor-track {
          position: absolute;
          left: 0; right: 0; top: 0; bottom: 0;
          pointer-events: none;
        }
        .actor-track-bg {
          position: absolute;
          left: 0; right: 0;
          background: var(--bg);
          border-top: 1px solid var(--line);
          pointer-events: auto;
        }
        .actor-track-label {
          position: absolute;
          left: 4px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 10px;
          padding: 1px 6px;
          border-radius: 3px;
          color: white;
          font-weight: 500;
          white-space: nowrap;
          opacity: 0.9;
        }
        .akf-dot {
          pointer-events: auto;
        }
        .zoom-controls {
          display: flex; align-items: center; gap: 4px;
          margin-left: 12px; padding-left: 12px;
          border-left: 1px solid var(--line);
        }
        .zoom-controls button {
          min-width: 26px; padding: 4px 8px;
          font-size: 13px;
        }
        .zoom-display {
          font-size: 11px; color: var(--muted);
          min-width: 36px; text-align: center;
        }
        .zoom-fit {
          font-size: 12px;
        }
        /* 视角操作按钮组 · 推到 .timeline-controls 最右侧 */
        .view-capture {
          display: flex; gap: 8px; align-items: center;
          margin-left: auto; padding-left: 12px;
          border-left: 1px solid var(--line);
          font-size: 12px;
          color: var(--ink);
        }
        .view-capture.free {
          color: var(--accent);
        }
        .view-capture .capture-btn {
          background: var(--primary);
          color: white; border: none; padding: 6px 12px;
          border-radius: 6px; font-size: 12px; font-weight: 500;
          cursor: pointer; transition: all .15s ease;
        }
        .view-capture .capture-btn.save {
          background: var(--danger);
          color: white;
        }
        .view-capture .capture-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 2px 8px rgba(77,171,247,0.4);
        }
        .view-capture .capture-btn.save:hover {
          background: #b91c1c;
          box-shadow: 0 2px 8px rgba(220,38,38,0.5);
        }
        .view-capture .cancel-btn {
          background: transparent; color: var(--muted);
          border: 1px solid var(--line); padding: 6px 10px;
          border-radius: 6px; font-size: 12px; cursor: pointer;
        }
        .view-capture .cancel-btn:hover {
          background: var(--line); color: var(--ink);
        }
        .view-capture .capture-meta {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px; opacity: 0.7;
          min-width: 64px;
        }
        .view-capture .capture-hint {
          white-space: nowrap;
          color: var(--accent);
          font-size: 11px;
          padding: 0 4px;
        }
        .track-rail.dragging { cursor: grabbing; }
        .tick {
          position: absolute; top: 0; bottom: 0;
          width: 1px; background: var(--line);
          pointer-events: none;
        }
        .tick-label {
          position: absolute; bottom: 2px; left: 4px;
          font-size: 11px; font-weight: 600;
          color: var(--ink);
          font-family: 'JetBrains Mono', monospace;
          pointer-events: none;
        }
        .kf-dot {
          position: absolute; top: 50%;
          transform: translate(-50%, -50%);
          width: 22px; height: 22px;
          background: var(--primary-soft);
          border: 2px solid var(--primary);
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: all .15s ease;
          font-weight: 500;
          z-index: 2;
        }
        .kf-dot.last {
          background: var(--primary);
          color: white;
        }
        .kf-dot:hover {
          transform: translate(-50%, -50%) scale(1.15);
          box-shadow: 0 2px 8px rgba(201, 123, 63, 0.35);
        }
        .kf-dot.selected {
          background: var(--accent);
          border-color: var(--ink);
          transform: translate(-50%, -50%) scale(1.35);
          box-shadow: 0 0 0 4px var(--accent-soft), 0 4px 12px rgba(47, 111, 94, 0.4);
        }
        .kf-dot.dragging {
          background: var(--warn);
          border-color: white;
          transform: translate(-50%, -50%) scale(1.4);
          cursor: grabbing;
          box-shadow: 0 0 0 4px rgba(217, 119, 87, 0.25), 0 6px 16px rgba(217, 119, 87, 0.5);
          z-index: 4;
        }
        .kf-dot.selected.last {
          background: var(--accent);
        }
        .kf-dot-inner { font-size: 10px; font-weight: 700; color: inherit; }
        .kf-dot.last .kf-dot-inner { color: white; }
        .kf-dot.selected .kf-dot-inner { color: white; }

        /* playhead 始终可见 · 顶部小三角 + 中间线 + 底部 knob */
        .playhead {
          position: absolute; top: -4px; bottom: 0;
          transform: translateX(-50%);
          pointer-events: none;
          z-index: 3;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .playhead::before {
          content: '';
          width: 0; height: 0;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-top: 8px solid var(--primary);
          margin-bottom: -1px;
        }
        .playhead::after {
          content: '';
          position: absolute;
          top: 7px; bottom: 0;
          width: 2px;
          background: var(--primary);
          box-shadow: 0 0 4px rgba(201, 123, 63, 0.6);
        }
        .playhead.playing::after { background: var(--accent); box-shadow: 0 0 6px rgba(47, 111, 94, 0.8); }
        .playhead.dragging::after { background: var(--warn); box-shadow: 0 0 8px rgba(217, 119, 87, 0.8); }

        /* playhead 底部 knob · 可拖动 · 跟 hover 区域扩大 */
        .playhead-knob {
          position: absolute;
          bottom: -2px;
          width: 14px; height: 14px;
          background: var(--primary);
          border: 2px solid white;
          border-radius: 50%;
          pointer-events: auto;
          cursor: grab;
          box-shadow: 0 2px 4px rgba(0,0,0,0.25);
          transition: transform .12s ease;
        }
        .playhead-knob:hover { transform: scale(1.2); }
        .playhead.playing .playhead-knob { background: var(--accent); }
        .playhead.dragging .playhead-knob { background: var(--warn); cursor: grabbing; transform: scale(1.3); }

        /* ghost playhead · hover 时显示 */
        .playhead-ghost {
          position: absolute; top: -4px; bottom: 0;
          transform: translateX(-50%);
          pointer-events: none;
          z-index: 1;
          opacity: 0.5;
        }
        .playhead-ghost::after {
          content: '';
          position: absolute;
          top: 7px; bottom: 0; left: 50%;
          width: 1px;
          background: var(--ink);
          transform: translateX(-50%);
        }
        .playhead-ghost-label {
          position: absolute; top: -14px; left: 50%;
          transform: translateX(-50%);
          background: var(--ink); color: var(--paper);
          font-size: 9px; font-family: 'JetBrains Mono', monospace;
          padding: 1px 4px; border-radius: 3px;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}