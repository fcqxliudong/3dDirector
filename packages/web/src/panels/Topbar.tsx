import { useState } from 'react';
import { useSceneStore } from '../store/scene';
import { ExportDialog } from './ExportDialog';
import { notifyParent, readEmbed } from '../embed';
import { useT, useLang, type Lang } from '../i18n';

export function Topbar() {
  const scene = useSceneStore((s) => s.scene);
  const toJson = useSceneStore((s) => s.toJson);
  const loadJson = useSceneStore((s) => s.loadJson);
  const errors = useSceneStore((s) => s.errors);

  const t = useT();
  const [lang, setLang] = useLang();

  const [exportOpen, setExportOpen] = useState(false);
  const embed = readEmbed().embed;
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState('');

  const copyJson = () => {
    navigator.clipboard?.writeText(toJson());
  };

  return (
    <div className="topbar">
      <div className="topbar-left">
        <span className="brand">🎬 Director Stage</span>
        <span className="brand-meta">v0.1 · {scene.scene.preset}</span>
      </div>

      <div className="topbar-mid">
        {errors.length > 0 && (
          <span className="error-badge" title={errors.map((e) => `${e.path}: ${e.message}`).join('\n')}>
            {t('topbar.errors', { n: errors.length })}
          </span>
        )}
      </div>

      <div className="topbar-right">
        {embed && (
          <button type="button" onClick={() => notifyParent('close')} title="回到节点">
            返回节点
          </button>
        )}
        <button onClick={() => setShowJson((s) => !s)} title="查看 / 粘贴 JSON">
          {showJson ? '关闭 JSON' : 'JSON'}
        </button>
        <button onClick={copyJson} title="复制当前 SceneJSON">
          {t('topbar.copy')}
        </button>
        <button className="primary" onClick={() => setExportOpen(true)}>
          {t('topbar.export')}
        </button>
        <select
          className="lang-select"
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
          title={t('topbar.lang')}
        >
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </div>

      {showJson && (
        <div className="json-popup">
          <textarea
            className="json-area"
            value={jsonText || toJson()}
            onChange={(e) => setJsonText(e.target.value)}
            spellCheck={false}
            rows={20}
          />
          <div className="json-actions">
            <button onClick={() => { setJsonText(''); }}>清空</button>
            <button
              className="primary"
              onClick={() => {
                const ok = loadJson(jsonText || toJson());
                if (ok) setShowJson(false);
              }}
            >
              应用
            </button>
          </div>
        </div>
      )}

      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}

      <style>{`
        .topbar {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          padding: 0 16px;
          background: var(--paper);
          border-bottom: 1px solid var(--line);
          gap: 16px;
          position: relative;
        }
        .topbar-left { display: flex; align-items: center; gap: 12px; }
        .topbar-mid { display: flex; align-items: center; gap: 12px; justify-self: center; }
        .topbar-right { display: flex; align-items: center; gap: 8px; justify-self: end; }
        .brand { font-family: 'DM Serif Display', serif; font-size: 18px; }
        .brand-meta { color: var(--muted); font-size: 12px; }
        .error-badge { color: var(--warn); background: #f3e1de; padding: 2px 8px; border-radius: 4px; font-size: 11.5px; cursor: help; }
        .json-popup {
          position: absolute; top: 44px; right: 16px;
          width: 480px; max-width: 90vw;
          background: var(--paper); border: 1px solid var(--line);
          border-radius: 10px; padding: 12px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.12);
          z-index: 100;
        }
        .json-area {
          width: 100%; font-family: 'JetBrains Mono', monospace;
          font-size: 11px; line-height: 1.45; resize: vertical;
        }
        .json-actions { display: flex; gap: 8px; margin-top: 8px; justify-content: flex-end; }
        .lang-select {
          margin-left: 4px;
          padding: 4px 8px;
          font-size: 12px;
          font-family: inherit;
          border: 1px solid var(--line);
          background: var(--bg);
          color: var(--ink);
          border-radius: 6px;
          cursor: pointer;
          min-width: 76px;
        }
        .lang-select:hover { border-color: var(--primary); }
        .lang-select:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 2px var(--primary-soft); }
      `}</style>
    </div>
  );
}