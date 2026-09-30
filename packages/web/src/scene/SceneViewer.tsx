import { useEffect, useLayoutEffect, useRef, Component, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { OrbitControls, TransformControls, Grid } from '@react-three/drei';
import type { PerspectiveCamera } from 'three';
import { useSceneStore, type Vec3 } from '../store/scene';
import { useT } from '../i18n';
import { ActorMesh } from './ActorMesh';
import { EnvMesh } from './EnvMesh';
import { CameraRig } from './CameraRig';

/** 导出期间强制相机宽高比 = 导出像素比，避免 CSS 尺寸与缓冲不一致导致拉伸 */
function ExportAspectLock() {
  const { camera } = useThree();
  useFrame(() => {
    const w = window as unknown as {
      __DS_EXPORTING__?: boolean;
      __DS_EXPORT_PX__?: { width: number; height: number };
    };
    if (!w.__DS_EXPORTING__ || !w.__DS_EXPORT_PX__) return;
    const { width, height } = w.__DS_EXPORT_PX__;
    if (height <= 0) return;
    const next = width / height;
    const cam = camera as PerspectiveCamera;
    if (Math.abs(cam.aspect - next) > 0.0001) {
      cam.aspect = next;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

/**
 * R3F Canvas 错误捕获
 * 一旦 Canvas 渲染抛错（WebGL 失败 / three.js 多实例 / Suspense 卡死等）
 * 显示 fallback UI + 把错误打到 console + window.__ds_last_error__（方便诊断）
 */
class CanvasErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[CanvasErrorBoundary]', error, info.componentStack);
    (window as unknown as { __ds_last_error__?: Error }).__ds_last_error__ = error;
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#1c1b1a', color: '#d97757',
          fontFamily: 'JetBrains Mono, monospace', fontSize: '12px',
          padding: '24px', textAlign: 'center', gap: '12px',
        }}>
          <div style={{ fontSize: '14px', color: '#f0ead9' }}>Canvas 渲染失败</div>
          <div style={{ maxWidth: '520px', opacity: 0.85 }}>
            {this.state.error.message}
          </div>
          <div style={{ opacity: 0.6, fontSize: '11px' }}>
            请打开 DevTools Console 查看完整堆栈（F12）
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function SceneViewer() {
  const scene = useSceneStore((s) => s.scene);
  const selectedId = useSceneStore((s) => s.selectedId);
  const select = useSceneStore((s) => s.select);
  const updateKeyframe = useSceneStore((s) => s.updateKeyframe);
  const addActorKeyframeAtCurrentT = useSceneStore((s) => s.addActorKeyframeAtCurrentT);
  const previewT = useSceneStore((s) => s.previewT);
  const transformMode = useSceneStore((s) => s.transformMode);
  const freeViewMode = useSceneStore((s) => s.freeViewMode);
  const setFreeViewMode = useSceneStore((s) => s.setFreeViewMode);
  const t = useT();

  // 用于把 R3F 内的 canvas DOM 暴露给 exporter
  const sceneViewerRef = useRef<HTMLDivElement>(null);
  /** 外层 wrap · 显示黑边（letterbox/pillarbox）· 用于计算 scene-viewer 实际尺寸 */
  const sceneWrapRef = useRef<HTMLDivElement>(null);

  // 把 wrap 暴露到 window（exporter 用）
  useEffect(() => {
    (window as unknown as { __ds_canvas_wrap__: HTMLDivElement | null }).__ds_canvas_wrap__ = sceneViewerRef.current;
    return () => {
      (window as unknown as { __ds_canvas_wrap__: HTMLDivElement | null }).__ds_canvas_wrap__ = null;
    };
  }, []);

  /**
   * 所见即所得 · 关键
   *
   * scene-viewer-wrap 是网格里的 1fr 行（充满 app-center 中间）
   * scene-viewer 内部按 scene.aspect 比例 fit 黑边 viewport
   * - 16:9 (横屏) → 左右可能留 letterbox 黑边（如果 wrap 是竖的）
   * - 9:16 (竖屏) → 上下一定留 pillarbox 黑边（如果 wrap 是横的）
   *
   * 用 ResizeObserver + inline style 写 DOM，不触发 React re-render
   */
  useLayoutEffect(() => {
    const wrap = sceneWrapRef.current;
    const inner = sceneViewerRef.current;
    if (!wrap || !inner) return;
    const computeSize = () => {
      const { width: ww, height: wh } = wrap.getBoundingClientRect();
      const [aw, ah] = useSceneStore.getState().scene.aspect.split(':').map(Number);
      const aspect = aw / ah;
      let w: number;
      let h: number;
      if (ww / wh > aspect) {
        // wrap 更宽（横屏 viewport）· 按高度 fit · 左右留黑边
        h = wh;
        w = wh * aspect;
      } else {
        // wrap 更窄（竖屏 viewport）· 按宽度 fit · 上下留黑边
        w = ww;
        h = ww / aspect;
      }
      inner.style.width = `${w}px`;
      inner.style.height = `${h}px`;
    };
    computeSize();
    const ro = new ResizeObserver(computeSize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [scene.aspect]);

  // Esc 退出自由视角模式
  useEffect(() => {
    if (!freeViewMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFreeViewMode(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [freeViewMode, setFreeViewMode]);

  /**
   * Maya 风格快捷键 (W/E/R/Esc)
   - W: 切到 translate
   - E: 切到 rotate
   - R: 切到 scale
   - Esc: 取消选中(select(null))
   - 输入框 / 文本域焦点时跳过（避免吞字符）
   */
  const setTransformMode = useSceneStore((s) => s.setTransformMode);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 输入控件焦点时不拦截（让用户正常打字）
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          (target as HTMLElement).isContentEditable)
      ) {
        return;
      }
      // 修饰键按下时不响应（避免吞 Ctrl+W / Cmd+R 等浏览器快捷键）
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'w' || e.key === 'W') {
        setTransformMode('translate');
      } else if (e.key === 'e' || e.key === 'E') {
        setTransformMode('rotate');
      } else if (e.key === 'r' || e.key === 'R') {
        setTransformMode('scale');
      } else if (e.key === 'Escape') {
        // Esc 同时退出 freeViewMode + 取消选中
        useSceneStore.getState().select(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setTransformMode]);

  /**
   * 浏览器 zoom 适配：Ctrl+/- 缩放或浏览器菜单缩放不会触发 window.resize
   * 但 R3F Canvas 的 ResizeObserver 监听 container size，zoom 改变 layout
   * 会触发 ResizeObserver · 但 zoom 完成后 camera.aspect 需要重新计算
   *
   * 修法：
   * - 监听 visualViewport.resize · 在浏览器 zoom 变化时 dispatch window resize
   * - 监听 Ctrl/Cmd + 数字键/+/= · 让浏览器处理完后再 dispatch
   */
  useEffect(() => {
    const dispatchResize = () => {
      // 延迟一帧让浏览器完成 zoom layout · 然后触发 R3F Canvas 重新计算
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'));
      });
    };
    // 1. visualViewport 变化（Chrome / Edge / Safari 支持）
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', dispatchResize);
      vv.addEventListener('scroll', dispatchResize);
    }
    // 2. Ctrl/Cmd +/-/= 手动监听 · 浏览器菜单 zoom 也通常对应快捷键
    const keyHandler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (
        e.key === '+' || e.key === '=' ||
        e.key === '-' || e.key === '_' ||
        e.key === '0'
      ) {
        // 不阻止默认 · 让浏览器正常缩放 · 然后 dispatch resize 让 R3F 重算
        setTimeout(dispatchResize, 100);
      }
    };
    window.addEventListener('keydown', keyHandler);
    return () => {
      if (vv) {
        vv.removeEventListener('resize', dispatchResize);
        vv.removeEventListener('scroll', dispatchResize);
      }
      window.removeEventListener('keydown', keyHandler);
    };
  }, []);

  return (
    <div ref={sceneWrapRef} className="scene-viewer-wrap">
      <div ref={sceneViewerRef} className={`scene-viewer${freeViewMode ? ' free' : ''}`}>
      <CanvasErrorBoundary>
      <Canvas
        shadows
        camera={{ position: [0, 4, 10], fov: 50, near: 0.1, far: 100 }}
        gl={{ preserveDrawingBuffer: true /* 关键：exporter 需要 captureStream */ }}
        style={{ background: 'var(--canvas-bg)' }}
        onCreated={({ gl, camera }) => {
          (window as unknown as { __ds_gl__?: typeof gl }).__ds_gl__ = gl;
          (window as unknown as { __ds_camera__?: typeof camera }).__ds_camera__ = camera;
          // 暴露 WebGL context 给诊断用 · 方便后续 debug 拿 context loss 事件
          (window as unknown as { __ds_webgl_ctx__?: WebGLRenderingContext | null }).__ds_webgl_ctx__ = gl.getContext();
          const ctx = gl.getContext();
          if (ctx) {
            ctx.canvas.addEventListener('webglcontextlost', (e) => {
              console.error('[WebGL] context lost', e);
            });
          }
          console.info('[SceneViewer] Canvas created · WebGL ready');
        }}
      >
        {/* 灯光：3 点照明 + hemisphere 模拟天空/地面光(零外部 HDR 依赖) */}
        <ambientLight intensity={0.5} />
        <hemisphereLight args={['#bcd9ff', '#6a6048', 0.55]} />
        <directionalLight position={[5, 8, 5]} intensity={0.8} castShadow />
        <directionalLight position={[-5, 4, -3]} intensity={0.3} color="#88aaff" />

        {/* 地面网格（导演参考用） */}
        <Grid
          position={[0, 0, 0]}
          args={[20, 20]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#3a4256"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#c97b3f"
          fadeDistance={30}
          fadeStrength={1}
          infiniteGrid
        />

        {/* 环境几何体 */}
        <EnvMesh preset={scene.scene.preset} size={scene.scene.size} env={scene.scene.env} />

        {/* 角色胶囊 */}
        {scene.actors.map((actor) => (
          <ActorMesh
            key={actor.id}
            actor={actor}
            selected={selectedId === actor.id}
            onClick={() => select(actor.id)}
          />
        ))}

        {/* 相机运镜 + 预览 */}
        <CameraRig />
        <ExportAspectLock />

        {/* 摄像机轨道控制 · 仅 freeViewMode 时启用 */}
        <CaptureOrbitControls />

        {/* 选中物体的 Transform 控制器 */}
        {selectedId && selectedId.startsWith('kf:') && (() => {
          const idx = parseInt(selectedId.slice(3), 10);
          const kf = scene.camera.keyframes[idx];
          if (!kf) return null;
          return (
            <TransformControls
              mode="translate"
              onObjectChange={(e) => {
                const target = e as unknown as { target?: { object?: { position: { x: number; y: number; z: number } } } };
                const obj = target.target?.object;
                if (obj) {
                  const p = obj.position;
                  updateKeyframe(idx, { pos: [p.x, p.y, p.z] });
                }
              }}
            >
              <group position={kf.pos}>
                <mesh>
                  <sphereGeometry args={[0.15, 8, 8]} />
                  <meshBasicMaterial color="#c97b3f" wireframe />
                </mesh>
              </group>
            </TransformControls>
          );
        })()}

        {/* Actor 三轴手柄 · Maya 风格 (translate / rotate / scale) */}
        {selectedId &&
          !selectedId.startsWith('kf:') &&
          !selectedId.startsWith('akf:') &&
          (() => {
            const actor = scene.actors.find((a) => a.id === selectedId);
            if (!actor) return null;
            // 当前 previewT 时刻 actor 的关键帧（用于手柄初始 pos/scale/yaw）
            const kfs = actor.keyframes ?? [];
            const curKf = kfs.find((k) => Math.abs(k.t - previewT) < 0.1);
            const initialPos: Vec3 = curKf?.pos ?? kfs[0]?.pos ?? actor.start ?? [0, 0, 0];
            const initialScale: Vec3 = curKf?.scale ?? kfs[0]?.scale ?? actor.scale ?? [1, 1, 1];
            const yawToFacing = (yaw: number): Vec3 => [Math.sin(yaw), 0, Math.cos(yaw)];
            const facingYaw = (kf?: { facing?: Vec3 }) => {
              const f = kf?.facing ?? actor.facing ?? [0, 0, 1];
              return Math.atan2(f[0], f[2]);
            };
            const initialYaw = facingYaw(curKf ?? kfs[0]);
            return (
              <TransformControls
                mode={transformMode}
                onObjectChange={(e) => {
                  const target = e as unknown as {
                    target?: {
                      object?: {
                        position: { x: number; y: number; z: number };
                        scale: { x: number; y: number; z: number };
                        rotation: { x: number; y: number; z: number };
                      };
                    };
                  };
                  const obj = target.target?.object;
                  if (!obj) return;
                  if (transformMode === 'translate') {
                    const p = obj.position;
                    addActorKeyframeAtCurrentT(actor.id, { pos: [p.x, p.y, p.z] });
                  } else if (transformMode === 'scale') {
                    const s = obj.scale;
                    addActorKeyframeAtCurrentT(actor.id, { scale: [s.x, s.y, s.z] });
                  } else if (transformMode === 'rotate') {
                    // 归一化 yaw 到 [-π, π] · 防 Euler 累积溢出
                    let yaw = obj.rotation.y;
                    while (yaw > Math.PI) yaw -= 2 * Math.PI;
                    while (yaw < -Math.PI) yaw += 2 * Math.PI;
                    addActorKeyframeAtCurrentT(actor.id, { facing: yawToFacing(yaw) });
                  }
                }}
              >
                <group position={initialPos} scale={initialScale} rotation={[0, initialYaw, 0]}>
                  {/* 隐形锚点 · 让 TransformControls attach 到一个可操控对象 */}
                  <mesh visible={false}>
                    <boxGeometry args={[0.001, 0.001, 0.001]} />
                    <meshBasicMaterial />
                  </mesh>
                </group>
              </TransformControls>
            );
          })()}
      </Canvas>
      </CanvasErrorBoundary>

      {/* 视角操作按钮已挪到 Timeline 顶栏右侧空白处（参见 panels/Timeline.tsx · ViewCaptureButtons） */}

      {/* 比例角标 · 所见即所得画面框 */}
      <div className="scene-aspect-badge" aria-hidden>
        {t('scene.aspectBadge', { aspect: scene.aspect })}
      </div>

      {/* 顶部小贴士 */}
      <div className="scene-tip">
        {freeViewMode ? t('scene.tipFree') : t('scene.tipDefault')}
      </div>
      <style>{`
        /* 所见即所得 · 外层 wrap (app-center 1fr 行)
           深色 letterbox · 内层比例框就是最终成片范围 */
        .scene-viewer-wrap {
          position: relative;
          width: 100%; height: 100%;
          min-width: 0; min-height: 0;
          background: rgba(0, 0, 0, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }
        /* 内层 scene-viewer · 按 scene.aspect fit · 高对比边框 = 视频安全框 */
        .scene-viewer {
          position: relative;
          /* width/height 由 useLayoutEffect 根据 scene.aspect + wrap size 计算 */
          min-width: 0; min-height: 0;
          overflow: hidden;
          border: 2px solid rgba(255, 196, 86, 0.85);
          box-shadow:
            0 0 0 1px rgba(0, 0, 0, 0.75),
            0 8px 28px rgba(0, 0, 0, 0.45);
        }
        .scene-viewer.free canvas { cursor: grab !important; }
        .scene-viewer.free canvas:active { cursor: grabbing !important; }
        .scene-aspect-badge {
          position: absolute; top: 8px; right: 10px; z-index: 3;
          padding: 3px 9px;
          background: rgba(0,0,0,0.62); color: rgba(255,200,100,0.95);
          border: 1px solid rgba(255,180,60,0.5);
          border-radius: 4px; font-size: 11px; font-weight: 600;
          letter-spacing: 0.04em;
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          pointer-events: none; backdrop-filter: blur(4px);
        }
        .scene-tip {
          position: absolute; top: 8px; left: 12px; padding: 4px 10px;
          background: rgba(20,23,42,0.65); color: #f0ead9;
          border-radius: 14px; font-size: 11px;
          pointer-events: none; backdrop-filter: blur(4px);
        }
        @keyframes capture-flash {
          0% { transform: scale(1); }
          50% { transform: scale(1.15); background: #5cff8e; }
          100% { transform: scale(1); }
        }
        .capture-btn.flashed { animation: capture-flash .4s ease; }
      `}</style>
      </div>
    </div>
  );
}

/**
 * CaptureOrbitControls 外壳 · 根据 freeViewMode 决定是否挂载内部 OrbitControls
 *
 * 关键：不挂载时（freeViewMode=false）→ OrbitControls 完全不在 R3F 树中
 * → 不会通过 makeDefault 抢占 R3F 的 default camera control
 * → CameraRig 的 useFrame 可以安全地控制 camera
 *
 * freeViewMode=true 时挂载 → OrbitControls 工作，用户可拖动视角
 */
function CaptureOrbitControls() {
  const freeViewMode = useSceneStore((s) => s.freeViewMode);
  if (!freeViewMode) return null;
  return <ActiveOrbitControls />;
}

/**
 * 实际的 OrbitControls · 只在 freeViewMode=true 时挂载
 * 挂载时暴露 __ds_capture_view__ 函数 · 让 ViewCaptureButtons (Timeline 顶栏右侧) 调用存关键帧
 */
function ActiveOrbitControls() {
  const ref = useRef<OrbitControlsImpl | null>(null);
  const { camera } = useThree();

  useEffect(() => {
    const controls = ref.current;
    if (!controls) return;
    (window as unknown as {
      __ds_capture_view__: () => boolean;
      __ds_orbit_controls__: OrbitControlsImpl | null;
    }).__ds_capture_view__ = () => {
      const pos: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
      const t = controls.target;
      const lookAt: Vec3 = [t.x, t.y, t.z];
      useSceneStore.getState().addKeyframeAtCurrentT({ pos, lookAt });
      const btn = document.querySelector('.view-capture .capture-btn');
      if (btn) {
        btn.classList.remove('flashed');
        void (btn as HTMLElement).offsetWidth;
        btn.classList.add('flashed');
      }
      // 自动退出自由模式（回到所见即所得）
      useSceneStore.getState().setFreeViewMode(false);
      return true;
    };
    (window as unknown as { __ds_orbit_controls__: OrbitControlsImpl | null }).__ds_orbit_controls__ = controls;
    return () => {
      (window as unknown as { __ds_capture_view__?: () => boolean }).__ds_capture_view__ = undefined;
      (window as unknown as { __ds_orbit_controls__?: OrbitControlsImpl | null }).__ds_orbit_controls__ = null;
    };
  }, [camera]);

  return (
    <OrbitControls
      ref={ref as unknown as React.Ref<OrbitControlsImpl>}
      makeDefault
      target={[0, 1.5, 0]}
      enableDamping
    />
  );
}

/**
 * 视角操作按钮已挪到 Timeline 顶栏右侧空白处 · 参见 panels/Timeline.tsx · ViewCaptureButtons
 * （保留 .capture-btn.flashed 动画 + capture 函数 querySelector 选择器 .view-capture .capture-btn）
 */