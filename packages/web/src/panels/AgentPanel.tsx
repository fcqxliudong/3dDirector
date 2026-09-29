import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { applyAgentToolCalls, sceneSnapshot, type AgentToolCall } from '../agent/applyTools';

/**
 * 场景助手：自然语言 → LLM tools → 改 SceneJSON
 */

type Role = 'user' | 'agent' | 'system';

interface Message {
  id: string;
  role: Role;
  content: string;
  status?: 'thinking' | 'done' | 'error';
}

interface AgentModel {
  id: string;
  entry_id?: number;
  provider: string;
  model_id: string;
  label: string;
  is_default?: boolean;
}

interface ChatMsg {
  role: 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: AgentToolCall[] | null;
  tool_call_id?: string;
  name?: string;
}

type DsBoot = {
  user?: { csrf?: string };
  endpoints?: { agent?: string };
};

function csrf(): string {
  return (window as unknown as { __DIRECTOR_STAGE__?: DsBoot }).__DIRECTOR_STAGE__?.user?.csrf || '';
}

function agentUrl(): string {
  return (window as unknown as { __DIRECTOR_STAGE__?: DsBoot }).__DIRECTOR_STAGE__?.endpoints?.agent
    || '/api/director_stage_scene_agent.php';
}

function modelKey(m: AgentModel): string {
  return `${m.provider}::${m.model_id}`;
}

