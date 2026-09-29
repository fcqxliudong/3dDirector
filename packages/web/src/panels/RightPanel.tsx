import { useState } from 'react';
import { AgentPanel } from './AgentPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { useT } from '../i18n';

export function RightPanel() {
  const t = useT();
  // 默认打开智能体；两面板都挂载，切 tab 只隐藏，避免对话历史被卸载清空
  const [tab, setTab] = useState<'console' | 'agent'>('agent');

  return (
    <aside className="right-panel">
      <div className="right-tabs" role="tablist">
        <button
          className={`right-tab ${tab === 'agent' ? 'active' : ''}`}
          role="tab"
          aria-selected={tab === 'agent'}
          onClick={() => setTab('agent')}
        >
          {t('tab.agent')}
          {t('tab.agent.dev') ? <span className="badge-dev">{t('tab.agent.dev')}</span> : null}
        </button>
        <button
          className={`right-tab ${tab === 'console' ? 'active' : ''}`}
          role="tab"
          aria-selected={tab === 'console'}
          onClick={() => setTab('console')}
        >
          {t('tab.console')}
        </button>
      </div>

      <div className="right-tab-body">
        <div className={`right-tab-pane right-tab-pane-agent${tab === 'agent' ? ' is-active' : ''}`} hidden={tab !== 'agent'}>
          <AgentPanel />
        </div>
        <div className={`right-tab-pane right-tab-pane-console${tab === 'console' ? ' is-active' : ''}`} hidden={tab !== 'console'}>
          <PropertiesPanel />
        </div>
      </div>

      <style>{`
        .right-panel {
          background: var(--paper);
          border-left: 1px solid var(--line);
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          min-width: 0;
        }
        .right-tabs {
          display: flex;
          align-items: stretch;
          border-bottom: 1px solid var(--line);
          background: var(--bg);
          flex-shrink: 0;
        }
        .right-tab {
          flex: 1;
          background: transparent;
          border: none;
          border-bottom: 2px solid transparent;
          padding: 10px 12px;
          font-size: 13px;
          font-weight: 500;
          color: var(--muted);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          transition: all .15s ease;
        }
        .right-tab:hover {
          color: var(--ink);
          background: var(--paper);
        }
        .right-tab.active {
          color: var(--ink);
          border-bottom-color: var(--primary);
          background: var(--paper);
          font-weight: 600;
        }
        .badge-dev {
          font-size: 10px;
          padding: 1px 5px;
          background: #f3e1de;
          color: var(--warn);
          border-radius: 3px;
          font-weight: 500;
        }
        .right-tab-body {
          flex: 1;
          min-height: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          position: relative;
        }
        .right-tab-pane {
          flex: 1;
          min-height: 0;
          display: none;
          flex-direction: column;
          overflow: hidden;
        }
        .right-tab-pane.is-active {
          display: flex;
        }
        .right-tab-pane[hidden] {
          display: none !important;
        }
        .right-tab-pane-console.is-active {
          overflow-y: auto;
        }
      `}</style>
    </aside>
  );
}