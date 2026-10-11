import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AgentProviderId, AgentRole } from '@codeo/domain';
import { Button, Choice, Dialog, Field, Input, Placeholder, Select, Textarea } from '@codeo/ui-desktop';
import { invoke } from '../lib/api';
import { useT } from '../lib/i18n';
import { useProviders, useWorkspaces } from '../lib/queries';
import { useUi } from '../lib/store';

const ROLES: AgentRole[] = ['developer', 'planner', 'architect', 'backend', 'frontend', 'qa', 'reviewer', 'devops'];

export function CreateTaskDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const workspaceId = useUi((s) => s.workspaceId);
  const openSession = useUi((s) => s.openSession);
  const workspaces = useWorkspaces();
  const providers = useProviders();
  const ws = workspaces.data?.find((w) => w.id === workspaceId) ?? null;
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [ticketKey, setTicketKey] = useState('');
  const [provider, setProvider] = useState<AgentProviderId>('claude-code');
  const [role, setRole] = useState<AgentRole>('developer');
  const [repos, setRepos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const available = providers.data?.filter((p) => p.installed) ?? [];

  const create = useMutation({
    mutationFn: async (start: boolean) => {
      if (!ws) throw new Error(t('workspaces.empty'));
      const task = await invoke('tasks.create', {
        workspaceId: ws.id,
        title: title.trim(),
        objective: objective.trim(),
        ticketKey: ticketKey.trim() || null,
        repositoryIds: repos,
        provider,
        role,
      });
      if (!start) return { task, session: null };
      const started = await invoke('tasks.start', { taskId: task.id });
      return { task: started.task, session: started.session };
    },
    onSuccess: ({ session }) => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['home'] });
      reset();
      onClose();
      if (session) openSession(session.id);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const reset = () => {
    setTitle('');
    setObjective('');
    setTicketKey('');
    setRepos([]);
    setError(null);
  };
  const valid = title.trim().length > 0 && Boolean(ws) && available.some((p) => p.provider === provider);

  return (
    <Dialog open={open} onClose={onClose} title={t('tasks.create.title')} closeLabel={t('action.close')}>
      <form
        className="cd-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) create.mutate(true);
        }}
      >
        <Field label={t('tasks.create.source')}>
          <div className="cd-row-gap">
            <Choice checked onChange={() => undefined} label={t('tasks.create.source.manual')} name="source" />
            <Placeholder>{t('tasks.create.source.jira')} · {t('placeholder.phase', { n: 5 })}</Placeholder>
            <Placeholder>{t('tasks.create.source.github')} · {t('placeholder.phase', { n: 5 })}</Placeholder>
          </div>
        </Field>
        <div className="cd-form__row">
          <Field label={t('tasks.create.titleField')} htmlFor="task-title">
            <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required maxLength={200} />
          </Field>
          <Field label={t('tasks.create.ticket')} htmlFor="task-ticket">
            <Input id="task-ticket" mono value={ticketKey} onChange={(e) => setTicketKey(e.target.value)} placeholder="PROJ-123" maxLength={40} />
          </Field>
        </div>
        <Field label={t('tasks.create.objective')} htmlFor="task-objective">
          <Textarea id="task-objective" value={objective} onChange={(e) => setObjective(e.target.value)} placeholder={t('tasks.create.objective.placeholder')} rows={5} />
        </Field>
        {ws && ws.repositories.length > 1 ? (
          <Field label={t('tasks.create.repositories')}>
            <div className="cd-row-gap">
              {ws.repositories.map((r) => (
                <Choice key={r.id} type="checkbox" checked={repos.includes(r.id)} onChange={() => setRepos((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id]))} label={r.name} />
              ))}
            </div>
          </Field>
        ) : null}
        <div className="cd-form__row">
          <Field label={t('tasks.create.agent')} htmlFor="task-provider" error={!available.length && providers.data ? t('error.providerUnavailable') : undefined}>
            <Select id="task-provider" value={provider} onChange={(e) => setProvider(e.target.value as AgentProviderId)}>
              {(providers.data ?? []).map((p) => (
                <option key={p.provider} value={p.provider} disabled={!p.installed}>
                  {p.displayName}
                  {p.installed ? '' : ` — ${t('settings.provider.notInstalled')}`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('tasks.create.role')} htmlFor="task-role">
            <Select id="task-role" value={role} onChange={(e) => setRole(e.target.value as AgentRole)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {error ? <span className="cd-field__error">{error}</span> : null}
        <div className="cd-form__actions">
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button variant="secondary" disabled={!valid || create.isPending} onClick={() => create.mutate(false)}>
            {t('action.create')}
          </Button>
          <Button type="submit" variant="primary" icon="play" disabled={!valid} loading={create.isPending}>
            {t('tasks.create.andStart')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
