import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { SubtaskPlan } from '@codeo/contracts';
import type { AgentProviderId, AgentRole, OrchestrationMode } from '@codeo/domain';
import { Button, Card, Choice, Dialog, Field, Input, Placeholder, Select, Textarea } from '@codeo/ui-desktop';
import type { MessageKey } from '@codeo/i18n';
import { invoke } from '../lib/api';
import { useT } from '../lib/i18n';
import { useProviders, useWorkspaces } from '../lib/queries';
import { useUi } from '../lib/store';

const ROLES: AgentRole[] = ['developer', 'planner', 'architect', 'backend', 'frontend', 'qa', 'reviewer', 'devops'];
const MODES: OrchestrationMode[] = ['single', 'sequential', 'pipeline', 'parallel', 'best-of-n'];
const MAX_AGENTS = 8;

interface AgentDraft {
  key: number;
  title: string;
  instructions: string;
  provider: AgentProviderId;
  role: AgentRole;
  repositoryId: string;
  /** Indexes of earlier agents (parallel mode only). */
  dependsOn: number[];
}

const agentLabelKey = (mode: OrchestrationMode): MessageKey =>
  mode === 'best-of-n' ? 'tasks.create.candidate' : mode === 'parallel' ? 'tasks.create.subtask' : 'tasks.create.step';

