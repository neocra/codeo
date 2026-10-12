import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SessionEntry } from '@codeo/domain';
import { AgentMessage, Avatar, Button, Icon, StatusPill, Textarea } from '@codeo/ui-desktop';
import { locales } from '@codeo/i18n';
import { describeError, invoke } from '../lib/api';
import { formatRelative, useT } from '../lib/i18n';
import { keys, usePendingApprovals, useSession } from '../lib/queries';
import { ApprovalItem } from './ApprovalItem';
import { providerName, sessionTone } from './status';

/** System entries carry a key so each locale renders its own wording; the stored text is the fallback. */
function systemText(entry: Extract<SessionEntry, { kind: 'system' }>, t: ReturnType<typeof useT>): string {
  const key = entry.key ? `session.system.${entry.key}` : null;
  if (key && key in locales.fr) return t(key as keyof typeof locales.fr, entry.params ?? undefined);
  return entry.text;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function ToolCall({ entry }: { entry: Extract<SessionEntry, { kind: 'tool_call' }> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const arg = (entry.input['file_path'] ?? entry.input['command'] ?? entry.input['pattern'] ?? entry.input['url'] ?? entry.input['query'] ?? '') as string;
  const tone = entry.status === 'running' ? 'live' : entry.status === 'completed' ? 'done' : 'error';
  const label = entry.status === 'running' ? t('status.running') : entry.status === 'completed' ? t('status.completed') : entry.status === 'denied' ? t('sessions.toolDenied') : t('status.failed');
  return (
    <div className={`cd-tool cd-tool--${entry.status}`}>
      <button type="button" className="cd-tool__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name={open ? 'chevronDown' : 'chevron'} size={14} />
        <span className="cd-tool__name">{entry.tool}</span>
        <span className="cd-tool__arg">{typeof arg === 'string' ? arg : JSON.stringify(arg)}</span>
        <span className="cd-tool__status">
          <StatusPill key={tone} tone={tone}>
            {label}
          </StatusPill>
        </span>
      </button>
      {open ? (
        <div className="cd-tool__body">
          <h4>input</h4>
          {JSON.stringify(entry.input, null, 2)}
          {entry.output ? (
            <>
              <h4 style={{ marginTop: 8 }}>output</h4>
              {entry.output}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Entry({ entry, author }: { entry: SessionEntry; author: string }) {
  const t = useT();
  switch (entry.kind) {
    case 'user_message':
      return (
        <div className="cd-user-msg">
          <div className="cd-user-msg__meta">
            <span className="cd-msg__author">Vous</span>
            <span className="cd-msg__time">{fmtTime(entry.at)}</span>
          </div>
          {entry.text}
        </div>
      );
    case 'assistant_text':
      return (
        <AgentMessage author={author} time={fmtTime(entry.at)} streaming={entry.streaming}>
          {entry.text}
        </AgentMessage>
      );
    case 'thinking':
      return <div className="cd-thinking">{t('sessions.thinking')} · {entry.text}</div>;
    case 'tool_call':
      return <ToolCall entry={entry} />;
    case 'system':
      return <div className={`cd-sysmsg${entry.level === 'error' ? ' cd-sysmsg--error' : ''}`}>{systemText(entry, t)}</div>;
    case 'result':
      return (
        <div className={`cd-result ${entry.ok ? 'cd-result--ok' : 'cd-result--error'}`}>
          <Icon name={entry.ok ? 'check' : 'alert'} size={14} />
          <span>{entry.ok ? t('sessions.result.ok') : t('sessions.result.error')}</span>
          {entry.durationMs != null ? <span className="cd-key">{(entry.durationMs / 1000).toFixed(1)} s</span> : null}
          {entry.turns != null ? <span className="cd-key">{entry.turns} tours</span> : null}
          {entry.costUsd != null && entry.costUsd > 0 ? <span className="cd-key">${entry.costUsd.toFixed(3)}</span> : null}
          {!entry.ok && entry.summary ? <span className="cd-faint">{entry.summary.slice(0, 200)}</span> : null}
        </div>
      );
  }
}

export function SessionView({ sessionId }: { sessionId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const detail = useSession(sessionId);
  const approvals = usePendingApprovals();
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const entries = detail.data?.entries ?? [];
  const session = detail.data?.session ?? null;
  const author = session ? providerName[session.provider] : '';

  const lastEntry = entries[entries.length - 1];
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [entries.length, lastEntry]);

  const send = useMutation({
    mutationFn: (text: string) => invoke('sessions.send', { sessionId, text }),
    onSuccess: (s) => {
      setDraft('');
      qc.setQueryData(keys.session(sessionId), (prev: typeof detail.data) => (prev ? { ...prev, session: s } : prev));
    },
  });
  const cancel = useMutation({
    mutationFn: () => invoke('sessions.cancel', { sessionId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.session(sessionId) }),
  });

  if (detail.isLoading) return <div className="cd-session__transcript cd-muted">…</div>;
  if (!session) return <div className="cd-session__transcript cd-muted">{t('sessions.notFound')}</div>;
  const { tone, key } = sessionTone(session.status);
  const live = session.status === 'running' || session.status === 'waiting_approval';
  const sessionApprovals = (approvals.data ?? []).filter((a) => a.sessionId === sessionId);
  const canSend = draft.trim().length > 0 && session.status !== 'waiting_approval' && !send.isPending;

  return (
    <>
      <div className="cd-session__head">
        <span className={live ? 'is-active' : ''} style={{ display: 'contents' }}>
          <Avatar name={author} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="cd-session__title">{session.title}</div>
          <div className="cd-body-sm cd-muted">
            {author} · {t(`role.${session.role}`)} · <span className="cd-key">{session.cwd.split('/').pop()}</span> · {formatRelative(t, session.lastActivityAt)}
          </div>
        </div>
        <StatusPill key={tone} tone={tone}>
          {t(key)}
        </StatusPill>
        {live ? (
          <Button variant="secondary" size="sm" icon="stop" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            {t('action.stop')}
          </Button>
        ) : null}
      </div>
      <div className="cd-session__transcript" ref={scroller}>
        {entries.map((e) => (
          <Entry key={e.id} entry={e} author={author} />
        ))}
        {sessionApprovals.map((a) => (
          <ApprovalItem key={a.id} approval={a} />
        ))}
        {send.isError ? <div className="cd-sysmsg cd-sysmsg--error">{describeError(send.error, t)}</div> : null}
      </div>
      <form
        className="cd-session__composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) send.mutate(draft.trim());
        }}
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('sessions.composer.placeholder', { agent: author })}
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (canSend) send.mutate(draft.trim());
            }
          }}
        />
        <Button type="submit" variant="primary" icon="send" disabled={!canSend} loading={send.isPending}>
          {t('action.send')}
        </Button>
      </form>
    </>
  );
}
