import { useState } from 'react';
import { useSceneStore, PRESET_LIST } from '../store/scene';
import type { ScenePreset, AspectRatio, Actor } from '@director-stage/scene-schema';
import { useT } from '../i18n';

const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c'];

const ASPECTS: AspectRatio[] = ['2.76:1', '2.39:1', '2.00:1', '1.85:1', '16:9', '4:3', '9:16', '1:1'];
const CAMERA_PRESETS = [
  { id: 'push_in' as const, icon: '→' },
  { id: 'pull_out' as const, icon: '←' },
  { id: 'orbit' as const, icon: '↻' },
  { id: 'crane_up' as const, icon: '↑' },
  { id: 'tracking' as const, icon: '⇄' },
  { id: 'static' as const, icon: '·' },
];

export function Sidebar() {
  const scene = useSceneStore((s) => s.scene);
  const selectedId = useSceneStore((s) => s.selectedId);
  const select = useSceneStore((s) => s.select);
  const setPreset = useSceneStore((s) => s.setPreset);
  const setAspect = useSceneStore((s) => s.setAspect);
  const addActor = useSceneStore((s) => s.addActor);
  const removeActor = useSceneStore((s) => s.removeActor);
  const applyCameraPreset = useSceneStore((s) => s.applyCameraPreset);
  const t = useT();
  const [presetDistance, setPresetDistance] = useState(4);
  const [presetDuration, setPresetDuration] = useState(5);

  const handleAddActor = () => {
    const colorIdx = scene.actors.length % COLORS.length;
    const newActor: Actor = {
      id: `A${scene.actors.length + 1}`,
      label: `角色 ${scene.actors.length + 1}`,
      color: COLORS[colorIdx],
      start: [0, 0, 0],
      pose: 'stand',
    };
    addActor(newActor);
    select(newActor.id);
  };

  return (
    <aside className="sidebar">
      <Section title={t('sidebar.preset')}>
        <select value={scene.scene.preset} onChange={(e) => setPreset(e.target.value as ScenePreset)}>
          {PRESET_LIST.map((p) => (
            <option key={p.id} value={p.id}>
              {t(`preset.${p.id}`)} ({p.size[0]}×{p.size[1]}×{p.size[2]})
            </option>
          ))}
        </select>
      </Section>

      <Section title={t('sidebar.aspect')}>
        <select value={scene.aspect} onChange={(e) => setAspect(e.target.value as AspectRatio)}>
          {ASPECTS.map((a) => (
            <option key={a} value={a}>{t(`aspect.${a}`)}</option>
          ))}
        </select>
      </Section>

      <Section title={t('sidebar.actorCount', { n: scene.actors.length })}>
        <div className="actor-list">
          {scene.actors.length === 0 && (
            <div className="actor-empty">{t('sidebar.actors.empty')}</div>
          )}
          {scene.actors.map((a) => (
            <div
              key={a.id}
              className={`actor-item ${selectedId === a.id ? 'selected' : ''}`}
              onClick={() => select(a.id)}
            >
              <span className="actor-color" style={{ background: a.color }} />
              <span className="actor-label">{a.label}</span>
              <span className="actor-id">[{a.id}]</span>
              <button
                className="actor-del"
                onClick={(e) => {
                  e.stopPropagation();
                  removeActor(a.id);
                }}
                title={t('props.deleteActor')}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          className="add-actor-btn"
          onClick={handleAddActor}
          disabled={scene.actors.length >= 10}
          title="添加新角色到场景"
        >
          {t('sidebar.addActor')}
        </button>
      </Section>

      <Section title={t('sidebar.templates')}>
        <div className="preset-grid">
          {CAMERA_PRESETS.map((p) => (
            <button
              key={p.id}
              className="preset-btn"
              onClick={() => applyCameraPreset(p.id, { distance: presetDistance, duration: presetDuration })}
              title={t(`cam.${p.id}.desc`)}
            >
              <span className="preset-icon">{p.icon}</span>
              <span className="preset-label">{t(`cam.${p.id}`)}</span>
            </button>
          ))}
        </div>
        <div className="slider-row">
          <label>{t('sidebar.distance', { d: presetDistance })}</label>
          <input type="range" min={1} max={20} step={0.5} value={presetDistance} onChange={(e) => setPresetDistance(parseFloat(e.target.value))} />
        </div>
        <div className="slider-row">
          <label>{t('sidebar.duration', { d: presetDuration })}</label>
          <input type="range" min={1} max={30} step={1} value={presetDuration} onChange={(e) => setPresetDuration(parseFloat(e.target.value))} />
        </div>
      </Section>

      <style>{`
        .sidebar {
          background: var(--paper);
          border-right: 1px solid var(--line);
          padding: 12px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .actor-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
        .actor-item {
          display: grid;
          grid-template-columns: 14px 1fr auto auto;
          align-items: center; gap: 8px;
          padding: 6px 8px; border-radius: 6px;
          cursor: pointer;
          font-size: 12.5px;
          border: 1px solid transparent;
        }
        .actor-item:hover { background: var(--bg); }
        .actor-item.selected { background: var(--primary-soft); border-color: var(--primary); }
        .actor-color { width: 14px; height: 14px; border-radius: 4px; }
        .actor-label { color: var(--ink); }
        .actor-id { color: var(--muted); font-family: 'JetBrains Mono', monospace; font-size: 11px; }
        .actor-del {
          background: transparent; border: none; color: var(--muted);
          padding: 0 4px; font-size: 16px; line-height: 1;
        }
        .actor-del:hover { color: var(--warn); background: transparent; }
        /* 加角色按钮 · 主色强化 */
        .add-actor-btn {
          width: 100%;
          background: var(--primary-soft);
          color: var(--primary);
          border: 1px dashed var(--primary);
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 13px; font-weight: 500;
          cursor: pointer;
          transition: all .15s ease;
        }
        .add-actor-btn:hover:not(:disabled) {
          background: var(--primary);
          color: white;
          border-style: solid;
          transform: translateY(-1px);
        }
        .add-actor-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        /* 运镜模板 · 6 按钮 grid */
        .preset-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
        }
        .preset-btn {
          display: flex; flex-direction: column;
          align-items: center; gap: 2px;
          padding: 8px 4px;
          border: 1px solid var(--line);
          background: var(--bg);
          color: var(--ink);
          border-radius: 6px;
          transition: all .15s ease;
          cursor: pointer;
        }
        .preset-btn:hover {
          background: var(--primary-soft);
          border-color: var(--primary);
          color: var(--primary);
          transform: translateY(-1px);
        }
        .preset-icon { font-size: 16px; line-height: 1; }
        .preset-label { font-size: 12px; font-weight: 500; }
        .slider-row { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
        .slider-row label {
          font-size: 11px; color: var(--muted);
          font-family: 'JetBrains Mono', monospace;
        }
        .slider-row input[type="range"] { width: 100%; }
      `}</style>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="section">
      <div className="section-title">{title}</div>
      <div className="section-body">{children}</div>
      <style>{`
        .section { display: flex; flex-direction: column; gap: 6px; }
        .section-title {
          font-size: 11px; font-weight: 600; color: var(--muted);
          text-transform: uppercase; letter-spacing: .04em;
        }
        .section-body select, .section-body input[type="range"] { width: 100%; }
      `}</style>
    </div>
  );
}