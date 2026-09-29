import { useState } from 'react';
import { AgentPanel } from './AgentPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { useT } from '../i18n';

export function RightPanel() {
  const t = useT();
  const [tab, setTab] = useState<'console' | 'agent'>('console');

  return (
    <aside className="right-panel">
      <div className="right-tabs" role="tablist">
        <button
          className={`right-tab ${tab === 'console' ? 'active' : ''}`}
          role="tab"
          aria-selected={tab === 'console'}
          onClick={() => setTab('console')}
        >
          {t('tab.console')}
        </button>
        <button
          className={`right-tab ${tab === 'agent' ? 'active' : ''}`}
          role="tab"
          aria-selected={tab === 'agent'}
          onClick={() => setTab('agent')}
        >
          {t('tab.agent')}
          <span className="badge-dev">{t('tab.agent.dev')}</span>
        </button>
      </div>

      <div className="right-tab-body">
        {tab === 'console' ? <PropertiesPanel /> : <AgentPanel />}
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
          overflow-y: auto;
          display: flex;
          flex-direction: column;
        }
      `}</style>
    </aside>
  );
}