import { useSceneStore, type TransformMode } from '../store/scene';
import type { ActorPose, CameraKeyframe } from '@director-stage/scene-schema';
import { useT } from '../i18n';

const POSES: ActorPose[] = ['stand', 'walk', 'run', 'sit', 'crouch', 'idle'];
const EASES: Array<CameraKeyframe['ease']> = ['linear', 'easeIn', 'easeOut', 'easeInOut'];

const TOOL_LIST: Array<{ mode: TransformMode; icon: string; key: string; shortcut: string }> = [
  { mode: 'translate', icon: '↔', key: 'tool.translate', shortcut: 'W' },
  { mode: 'rotate', icon: '⟲', key: 'tool.rotate', shortcut: 'E' },
  { mode: 'scale', icon: '⤢', key: 'tool.scale', shortcut: 'R' },
];

export function PropertiesPanel() {
  const selectedId = useSceneStore((s) => s.selectedId);
  const scene = useSceneStore((s) => s.scene);
  const updateActor = useSceneStore((s) => s.updateActor);
  const updateKeyframe = useSceneStore((s) => s.updateKeyframe);
  const removeKeyframe = useSceneStore((s) => s.removeKeyframe);
  const select = useSceneStore((s) => s.select);
  const removeActor = useSceneStore((s) => s.removeActor);
  const transformMode = useSceneStore((s) => s.transformMode);
  const setTransformMode = useSceneStore((s) => s.setTransformMode);
  const addActorKeyframeAtCurrentT = useSceneStore((s) => s.addActorKeyframeAtCurrentT);
  const updateActorKeyframe = useSceneStore((s) => s.updateActorKeyframe);
  const removeActorKeyframe = useSceneStore((s) => s.removeActorKeyframe);
  const previewT = useSceneStore((s) => s.previewT);
  const t = useT();

  if (!selectedId) {
    return (
      <div className="props">
        <Section title={t('props.empty')}>
          <div className="hint-text">{t('props.emptyHint')}</div>
        </Section>
        <style>{emptyStyles}</style>
      </div>
    );
  }

  // Actor 关键帧选中 (akf:actorId:idx)
  if (selectedId.startsWith('akf:')) {
    const parts = selectedId.slice(4).split(':');
    const actorId = parts[0];
    const idx = parseInt(parts[1], 10);
    const actor = scene.actors.find((a) => a.id === actorId);
    const kf = actor?.keyframes?.[idx];
    if (!actor || !kf) return null;
    const canRemove = (actor.keyframes?.length ?? 0) > 1;
    const title = `${actor.label} [${actor.id}] · 关键帧 #${idx + 1}`;
    return (
      <div className="props">
        <Section title={title}>
          <Row label={t('props.t')}>
            <input
              type="number"
              step={0.1}
              min={0}
              max={scene.duration}
              value={kf.t}
              onChange={(e) => updateActorKeyframe(actorId, idx, { t: parseFloat(e.target.value) || 0 })}
            />
          </Row>
          <Row label={t('props.pos')}>
            <Vec3Input value={kf.pos} onChange={(v) => updateActorKeyframe(actorId, idx, { pos: v })} />
          </Row>
          {kf.facing && (
            <Row label={t('props.facing')}>
              <Vec3Input value={kf.facing} onChange={(v) => updateActorKeyframe(actorId, idx, { facing: v })} />
            </Row>
          )}
          {kf.scale && (
            <Row label={t('props.scale')}>
              <Vec3Input value={kf.scale} onChange={(v) => updateActorKeyframe(actorId, idx, { scale: v })} />
            </Row>
          )}
          <Row label={t('props.pose')}>
            <select
              value={kf.pose ?? ''}
              onChange={(e) =>
                updateActorKeyframe(actorId, idx, {
                  pose: e.target.value ? (e.target.value as ActorPose) : undefined,
                })
              }
            >
              <option value="">—</option>
              {POSES.map((p) => (
                <option key={p} value={p}>{t(`pose.${p}`)}</option>
              ))}
            </select>
          </Row>
          <Row label={t('props.ease')}>
            <select
              value={kf.ease ?? ''}
              onChange={(e) =>
                updateActorKeyframe(actorId, idx, {
                  ease: e.target.value ? (e.target.value as CameraKeyframe['ease']) : undefined,
                })
              }
            >
              <option value="">—</option>
              {EASES.map((e) => (
                <option key={e} value={e}>{t(`ease.${e}`)}</option>
              ))}
            </select>
          </Row>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--line)' }}>
            <button
              className="danger-btn"
              disabled={!canRemove}
              onClick={() => {
                if (!canRemove) return;
                if (window.confirm(`${t('actor.kfDeleteConfirm', { i: idx + 1, t: kf.t.toFixed(2) })}`)) {
                  removeActorKeyframe(actorId, idx);
                  select(actorId);
                }
              }}
            >
              🗑 {t('props.deleteKf')}
            </button>
            {!canRemove && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                {t('actor.kfMinWarn')}
              </div>
            )}
          </div>
        </Section>
        <style>{propsStyles}</style>
      </div>
    );
  }

  // 关键帧选中
  if (selectedId.startsWith('kf:')) {
    const idx = parseInt(selectedId.slice(3), 10);
    const kf = scene.camera.keyframes[idx];
    if (!kf) return null;
    const canRemove = scene.camera.keyframes.length > 2;
    const title = t('props.keyframe', {
      i: idx,
      last: idx === scene.camera.keyframes.length - 1 ? t('props.last') : '',
    });
    return (
      <div className="props">
        <Section title={title}>
          <Row label={t('props.t')}>
            <input
              type="number"
              step={0.1}
              min={0}
              max={scene.duration}
              value={kf.t}
              onChange={(e) => updateKeyframe(idx, { t: parseFloat(e.target.value) || 0 })}
            />
          </Row>
          <Row label={t('props.pos')}>
            <Vec3Input value={kf.pos} onChange={(v) => updateKeyframe(idx, { pos: v })} />
          </Row>
          <Row label={t('props.lookAt')}>
            <select
              value={typeof kf.lookAt === 'string' ? kf.lookAt : '__vec__'}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__vec__') {
                  updateKeyframe(idx, { lookAt: [0, 1.5, 0] });
                } else {
                  updateKeyframe(idx, { lookAt: v });
                }
              }}
            >
              <option value="__vec__">[坐标]</option>
              {scene.actors.map((a) => (
                <option key={a.id} value={a.id}>角色 [{a.id}] {a.label}</option>
              ))}
            </select>
            {typeof kf.lookAt !== 'string' && (
              <Vec3Input value={kf.lookAt} onChange={(v) => updateKeyframe(idx, { lookAt: v })} />
            )}
          </Row>
          <Row label={t('props.ease')}>
            <select value={kf.ease ?? ''} onChange={(e) => updateKeyframe(idx, { ease: (e.target.value || undefined) as CameraKeyframe['ease'] })}>
              <option value="">—</option>
              {EASES.map((e) => (
                <option key={e} value={e}>{t(`ease.${e}`)}</option>
              ))}
            </select>
          </Row>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--line)' }}>
            <button
              className="danger-btn"
              disabled={!canRemove}
              onClick={() => {
                if (!canRemove) return;
                if (window.confirm(`${t('timeline.deleteConfirm', { i: idx, t: kf.t.toFixed(2) })}\n\n${t('timeline.minKfWarn')}`)) {
                  removeKeyframe(idx);
                  select(null);
                }
              }}
            >
              🗑 {t('props.deleteKf')}
            </button>
            {!canRemove && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                {t('timeline.minKfWarn')}
              </div>
            )}
          </div>
        </Section>
        <style>{propsStyles}</style>
      </div>
    );
  }

  // 角色选中
  const actor = scene.actors.find((a) => a.id === selectedId);
  if (!actor) return null;

  const title = t('props.actor', { label: actor.label, id: actor.id });
  const kfs = actor.keyframes ?? [];
  return (
    <div className="props">
      <Section title={title}>
        {/* Maya 风格三轴手柄工具栏 */}
        <div className="tool-bar">
          {TOOL_LIST.map((tool) => (
            <button
              key={tool.mode}
              className={`tool-btn${transformMode === tool.mode ? ' active' : ''}`}
              onClick={() => setTransformMode(tool.mode)}
              title={`${t(tool.key)} (${tool.shortcut})`}
            >
              <span className="tool-icon">{tool.icon}</span>
              <span className="tool-label">{t(tool.key)}</span>
              <span className="tool-shortcut">{tool.shortcut}</span>
            </button>
          ))}
        </div>
        <Row label="ID">
          <input value={actor.id} disabled />
        </Row>
        <Row label={t('props.label')}>
          <input value={actor.label} onChange={(e) => updateActor(actor.id, { label: e.target.value })} />
        </Row>
        <Row label={t('props.color')}>
          <input type="color" value={actor.color} onChange={(e) => updateActor(actor.id, { color: e.target.value })} />
          <input value={actor.color} onChange={(e) => updateActor(actor.id, { color: e.target.value })} style={{ width: 80 }} />
        </Row>
        <Row label={t('props.scale')}>
          <Vec3Input
            value={actor.scale ?? [1, 1, 1]}
            onChange={(v) => updateActor(actor.id, { scale: v })}
          />
        </Row>

        {/* Actor 关键帧列表 */}
        <div className="kf-list-header">
          <span>{t('actor.keyframes')}</span>
          <button
            className="kf-add-btn"
            onClick={() => {
              addActorKeyframeAtCurrentT(actor.id, {});
              // 选中新创建的关键帧
              const idx = (actor.keyframes?.length ?? 0); // 旧的 length,新增的会在末尾
              select(`akf:${actor.id}:${idx}`);
            }}
            title={t('actor.kfAddAtT', { t: previewT.toFixed(2) })}
          >
            + {t('actor.kfAddAtT', { t: previewT.toFixed(2) })}
          </button>
        </div>
        <div className="kf-list">
          {kfs
            .map((kf, i) => ({ kf, i }))
            .sort((a, b) => a.kf.t - b.kf.t)
            .map(({ kf, i }) => (
              <div
                key={i}
                className={`kf-item${selectedId === `akf:${actor.id}:${i}` ? ' selected' : ''}`}
                onClick={() => {
                  select(`akf:${actor.id}:${i}`);
                  useSceneStore.getState().setPreviewT(kf.t);
                }}
              >
                <span className="kf-dot" style={{ background: actor.color }} />
                <span className="kf-t mono">{kf.t.toFixed(2)}s</span>
                <span className="kf-pos mono">
                  [{kf.pos[0].toFixed(1)}, {kf.pos[1].toFixed(1)}, {kf.pos[2].toFixed(1)}]
                </span>
                {kf.pose && <span className="kf-pose">{t(`pose.${kf.pose}`)}</span>}
                {kf.scale && (kf.scale[0] !== 1 || kf.scale[1] !== 1 || kf.scale[2] !== 1) && (
                  <span className="kf-scale mono">
                    ×[{kf.scale[0].toFixed(2)}, {kf.scale[1].toFixed(2)}, {kf.scale[2].toFixed(2)}]
                  </span>
                )}
              </div>
            ))}
        </div>

        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--line)' }}>
          <button
            className="danger-btn"
            onClick={() => {
              if (window.confirm(`删除角色 [${actor.id}] ${actor.label}？`)) {
                removeActor(actor.id);
                select(null);
              }
            }}
          >
            🗑 {t('props.deleteActor')}
          </button>
        </div>
      </Section>
      <style>{propsStyles + extraStyles}</style>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prop-row">
      <div className="prop-label">{label}</div>
      <div className="prop-control">{children}</div>
      <style>{`
        .prop-row {
          display: grid;
          grid-template-columns: 80px 1fr;
          gap: 8px;
          align-items: center;
          margin-bottom: 6px;
        }
        .prop-label { font-size: 11px; color: var(--muted); font-family: 'JetBrains Mono', monospace; }
        .prop-control { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
      `}</style>
    </div>
  );
}

