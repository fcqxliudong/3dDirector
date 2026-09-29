import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';

/**
 * Agent 面板 · Phase 1 前端 shell（不接 LLM）
 *
 * 接 LLM 后改 handleSend 实现：
 *   await fetch('/api/director_stage_scene_agent.php', ...)
 *   逐条 useSceneStore.getState().xxx(args)
 */

type Role = 'user' | 'agent' | 'system';

interface Message {
  id: string;
  role: Role;
  content: string;
  status?: 'thinking' | 'done' | 'error';
}

export function AgentPanel() {
  const t = useT();
  const welcomeText = t('agent.welcome');
  const [messages, setMessages] = useState<Message[]>([
    { id: 'welcome', role: 'agent', content: welcomeText, status: 'done' },
  ]);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 同步语言变化 → 刷新 welcome 文案
  useEffect(() => {
    setMessages((prev) => prev.map((m) => (m.id === 'welcome' ? { ...m, content: t('agent.welcome') } : m)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t('agent.welcome')]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      status: 'done',
    };
    const sysMsg: Message = {
      id: `s-${Date.now()}`,
      role: 'system',
      content: t('agent.devNoop'),
      status: 'done',
    };
    // eslint-disable-next-line no-console
    console.info('[AgentPanel] user message (no-op for now):', text);
    setMessages((prev) => [...prev, userMsg, sysMsg]);
    setDraft('');
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="agent-panel">
      <div className="agent-messages" ref={scrollRef}>
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            {m.role !== 'system' && (
              <div className="msg-meta">
                {m.role === 'user' ? t('agent.you') : t('agent.bot')}
              </div>
            )}
            <div className="msg-bubble">{m.content}</div>
          </div>
        ))}
      </div>

      <div className="agent-input">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('agent.inputPlaceholder')}
          rows={3}
        />
        <div className="agent-input-row">
          <span className="agent-hint">{t('agent.devHint')}</span>
          <button
            className="primary"
            onClick={handleSend}
            disabled={!draft.trim()}
          >
            {t('agent.send')}
          </button>
        </div>
      </div>

      <style>{`
        .agent-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
        }
        .agent-messages {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .msg { display: flex; flex-direction: column; max-width: 88%; }
        .msg-user { align-self: flex-end; align-items: flex-end; }
        .msg-agent { align-self: flex-start; }
        .msg-system { align-self: center; max-width: 95%; }
        .msg-meta {
          font-size: 11px; color: var(--muted);
          padding: 0 4px 2px;
        }
        .msg-bubble {
          padding: 8px 12px;
          border-radius: 10px;
          font-size: 13px;
          line-height: 1.5;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .msg-user .msg-bubble {
          background: var(--primary);
          color: white;
          border-bottom-right-radius: 2px;
        }
        .msg-agent .msg-bubble {
          background: var(--bg);
          color: var(--ink);
          border: 1px solid var(--line);
          border-bottom-left-radius: 2px;
        }
        .msg-system .msg-bubble {
          background: transparent;
          color: var(--muted);
          font-size: 11.5px;
          font-style: italic;
          padding: 4px 8px;
          border: 1px dashed var(--line);
        }
        .agent-input {
          border-top: 1px solid var(--line);
          padding: 10px 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex-shrink: 0;
          background: var(--paper);
        }
        .agent-input textarea {
          resize: none;
          width: 100%;
          font-family: inherit;
          font-size: 13px;
          line-height: 1.5;
          padding: 8px 10px;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: var(--bg);
        }
        .agent-input textarea:focus {
          border-color: var(--primary);
          box-shadow: 0 0 0 2px var(--primary-soft);
          outline: none;
        }
        .agent-input-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .agent-hint {
          flex: 1;
          font-size: 11px;
          color: var(--muted);
        }
      `}</style>
    </div>
  );
}