let nextKey = 1;
const draft = (provider: AgentProviderId, role: AgentRole = 'developer'): AgentDraft => ({ key: nextKey++, title: '', instructions: '', provider, role, repositoryId: '', dependsOn: [] });

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
  const [mode, setMode] = useState<OrchestrationMode>('single');
  const [isolated, setIsolated] = useState(true);
  const [agents, setAgents] = useState<AgentDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const available = providers.data?.filter((p) => p.installed) ?? [];
  const isInstalled = (id: AgentProviderId) => available.some((p) => p.provider === id);
  const parallelMode = mode === 'parallel' || mode === 'best-of-n';
  const multiRepo = Boolean(ws && ws.repositories.length > 1);

  const changeMode = (m: OrchestrationMode) => {
    setMode(m);
    if (m === 'parallel' || m === 'best-of-n') setIsolated(true);
    if (m === 'single') return;
    /* Seed a sensible plan the first time; keep the user's edits afterwards. */
    setAgents((cur) => {
      const base = cur.length ? cur : m === 'sequential' || m === 'pipeline' ? [draft(provider, 'planner'), draft(provider, role)] : [draft(provider, role), draft(provider, role)];
      const min = m === 'best-of-n' ? 2 : 1;
      const padded = base.length >= min ? base : [...base, ...Array.from({ length: min - base.length }, () => draft(provider, role))];
      return m === 'parallel' ? padded : padded.map((a) => ({ ...a, dependsOn: [] }));
    });
  };
  const patchAgent = (i: number, patch: Partial<AgentDraft>) => setAgents((cur) => cur.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const removeAgent = (i: number) =>
    setAgents((cur) => cur.filter((_, j) => j !== i).map((a) => ({ ...a, dependsOn: a.dependsOn.filter((d) => d !== i).map((d) => (d > i ? d - 1 : d)) })));

  const create = useMutation({
    mutationFn: async (start: boolean) => {
      if (!ws) throw new Error(t('workspaces.empty'));
      const subtasks: SubtaskPlan[] =
        mode === 'single'
          ? []
          : agents.map((a) => ({
              title: a.title.trim(),
              instructions: mode === 'best-of-n' ? '' : a.instructions.trim(),
              provider: a.provider,
              role: a.role,
              model: null,
              repositoryId: a.repositoryId || null,
              dependsOn: mode === 'parallel' ? a.dependsOn : [],
            }));
      const task = await invoke('tasks.create', {
        workspaceId: ws.id,
        title: title.trim(),
        objective: objective.trim(),
        ticketKey: ticketKey.trim() || null,
        repositoryIds: repos,
        provider,
        role,
        orchestration: mode,
        isolation: isolated ? 'worktree' : 'none',
        subtasks,
      });
      if (!start) return { task, session: null };
      const started = await invoke('tasks.start', { taskId: task.id });
      return { task: started.task, session: started.sessions[0] ?? null };
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
    setMode('single');
    setIsolated(true);
    setAgents([]);
    setError(null);
  };
  const planValid = mode === 'single' ? isInstalled(provider) : agents.length >= (mode === 'best-of-n' ? 2 : 1) && agents.every((a) => isInstalled(a.provider));
  const valid = title.trim().length > 0 && Boolean(ws) && planValid;

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
          <Textarea id="task-objective" value={objective} onChange={(e) => setObjective(e.target.value)} placeholder={t('tasks.create.objective.placeholder')} rows={4} />
        </Field>
        {multiRepo && ws ? (
          <Field label={t('tasks.create.repositories')}>
            <div className="cd-row-gap">
              {ws.repositories.map((r) => (
                <Choice key={r.id} type="checkbox" checked={repos.includes(r.id)} onChange={() => setRepos((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id]))} label={r.name} />
              ))}
            </div>
          </Field>
        ) : null}
        <Field label={t('tasks.create.mode')} htmlFor="task-mode" hint={t(`tasks.mode.${mode}.desc`)}>
          <Select id="task-mode" value={mode} onChange={(e) => changeMode(e.target.value as OrchestrationMode)}>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {t(`tasks.mode.${m}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('tasks.create.isolation')} hint={parallelMode ? t('tasks.create.isolation.required') : t('tasks.create.isolation.hint')}>
          <Choice type="checkbox" checked={isolated} onChange={() => !parallelMode && setIsolated((v) => !v)} label={isolated ? t('tasks.isolation.worktree') : t('tasks.isolation.none')} />
        </Field>

        {mode === 'single' ? (
          <div className="cd-form__row">
            <Field label={t('tasks.create.agent')} htmlFor="task-provider" error={!available.length && providers.data ? t('error.providerUnavailable') : undefined}>
              <ProviderSelect id="task-provider" value={provider} onChange={setProvider} />
            </Field>
            <Field label={t('tasks.create.role')} htmlFor="task-role">
              <RoleSelect id="task-role" value={role} onChange={setRole} />
            </Field>
          </div>
        ) : (
          <Field label={t('tasks.create.agents')} hint={mode === 'best-of-n' ? t('tasks.create.sameObjective') : undefined}>
            <div className="cd-stack cd-stack--sm">
              {agents.map((a, i) => (
                <Card key={a.key} compact className="cd-stack cd-stack--sm" style={{ animation: 'none' }}>
                  <div className="cd-row-gap">
                    <span className="cd-overline">{t(agentLabelKey(mode), { n: i + 1 })}</span>
                    <span style={{ flex: 1 }} />
                    <Button variant="ghost" size="sm" icon="x" aria-label={t('tasks.create.removeAgent')} disabled={agents.length <= (mode === 'best-of-n' ? 2 : 1)} onClick={() => removeAgent(i)} />
                  </div>
                  <div className="cd-form__row">
                    <ProviderSelect aria-label={t('tasks.create.agent')} value={a.provider} onChange={(v) => patchAgent(i, { provider: v })} />
                    <RoleSelect aria-label={t('tasks.create.role')} value={a.role} onChange={(v) => patchAgent(i, { role: v })} />
                  </div>
                  {mode !== 'best-of-n' ? (
                    <>
                      <Input aria-label={t('tasks.create.stepTitle')} placeholder={t('tasks.create.stepTitle')} value={a.title} maxLength={200} onChange={(e) => patchAgent(i, { title: e.target.value })} />
                      <Textarea aria-label={t('tasks.create.stepInstructions')} placeholder={t('tasks.create.stepInstructions')} value={a.instructions} rows={2} onChange={(e) => patchAgent(i, { instructions: e.target.value })} />
                    </>
                  ) : null}
                  {multiRepo && ws ? (
                    <Select aria-label={t('tasks.create.repository')} value={a.repositoryId} onChange={(e) => patchAgent(i, { repositoryId: e.target.value })}>
                      <option value="">{t('tasks.create.repository')} · —</option>
                      {ws.repositories.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                  {mode === 'parallel' && i > 0 ? (
                    <div className="cd-row-gap">
                      <span className="cd-body-sm cd-muted">{t('tasks.create.dependsOn')}</span>
                      {agents.slice(0, i).map((_, d) => (
                        <Choice
                          key={d}
                          type="checkbox"
                          checked={a.dependsOn.includes(d)}
                          onChange={() => patchAgent(i, { dependsOn: a.dependsOn.includes(d) ? a.dependsOn.filter((x) => x !== d) : [...a.dependsOn, d].sort((x, y) => x - y) })}
                          label={t(agentLabelKey(mode), { n: d + 1 })}
                        />
                      ))}
                    </div>
                  ) : null}
                </Card>
              ))}
              <div>
                <Button variant="secondary" size="sm" icon="plus" disabled={agents.length >= MAX_AGENTS} onClick={() => setAgents((cur) => [...cur, draft(provider, role)])}>
                  {t('tasks.create.addAgent')}
                </Button>
              </div>
            </div>
          </Field>
        )}
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

function ProviderSelect({ value, onChange, ...rest }: { value: AgentProviderId; onChange: (v: AgentProviderId) => void; id?: string; 'aria-label'?: string }) {
  const t = useT();
  const providers = useProviders();
  return (
    <Select {...rest} value={value} onChange={(e) => onChange(e.target.value as AgentProviderId)}>
      {(providers.data ?? []).map((p) => (
        <option key={p.provider} value={p.provider} disabled={!p.installed}>
          {p.displayName}
          {p.installed ? '' : ` — ${t('settings.provider.notInstalled')}`}
        </option>
      ))}
    </Select>
  );
}

function RoleSelect({ value, onChange, ...rest }: { value: AgentRole; onChange: (v: AgentRole) => void; id?: string; 'aria-label'?: string }) {
  const t = useT();
  return (
    <Select {...rest} value={value} onChange={(e) => onChange(e.target.value as AgentRole)}>
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {t(`role.${r}`)}
        </option>
      ))}
    </Select>
  );
}