function Vec3Input({ value, onChange }: { value: [number, number, number]; onChange: (v: [number, number, number]) => void }) {
  return (
    <div style={{ display: 'flex', gap: 2, width: '100%' }}>
      {(['x', 'y', 'z'] as const).map((axis, i) => (
        <input
          key={axis}
          type="number"
          step={0.1}
          value={value[i]}
          onChange={(e) => {
            const v = [...value] as [number, number, number];
            v[i] = parseFloat(e.target.value) || 0;
            onChange(v);
          }}
          style={{ width: 0, flex: 1, minWidth: 0 }}
          placeholder={axis}
        />
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="section">
      <div className="section-title">{title}</div>
      <div className="section-body">{children}</div>
    </div>
  );
}

const propsStyles = `
  .props {
    background: var(--paper);
    padding: 12px;
    overflow-y: auto;
    height: 100%;
  }
  .section { display: flex; flex-direction: column; gap: 8px; }
  .section-title {
    font-size: 11px; font-weight: 600; color: var(--muted);
    text-transform: uppercase; letter-spacing: .04em;
    margin-bottom: 4px;
  }
  .danger-btn {
    width: 100%;
    background: transparent;
    border: 1px solid var(--warn);
    color: var(--warn);
    padding: 6px 12px;
    border-radius: 6px;
    font-weight: 500;
    transition: all .15s ease;
  }
  .danger-btn:hover:not(:disabled) {
    background: var(--warn);
    color: white;
  }
  .danger-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

/** 工具栏 + keyframes 列表样式 · Maya 风格 */
const extraStyles = `
  /* Maya 风格工具栏 */
  .tool-bar {
    display: flex; gap: 4px;
    padding: 4px;
    margin-bottom: 8px;
    background: var(--bg);
    border-radius: 6px;
    border: 1px solid var(--line);
  }
  .tool-btn {
    flex: 1;
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    padding: 6px 4px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--muted);
    cursor: pointer;
    transition: all .12s ease;
    font-size: 11px;
  }
  .tool-btn:hover {
    background: var(--paper);
    color: var(--ink);
  }
  .tool-btn.active {
    background: var(--primary);
    color: white;
    border-color: var(--primary);
  }
  .tool-icon { font-size: 16px; line-height: 1; }
  .tool-label { font-size: 10px; }
  .tool-shortcut {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    opacity: 0.6;
  }

  /* Actor 关键帧列表 */
  .kf-list-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed var(--line);
    font-size: 11px; font-weight: 600; color: var(--muted);
    text-transform: uppercase; letter-spacing: .04em;
  }
  .kf-add-btn {
    background: var(--accent);
    color: var(--bg);
    border: none;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 500;
    cursor: pointer;
  }
  .kf-add-btn:hover { opacity: 0.85; }
  .kf-list {
    display: flex; flex-direction: column; gap: 2px;
    max-height: 200px;
    overflow-y: auto;
  }
  .kf-item {
    display: flex; align-items: center; gap: 6px;
    padding: 4px 6px;
    border-radius: 4px;
    background: var(--bg);
    cursor: pointer;
    font-size: 11px;
    transition: background .1s ease;
  }
  .kf-item:hover { background: var(--paper); }
  .kf-item.selected {
    background: var(--primary-soft);
    outline: 1px solid var(--primary);
  }
  .kf-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .kf-t { color: var(--accent); font-weight: 500; min-width: 44px; }
  .kf-pos { color: var(--muted); font-size: 10px; }
  .kf-pose {
    font-size: 9px;
    color: var(--warn);
    padding: 0 4px;
    border-radius: 3px;
    background: rgba(217, 119, 87, 0.15);
  }
  .kf-scale {
    color: var(--muted);
    font-size: 9px;
    opacity: 0.8;
  }
`;

const emptyStyles = `
  .props {
    background: var(--paper);
    padding: 12px;
    overflow-y: auto;
    height: 100%;
  }
  .hint-text {
    font-size: 11.5px;
    color: var(--muted);
    line-height: 1.7;
    white-space: pre-wrap;
  }
`;