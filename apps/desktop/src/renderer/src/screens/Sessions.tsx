import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AgentProviderId, AgentRole } from '@codeo/domain';
import { Avatar, Button, Dialog, EmptyState, Field, Select, StatusPill, Tabs, Textarea } from '@codeo/ui-desktop';
import { SessionView } from '../components/SessionView';
import { providerName, sessionTone } from '../components/status';
import { invoke } from '../lib/api';
import { formatRelative, useT } from '../lib/i18n';
import { useProviders, useSessions, useWorkspaces } from '../lib/queries';
import { useUi } from '../lib/store';

const ROLES: AgentRole[] = ['developer', 'planner', 'architect', 'backend', 'frontend', 'qa', 'reviewer', 'devops'];

function NewSessionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { workspaceId, openSession } = useUi();
  const workspaces = useWorkspaces();
  const providers = useProviders();
  const ws = workspaces.data?.find((w) => w.id === workspaceId) ?? null;
  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState<AgentProviderId>('claude-code');
  const [role, setRole] = useState<AgentRole>('developer');
  const [repositoryId, setRepositoryId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () => invoke('sessions.start', { workspaceId: ws!.id, repositoryId: repositoryId || ws!.repositories[0]?.id || null, provider, role, prompt: prompt.trim() }),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      setPrompt('');
      onClose();
      openSession(s.id);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const valid = Boolean(ws) && prompt.trim().length > 0 && (providers.data ?? []).some((p) => p.provider === provider && p.installed);
  return (
    <Dialog open={open} onClose={onClose} title={t('sessions.new.title')} closeLabel={t('action.close')}>
      <form
        className="cd-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) start.mutate();
        }}
      >
        <div className="cd-form__row">
          <Field label={t('tasks.create.agent')} htmlFor="ns-provider">
            <Select id="ns-provider" value={provider} onChange={(e) => setProvider(e.target.value as AgentProviderId)}>
              {(providers.data ?? []).map((p) => (
                <option key={p.provider} value={p.provider} disabled={!p.installed}>
                  {p.displayName}{p.installed ? '' : ` — ${t('settings.provider.notInstalled')}`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('tasks.create.role')} htmlFor="ns-role">
            <Select id="ns-role" value={role} onChange={(e) => setRole(e.target.value as AgentRole)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {ws && ws.repositories.length > 1 ? (
          <Field label={t('sessions.new.repository')} htmlFor="ns-repo">
            <Select id="ns-repo" value={repositoryId} onChange={(e) => setRepositoryId(e.target.value)}>
              {ws.repositories.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label={t('sessions.new.prompt')} htmlFor="ns-prompt">
          <Textarea id="ns-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} autoFocus placeholder={t('tasks.create.objective.placeholder')} />
        </Field>
        {error ? <span className="cd-field__error">{error}</span> : null}
        <div className="cd-form__actions">
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" variant="primary" icon="play" disabled={!valid} loading={start.isPending}>
            {t('action.start')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function SessionsScreen() {
  const t = useT();
  const { workspaceId, selectedSessionId, openSession } = useUi();
  const sessions = useSessions(workspaceId);
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all');
  const [creating, setCreating] = useState(false);
  const list = (sessions.data ?? []).filter((s) => (filter === 'all' ? true : filter === 'active' ? ['running', 'waiting_approval', 'idle', 'created'].includes(s.status) : ['completed', 'failed', 'cancelled', 'disconnected'].includes(s.status)));
  const current = selectedSessionId && (sessions.data ?? []).some((s) => s.id === selectedSessionId) ? selectedSessionId : (list[0]?.id ?? null);

  return (
    <div className="cd-session">
      <aside className="cd-session__list">
        <div className="cd-session__list-head">
          <span className="cd-card__title" style={{ flex: 1 }}>
            {t('sessions.title')}
          </span>
          <Button variant="primary" size="sm" icon="plus" onClick={() => setCreating(true)} disabled={!workspaceId}>
            {t('action.newSession')}
          </Button>
        </div>
        <div style={{ padding: '0 12px 12px' }}>
          <Tabs
            value={filter}
            onChange={(id) => setFilter(id as typeof filter)}
            items={[
              { id: 'all', label: t('sessions.filter.all') },
              { id: 'active', label: t('sessions.filter.active') },
              { id: 'done', label: t('sessions.filter.done') },
            ]}
          />
        </div>
        <div className="cd-session__list-body">
          {list.map((s) => {
            const st = sessionTone(s.status);
            return (
              <button key={s.id} type="button" className={['cd-session-item', s.id === current && 'is-selected'].filter(Boolean).join(' ')} onClick={() => openSession(s.id)}>
                <span className={s.status === 'running' ? 'is-active' : ''} style={{ display: 'contents' }}>
                  <Avatar name={providerName[s.provider]} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="cd-session-item__name">{s.title}</span>
                  <span className="cd-session-item__sub">
                    {providerName[s.provider]} · {t(`role.${s.role}`)} · {formatRelative(t, s.lastActivityAt)}
                  </span>
                  <span style={{ display: 'block', marginTop: 6 }}>
                    <StatusPill key={s.status} tone={st.tone}>
                      {t(st.key)}
                    </StatusPill>
                  </span>
                </span>
              </button>
            );
          })}
          {!list.length ? <div className="cd-body-sm cd-muted" style={{ padding: 12 }}>{t('sessions.empty')}</div> : null}
        </div>
      </aside>
      <section className="cd-session__main">
        {current ? (
          <SessionView key={current} sessionId={current} />
        ) : (
          <div style={{ padding: 32 }}>
            <EmptyState
              title={t('sessions.empty')}
              action={
                <Button variant="secondary" icon="plus" onClick={() => setCreating(true)} disabled={!workspaceId}>
                  {t('action.newSession')}
                </Button>
              }
            />
          </div>
        )}
      </section>
      <NewSessionDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
