import { useSceneStore } from '../store/scene';
import type { ActorPose, CameraKeyframe } from '@director-stage/scene-schema';
import { useT } from '../i18n';

const POSES: ActorPose[] = ['stand', 'walk', 'run', 'sit', 'crouch', 'idle'];
const EASES: Array<CameraKeyframe['ease']> = ['linear', 'easeIn', 'easeOut', 'easeInOut'];

export function PropertiesPanel() {
  const selectedId = useSceneStore((s) => s.selectedId);
  const scene = useSceneStore((s) => s.scene);
  const updateActor = useSceneStore((s) => s.updateActor);
  const updateKeyframe = useSceneStore((s) => s.updateKeyframe);
  const removeKeyframe = useSceneStore((s) => s.removeKeyframe);
  const select = useSceneStore((s) => s.select);
  const removeActor = useSceneStore((s) => s.removeActor);
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
  return (
    <div className="props">
      <Section title={title}>
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
        <Row label={t('props.start')}>
          <Vec3Input value={actor.start} onChange={(v) => updateActor(actor.id, { start: v })} />
        </Row>
        <Row label={t('props.facing')}>
          <Vec3Input value={actor.facing ?? [0, 0, 1]} onChange={(v) => updateActor(actor.id, { facing: v })} />
        </Row>
        <Row label={t('props.pose')}>
          <select value={actor.pose} onChange={(e) => updateActor(actor.id, { pose: e.target.value as ActorPose })}>
            {POSES.map((p) => (
              <option key={p} value={p}>{t(`pose.${p}`)} {p}</option>
            ))}
          </select>
        </Row>
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
      <style>{propsStyles}</style>
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