export function AgentPanel() {
  const t = useT();
  const welcomeText = t('agent.welcome');
  const [messages, setMessages] = useState<Message[]>([
    { id: 'welcome', role: 'agent', content: welcomeText, status: 'done' },
  ]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<AgentModel[]>([]);
  const [modelSel, setModelSel] = useState('');
  const [modelErr, setModelErr] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<ChatMsg[]>([]);

  useEffect(() => {
    setMessages((prev) => prev.map((m) => (m.id === 'welcome' ? { ...m, content: t('agent.welcome') } : m)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t('agent.welcome')]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, busy]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = agentUrl() + (agentUrl().includes('?') ? '&' : '?') + 'action=list';
        const res = await fetch(url, { credentials: 'same-origin' });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!data?.ok) {
          setModelErr(String(data?.error || t('agent.modelLoadFail')));
          return;
        }
        const list = Array.isArray(data.models) ? (data.models as AgentModel[]) : [];
        setModels(list);
        const def = list.find((m) => m.is_default) || list[0];
        if (def) setModelSel(modelKey(def));
        else setModelErr(t('agent.noModel'));
      } catch (e) {
        if (!cancelled) setModelErr((e as Error).message || t('agent.modelLoadFail'));
      }
    })();
    return () => { cancelled = true; };
  }, [t]);

  const pushUi = (msg: Message) => setMessages((prev) => [...prev, msg]);

  const selectedModel = (): AgentModel | null => {
    return models.find((m) => modelKey(m) === modelSel) || null;
  };

  const callChat = async (history: ChatMsg[]) => {
    const m = selectedModel();
    const res = await fetch(agentUrl(), {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf(),
      },
      body: JSON.stringify({
        action: 'chat',
        messages: history,
        scene: sceneSnapshot(),
        provider: m?.provider || '',
        model_id: m?.model_id || '',
        csrf: csrf(),
      }),
    });
    const data = await res.json().catch(() => null);
    if (!data?.ok) {
      throw new Error(String(data?.error || `HTTP ${res.status}`));
    }
    return data as {
      message: {
        role: string;
        content?: string | null;
        tool_calls?: AgentToolCall[] | null;
      };
    };
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (!selectedModel() && models.length === 0) {
      pushUi({
        id: `s-${Date.now()}`,
        role: 'system',
        content: modelErr || t('agent.noModel'),
        status: 'error',
      });
      return;
    }

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      status: 'done',
    };
    const thinkingId = `a-${Date.now()}`;
    pushUi(userMsg);
    pushUi({
      id: thinkingId,
      role: 'agent',
      content: t('agent.thinking'),
      status: 'thinking',
    });
    setDraft('');
    setBusy(true);

    const history = [...historyRef.current, { role: 'user' as const, content: text }];

    try {
      let round = 0;
      let working = history;
      let lastText = '';
      const allSummaries: string[] = [];

      while (round < 5) {
        round += 1;
        const data = await callChat(working);
        const msg = data.message || { role: 'assistant', content: '' };
        const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls.filter(Boolean) : [];
        const content = String(msg.content || '').trim();
        if (content) lastText = content;

        const assistantForHistory: ChatMsg = {
          role: 'assistant',
          content: content || null,
          tool_calls: toolCalls.length ? toolCalls : null,
        };
        working = [...working, assistantForHistory];

        if (!toolCalls.length) {
          break;
        }

        const results = applyAgentToolCalls(toolCalls);
        results.forEach((r) => {
          if (r.ok && r.summary) allSummaries.push('✓ ' + r.summary);
          else if (r.error) allSummaries.push('✗ ' + (r.name || '?') + ': ' + r.error);
        });

        const toolMsgs: ChatMsg[] = results.map((r) => ({
          role: 'tool' as const,
          tool_call_id: r.id,
          name: r.name,
          content: JSON.stringify(
            r.ok
              ? { ok: true, summary: r.summary }
              : { ok: false, error: r.error || 'failed' },
          ),
        }));
        working = [...working, ...toolMsgs];
      }

      historyRef.current = working.slice(-30);

      const replyParts = [];
      if (lastText) replyParts.push(lastText);
      if (allSummaries.length) {
        replyParts.push(t('agent.applied') + '\n' + allSummaries.join('\n'));
      }
      const reply = replyParts.join('\n\n') || t('agent.emptyReply');

      setMessages((prev) => prev.map((m) => (
        m.id === thinkingId
          ? { ...m, content: reply, status: 'done' as const }
          : m
      )));
    } catch (e) {
      const err = (e as Error).message || t('agent.error');
      setMessages((prev) => prev.map((m) => (
        m.id === thinkingId
          ? { ...m, content: err, status: 'error' as const, role: 'system' as const }
          : m
      )));
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleClear = () => {
    historyRef.current = [];
    setMessages([{ id: 'welcome', role: 'agent', content: t('agent.welcome'), status: 'done' }]);
  };

  return (
    <div className="agent-panel">
      <div className="agent-toolbar">
        <label className="agent-model">
          <span>{t('agent.model')}</span>
          <select
            value={modelSel}
            onChange={(e) => setModelSel(e.target.value)}
            disabled={busy || models.length === 0}
            title={modelErr || t('agent.model')}
          >
            {models.length === 0 && <option value="">{t('agent.noModel')}</option>}
            {models.map((m) => (
              <option key={modelKey(m)} value={modelKey(m)}>
                {m.label}{m.is_default ? ` · ${t('agent.default')}` : ''}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="agent-clear" onClick={handleClear} disabled={busy}>
          {t('agent.clear')}
        </button>
      </div>

      <div className="agent-messages" ref={scrollRef}>
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}${m.status === 'error' ? ' is-err' : ''}`}>
            {m.role !== 'system' && (
              <div className="msg-meta">
                {m.role === 'user' ? t('agent.you') : t('agent.bot')}
                {m.status === 'thinking' ? ` · ${t('agent.thinking')}` : ''}
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
          disabled={busy}
        />
        <div className="agent-input-row">
          <span className="agent-hint">{modelErr || t('agent.hint')}</span>
          <button
            className="primary"
            onClick={() => void handleSend()}
            disabled={busy || !draft.trim()}
          >
            {busy ? t('agent.sending') : t('agent.send')}
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
        .agent-toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-bottom: 1px solid var(--line);
          background: var(--bg);
          flex-shrink: 0;
        }
        .agent-model {
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--muted);
        }
        .agent-model select {
          flex: 1;
          min-width: 0;
          font: inherit;
          color: var(--ink);
          background: var(--paper);
          border: 1px solid var(--line);
          border-radius: 6px;
          padding: 4px 6px;
        }
        .agent-clear {
          flex: 0 0 auto;
          font-size: 12px;
          padding: 4px 8px;
          border: 1px solid var(--line);
          border-radius: 6px;
          background: var(--paper);
          color: var(--muted);
          cursor: pointer;
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
        .msg { display: flex; flex-direction: column; max-width: 92%; }
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
        .msg-system .msg-bubble,
        .msg.is-err .msg-bubble {
          background: transparent;
          color: var(--warn, #b45309);
          font-size: 12px;
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
